import { TransactionItem, SamplingConfig, SamplingResult, SampledItem } from '../types';
import { Mulberry32 } from '../statistics/prng';
import { DEFAULT_HOLIDAYS, sanitizeHolidays, isHoliday } from '../utils/holidays';
import { formatIsoDate, formatNumber } from '../utils/locale';
import { getReliabilityFactor, getZScore, getExpansionFactor } from '../statistics/reliabilityFactor';

export const methodsSupportingAnomalies = ['MUS', 'CVS', 'Random', 'FixedRandom'];

export function formatMoney(val: number): string {
    // Grouping and decimal separators follow the operating system, the same
    // source the date format comes from.
    return formatNumber(val);
}

export function formatDate(val: string): string {
    // Dates are stored as ISO and shown the way the operating system writes
    // them, which is also the format the Excel export uses.
    return formatIsoDate(val);
}

export function smartFormat(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') {
        // Integers are identifiers or codes as often as they are amounts, so
        // they stay bare; only fractional values get the money rendering.
        return Number.isInteger(val) ? val.toString() : formatNumber(val);
    }
    const str = String(val);
    // Cells normalized on import store dates as ISO; show them in the user's
    // format instead of leaking the storage representation into the table.
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return formatDate(str);
    return str;
}

/**
 * Misstatements the auditor has actually established: only items with an audit
 * value entered are counted. Unaudited items carry difference = bookValue as a
 * placeholder, so summing everything would report the whole sample as an error.
 */
export function getEnteredMisstatements(results: SamplingResult): { total: number; audited: number; items: number } {
    const all = [...(results.samplingItems || []), ...(results.keyItems || [])];
    const entered = all.filter(i => i.auditedValue !== '' && i.auditedValue !== null && i.auditedValue !== undefined);
    const total = entered.reduce((acc, i) => acc + (i.bookValue - Number(i.auditedValue)), 0);
    return { total, audited: entered.length, items: all.length };
}

