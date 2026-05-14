import { TransactionItem, SamplingConfig, SamplingResult, SampledItem, GlobalSettings } from '../types';

export const methodsSupportingAnomalies = ['MUS', 'CVS', 'Random', 'FixedRandom'];

export function formatMoney(val: number, settings: GlobalSettings): string {
    return new Intl.NumberFormat(settings.region === 'us' ? 'en-US' : 'uk-UA', { 
        style: 'decimal', 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    }).format(val);
}

export function formatDate(val: string, settings?: GlobalSettings): string {
    if (!val) return val;
    const parts = val.split('-');
    if (parts.length === 3) {
        const date = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
        return new Intl.DateTimeFormat(settings?.region === 'us' ? 'en-US' : 'uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(date);
    }
    return val;
}

export function smartFormat(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return val.toString();
        return val.toFixed(2);
    }
    return String(val);
}

export function calculateExtrapolation(results: SamplingResult, config: SamplingConfig): { projected: number, ub: number } {
    let rf = 3.0; // 95% default
    if (config.confidenceLevel === 70) rf = 1.20;
    else if (config.confidenceLevel === 80) rf = 1.61;
    else if (config.confidenceLevel === 90) rf = 2.31;
    else if (config.confidenceLevel === 95) rf = 3.00;
    else if (config.confidenceLevel === 99) rf = 4.61;

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
    let ub = (results.samplingInterval * rf) + pm;

    if (config.method === 'Attribute') {
        const errors = (results.samplingItems || []).filter(item => Math.abs(item.difference || 0) > 0.001).length;
        const total = (results.samplingItems || []).length || 1;
        pm = (errors / total) * 100;
        ub = ((errors + rf) / total) * 100;
    } else if (config.method === 'RiskAssessment' || config.method === 'FixedRandom' || config.method === 'Pareto' || config.method === 'Percentile' || config.method === 'Grubbs' || config.method === 'Benford' || config.method === 'StopOrGo') {
        pm = keyMisstatements + (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
        ub = pm;
    } else if (config.method === 'Random' || config.method === 'CVS' || config.method === 'Cluster') {
        const sampleErrors = (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
        const n = results.samplingItems?.length || 1;
        const N_rem = results.populationSize - (results.keyItems?.length || 0) - (results.trivialCount || 0);
        const meanDiff = sampleErrors / n;
        
        pm = keyMisstatements + (meanDiff * N_rem);
        
        if (config.method === 'Random' || config.method === 'CVS' || config.method === 'Cluster') {
            let variance = (results.samplingItems || []).reduce((acc, item) => acc + Math.pow((item.difference || 0) - meanDiff, 2), 0);
            if (n > 1) {
                variance = variance / (n - 1);
            }
            const stdErr = N_rem * Math.sqrt(variance) / Math.sqrt(n);
            const zScore = config.confidenceLevel === 70 ? 1.04 : (config.confidenceLevel === 80 ? 1.28 : (config.confidenceLevel === 90 ? 1.64 : (config.confidenceLevel === 95 ? 1.96 : (config.confidenceLevel === 99 ? 2.58 : 1.96))));
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
        } else if (config.tolerableMisstatement && Math.abs(item.amount) >= config.tolerableMisstatement) {
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

    let rf = 3.0; // 95% default
    if (config.confidenceLevel === 70) rf = 1.20;
    else if (config.confidenceLevel === 80) rf = 1.61;
    else if (config.confidenceLevel === 90) rf = 2.31;
    else if (config.confidenceLevel === 95) rf = 3.00;
    else if (config.confidenceLevel === 99) rf = 4.61;

    let sampleSize = 10;
    const remPopValue = popValue - keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0) - Math.abs(trivialValue);
    
    let sampleItems: SampledItem[] = [];

    const getRandomSamples = <T>(array: T[], count: number): T[] => {
        const result: T[] = [];
        const n = array.length;
        count = Math.min(count, n);
        if (count === 0) return result;
        
        if (n > 10000 && count < 1000) {
            const picked = new Set<number>();
            while(picked.size < count) {
                picked.add(Math.floor(Math.random() * n));
            }
            for (const idx of picked) {
                result.push(array[idx]);
            }
        } else {
            const copy = array.slice();
            for(let i=0; i<count; i++) {
                const r = i + Math.floor(Math.random() * (n - i));
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
        
        const UA_HOLIDAYS = new Set(['01-01', '03-08', '05-01', '05-08', '05-09', '06-28', '08-24', '10-01', '12-25']);
        const includeHoliday = config.riskHoliday !== false;
        
        const riskMatched: TransactionItem[] = [];
        const riskUnmatched: TransactionItem[] = [];
        
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
                    if (dow === 0 || dow === 6) isRisk = true;
                }
                
                if (!isRisk && includeHoliday) {
                    const strMMDD = item.date.substring(5, 10);
                    if (UA_HOLIDAYS.has(strMMDD)) isRisk = true;
                }
                
                if (!isRisk && closingDays > 0) {
                    const isLeap = (yyyy % 4 === 0 && yyyy % 100 !== 0) || yyyy % 400 === 0;
                    const dim = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
                    if ((dim - dd) <= closingDays) {
                        isRisk = true;
                    }
                }
            }
            
            if (isRisk) {
                riskMatched.push(item);
            } else {
                riskUnmatched.push(item);
            }
        });

        const riskSampled = riskMatched.slice(0, 5000).map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '',
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Risk Criteria'
        }));
        
        sampleItems = sampleItems.concat(riskSampled);
        
        const randomCount = config.riskRandomCount ?? 5;
        const randomSampled = getRandomSamples(riskUnmatched, randomCount).map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '',
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Random (Risk)'
        }));
        
        sampleItems = sampleItems.concat(randomSampled);
    } else {
        if (config.method === 'MUS') {
            const pm = config.tolerableMisstatement || 1;
            sampleSize = Math.ceil((remPopValue * rf) / pm);
        } else if (config.method === 'FixedRandom') {
            sampleSize = config.fixedSampleSize || 10;
        } else if (config.method === 'StopOrGo') {
            sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
        } else if (config.method === 'Attribute') {
            sampleSize = 25; // simplified
        } else {
            sampleSize = config.fixedSampleSize || 25; // fallback for others like CVS, Random
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

    const interval = sampleItems.length > 0 ? (remPopValue / sampleItems.length) : 1;
    
    // rf already defined

    // rf already defined

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
        upperMisstatementBound: 0
    };

    const calculated = calculateExtrapolation(preResult, config);
    preResult.projectedMisstatement = calculated.projected;
    preResult.upperMisstatementBound = calculated.ub;

    return preResult;
}