export function calculateExtrapolation(results: SamplingResult, config: SamplingConfig): { projected: number, ub: number } {
    const hasEditableItems = (results.samplingItems?.length || 0) > 0 || (results.keyItems?.length || 0) > 0;
    if (!hasEditableItems && results.samplingInterval === 0 && (results.projectedMisstatement !== 0 || results.upperMisstatementBound !== 0)) {
        // Fallback for imported projects where config/interval is lost AND there are no
        // items to recompute from — show the stored final numbers as-is.
        return { projected: results.projectedMisstatement, ub: results.upperMisstatementBound };
    }

    const rf = getReliabilityFactor(config.confidenceLevel);

    let pm = 0;
    
    // Key items errors
    const keyMisstatements = (results.keyItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
    
    // Sample items projected errors
    const sampleProjected = (results.samplingItems || []).reduce((acc, item) => {
        const diff = item.difference || 0;
        const tainting = item.bookValue !== 0 ? diff / item.bookValue : 0;
        return acc + (tainting * results.samplingInterval);
    }, 0);

    pm = keyMisstatements + sampleProjected;
    
    // In MUS, Basic Precision should equal Materiality (Tolerable Misstatement) when sample is planned ideally.
    // We use Tolerable Misstatement for the Basic Precision if available, otherwise fallback to reconstructed standard.
    const basicPrecision = config.method === 'MUS' && config.tolerableMisstatement > 0 
        ? config.tolerableMisstatement 
        : (results.samplingInterval * rf);
        
    let ub = basicPrecision + pm;

    if (config.method === 'Attribute') {
        const errors = (results.samplingItems || []).filter(item => Math.abs(item.difference || 0) > 0.001).length;
        const total = (results.samplingItems || []).length || 1;
        pm = (errors / total) * 100;
        ub = ((errors + rf) / total) * 100;
    } else if (config.method === 'RiskAssessment' || config.method === 'FixedRandom' || config.method === 'Systematic' || config.method === 'Pareto' || config.method === 'Percentile' || config.method === 'Grubbs' || config.method === 'Benford' || config.method === 'StopOrGo') {
        pm = keyMisstatements + (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
        ub = pm;
    } else if (config.method === 'Random' || config.method === 'CVS' || config.method === 'Cluster') {
        const sampleErrors = (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
        const n = results.samplingItems?.length || 1;
        const N_rem = Math.max(0, results.populationSize - (results.keyItems?.length || 0) - (results.trivialCount || 0));
        const meanDiff = sampleErrors / n;
        
        pm = keyMisstatements + (meanDiff * N_rem);
        
        if (config.method === 'Random' || config.method === 'CVS' || config.method === 'Cluster') {
            let variance = (results.samplingItems || []).reduce((acc, item) => acc + Math.pow((item.difference || 0) - meanDiff, 2), 0);
            if (n > 1) {
                variance = variance / (n - 1);
            }
            const stdErr = N_rem * Math.sqrt(variance) / Math.sqrt(n);
            const zScore = getZScore(config.confidenceLevel);
            ub = pm + Math.abs(zScore * stdErr);
        } else {
            ub = pm;
        }
    }

    return {
        projected: pm,
        ub: ub
    };
}

export function runSampling(population: TransactionItem[], config: SamplingConfig): SamplingResult {
    if (!population || population.length === 0) {
        throw new Error('Population cannot be empty');
    }
    
    const popValue = population.reduce((acc, curr) => acc + Math.abs(curr.amount), 0);
    
    const keyItems: SampledItem[] = [];
    const trivialItems: TransactionItem[] = [];
    const regularItems: TransactionItem[] = [];
    
    let trivialCount = 0;
    let trivialValue = 0;
    
    population.forEach((item) => {
        if (config.clearlyTrivialThreshold && Math.abs(item.amount) < config.clearlyTrivialThreshold) {
            if (trivialItems.length < 10) trivialItems.push(item);
            trivialCount++;
            trivialValue += item.amount;
        } else if (
            config.method === 'MUS' &&
            config.tolerableMisstatement &&
            Math.abs(item.amount) >= config.tolerableMisstatement
        ) {
            // ISA 530: items whose individual value ≥ PM must be audited 100%.
            // They are separated from the probabilistic pool so the interval and
            // sample size formula operate on the correct residual population.
            keyItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '',
                difference: item.amount,
                tainting: 1,
                isKeyItem: true
            });
        } else if (
            config.anomalyMethod !== 'None' &&
            ['Random', 'FixedRandom', 'CVS', 'Cluster', 'RiskAssessment'].includes(config.method) &&
            config.tolerableMisstatement &&
            Math.abs(item.amount) >= config.tolerableMisstatement
        ) {
            keyItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '',
                difference: item.amount,
                tainting: 1,
                isKeyItem: true
            });
        } else {
            regularItems.push(item);
        }
    });

    const rf = getReliabilityFactor(config.confidenceLevel);

    const rng = new Mulberry32(config.seed ?? Math.floor(Math.random() * 100000));

    let sampleSize = 10;
    const remPopValue = popValue - keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0) - Math.abs(trivialValue);

    let sampleItems: SampledItem[] = [];
    let riskCriteriaHits: { weekend: number; holiday: number; closing: number } | undefined;

    const getRandomSamples = <T>(array: T[], count: number): T[] => {
        const result: T[] = [];
        const n = array.length;
        count = Math.min(count, n);
        if (count === 0) return result;

        if (n > 10000 && count < 1000) {
            const picked = new Set<number>();
            while(picked.size < count) {
                picked.add(Math.floor(rng.next() * n));
            }
            for (const idx of picked) {
                result.push(array[idx]);
            }
        } else {
            const copy = array.slice();
            for(let i=0; i<count; i++) {
                const r = i + Math.floor(rng.next() * (n - i));
                const temp = copy[i];
                copy[i] = copy[r];
                copy[r] = temp;
                result.push(copy[i]);
            }
        }
        return result;
    };

    if (config.method === 'RiskAssessment') {
        const closingDays = config.riskClosingDays ?? 5;
        const includeWeekend = config.riskWeekend !== false;
        
        const holidayList = (() => {
            const configured = sanitizeHolidays(config.holidays);
            return configured.length > 0 ? configured : DEFAULT_HOLIDAYS;
        })();
        const includeHoliday = config.riskHoliday !== false;
        
        const riskMatched: TransactionItem[] = [];
        const riskUnmatched: TransactionItem[] = [];
        // Per-criterion hit counts: they are the evidence that the reported
        // criteria are the ones the selection actually used. Each enabled
        // criterion is evaluated for every item, so an item can hit several.
        const criteriaHits = { weekend: 0, holiday: 0, closing: 0 };
        
        regularItems.forEach(item => {
            let isRisk = false;
            
            if (item.date && item.date.length >= 10) {
                const yyyy = parseInt(item.date.substring(0, 4), 10);
                const mm = parseInt(item.date.substring(5, 7), 10);
                const dd = parseInt(item.date.substring(8, 10), 10);
                
                if (includeWeekend) {
                    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
                    let y = yyyy;
                    if (mm < 3) y -= 1;
                    const dow = Math.floor(y + Math.floor(y/4) - Math.floor(y/100) + Math.floor(y/400) + t[mm-1] + dd) % 7;
                    if (dow === 0 || dow === 6) { isRisk = true; criteriaHits.weekend++; }
                }
                
                if (includeHoliday && isHoliday(item.date, holidayList)) {
                    isRisk = true;
                    criteriaHits.holiday++;
                }
                
                if (closingDays > 0) {
                    const isLeap = (yyyy % 4 === 0 && yyyy % 100 !== 0) || yyyy % 400 === 0;
                    const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
                    // "Last N days" means exactly N days: for N=2 in a 31-day
                    // month that is the 30th and the 31st, not the 29th too.
                    if ((dim - dd) < closingDays) {
                        isRisk = true;
                        criteriaHits.closing++;
                    }
                }
            }
            
            if (isRisk) {
                riskMatched.push(item);
            } else {
                riskUnmatched.push(item);
            }
        });
        riskCriteriaHits = criteriaHits;

        const riskSampled = riskMatched.slice(0, 5000).map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '' as const,
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Risk Criteria'
        }));
        
        sampleItems = sampleItems.concat(riskSampled as any);
        
        const randomCount = config.riskRandomCount ?? 5;
        const randomSampled = getRandomSamples(riskUnmatched, randomCount).map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '' as const,
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Random (Risk)'
        }));
        
        sampleItems = sampleItems.concat(randomSampled as any);
    } else {
        if (config.method === 'MUS') {
            const pm = config.tolerableMisstatement || 1;
            // ISA 530 / AICPA: знаменник зменшується на очікувані помилки,
            // зважені expansion factor. Захищаємо від нуля/від'ємного значення
            // (коли очікувані помилки наближаються до допустимого викривлення).
            const expectedMisstatement = config.expectedMisstatement || 0;
            const expansionFactor = getExpansionFactor(config.confidenceLevel);
            const denominator = Math.max(pm - expectedMisstatement * expansionFactor, pm * 0.01);
            sampleSize = Math.ceil((remPopValue * rf) / denominator);
            if (sampleSize > 5000) sampleSize = 5000;

            // Інтервал відбору узгоджуємо з фактичним (можливо обмеженим) розміром
            // вибірки, щоб MUS-петля давала саме sampleSize влучань.
            const interval = sampleSize > 0 && remPopValue > 0 ? remPopValue / sampleSize : Math.max(pm / rf, 1);

            let runningTotal = 0;
            let nextHit = rng.next() * interval;
            const picked = new Set<number>();
            
            for (let i = 0; i < regularItems.length; i++) {
                const item = regularItems[i];
                runningTotal += Math.abs(item.amount);
                while (runningTotal >= nextHit) {
                    picked.add(i);
                    nextHit += interval;
                    if (picked.size >= sampleSize) break;
                }
                if (picked.size >= sampleSize) break;
            }
            
            sampleItems = Array.from(picked).map((idx) => {
                const item = regularItems[idx];
                return {
                    ...item,
                    bookValue: item.amount,
                    auditedValue: '',
                    difference: item.amount,
                    tainting: 1,
                    isSampled: true,
                    selectionReason: 'MUS Hit'
                };
            });

        } else if (config.method === 'Systematic') {
            // Систематична вибірка з фіксованим кроком: i_n = старт + (n - 1) × k.
            // Старт = (seed mod N) + 1, де N — розмір залишкової сукупності.
            const step = Math.max(1, Math.floor(config.systematicStep || 10));
            const N = regularItems.length;
            const start = N > 0 ? (Math.floor(config.seed || 0) % N) + 1 : 1;
            sampleItems = [];
            for (let i = start - 1; i < regularItems.length; i += step) {
                const item = regularItems[i];
                sampleItems.push({
                    ...item,
                    bookValue: item.amount,
                    auditedValue: '',
                    difference: item.amount,
                    tainting: 1,
                    isSampled: true,
                    selectionReason: `Systematic (i=${i + 1})`
                });
                if (sampleItems.length >= 5000) break;
            }
            sampleSize = sampleItems.length;
        } else {
            if (config.method === 'FixedRandom') {
                sampleSize = config.fixedSampleSize || 10;
            } else if (config.method === 'StopOrGo') {
                sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
            } else if (config.method === 'Attribute') {
                // AICPA attribute table approximation: n ≈ -ln(alpha) / TDR
                // where alpha = 1 − confidence, TDR = tolerable deviation rate.
                const tdr = (config.tolerableDeviationRate ?? 5) / 100;
                const edr = (config.expectedDeviationRate ?? 0) / 100;
                const alphaAttr = 1 - config.confidenceLevel / 100;
                const rfAttr = -Math.log(alphaAttr); // Poisson RF at zero expected deviations
                const denominatorAttr = Math.max(tdr - edr, tdr * 0.01);
                sampleSize = Math.ceil(rfAttr / denominatorAttr);
            } else if (config.method === 'CVS' || config.method === 'Random') {
                // Classical Variables / Random: n = (z × σ / E)² with finite-population correction.
                // σ is the standard deviation of individual item amounts in the residual population.
                // E (precision) ≈ PM / N_rem (mean-per-unit precision).
                const z = getZScore(config.confidenceLevel);
                const N_rem = regularItems.length;
                if (N_rem > 1) {
                    const mean = remPopValue / N_rem;
                    const variance = regularItems.reduce((acc, it) => acc + Math.pow(Math.abs(it.amount) - mean, 2), 0) / (N_rem - 1);
                    const sigma = Math.sqrt(variance);
                    const pm = config.tolerableMisstatement || remPopValue * 0.01;
                    // Desired precision = PM / sqrt(N_rem) gives a per-unit precision;
                    // alternatively: E = PM / N_rem for total error bound.
                    const E = pm / N_rem; // tolerable mean error per item
                    const n0 = Math.pow(z * sigma / E, 2); // infinite-population size
                    // Finite-population correction (FPC):
                    sampleSize = Math.ceil(n0 / (1 + n0 / N_rem));
                } else {
                    sampleSize = N_rem;
                }
            } else {
                sampleSize = config.fixedSampleSize || 25;
            }
            
            if (sampleSize > 5000) sampleSize = 5000;
            if (sampleSize > regularItems.length) sampleSize = regularItems.length;

            sampleItems = getRandomSamples(regularItems, sampleSize).map((item, idx) => ({
                ...item,
                bookValue: item.amount,
                auditedValue: '',
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: config.method === 'StopOrGo' ? (idx < (config.stopOrGoInitialSize || 25) ? 'Stage 1' : 'Stage 2') : 'Sampled'
            }));
        }
    }

    const interval = sampleItems.length > 0 ? (remPopValue / sampleItems.length) : 1;

    const preResult: SamplingResult = {
        populationSize: population.length,
        populationValue: popValue,
        trivialCount: trivialCount,
        trivialValue: trivialValue,
        areTrivialExcluded: true,
        sampleSize: sampleItems.length,
        sampleValue: sampleItems.reduce((acc, curr) => acc + curr.bookValue, 0),
        samplingInterval: interval,
        keyItems,
        samplingItems: sampleItems,
        excludedItems: trivialItems,
        projectedMisstatement: 0,
        upperMisstatementBound: 0,
        riskCriteriaHits
    };

    const calculated = calculateExtrapolation(preResult, config);
    preResult.projectedMisstatement = calculated.projected;
    preResult.upperMisstatementBound = calculated.ub;

    return preResult;
}
