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

export function smartFormat(val: any, settings?: GlobalSettings): string {
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
        let diff = item.difference || 0;
        let tainting = item.bookValue !== 0 ? diff / item.bookValue : 0;
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
    
    population.forEach((item) => {
        if (config.clearlyTrivialThreshold && Math.abs(item.amount) < config.clearlyTrivialThreshold) {
            trivialItems.push(item);
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
    const remPopValue = popValue - keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0) - trivialItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0);
    
    if (config.method === 'MUS') {
        const pm = config.tolerableMisstatement || 1;
        sampleSize = Math.ceil((remPopValue * rf) / pm);
    } else if (config.method === 'FixedRandom') {
        sampleSize = config.fixedSampleSize || 10;
    } else if (config.method === 'StopOrGo') {
        sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
    } else if (config.method === 'RiskAssessment') {
        sampleSize = config.riskRandomCount || 5;
    } else if (config.method === 'Attribute') {
        sampleSize = 25; // simplified
    } else {
        sampleSize = config.fixedSampleSize || 25; // fallback for others like CVS, Random
    }

    if (sampleSize > regularItems.length) sampleSize = regularItems.length;

    // Shuffle regular items for random selection
    const shuffled = [...regularItems].sort(() => 0.5 - Math.random());
    
    const sampleItems: SampledItem[] = shuffled.slice(0, sampleSize).map((item, idx) => ({
        ...item,
        bookValue: item.amount,
        auditedValue: '',
        difference: item.amount,
        tainting: 1,
        isSampled: true,
        selectionReason: config.method === 'StopOrGo' ? (idx < (config.stopOrGoInitialSize || 25) ? 'Stage 1' : 'Stage 2') : 'Sampled'
    }));

    const interval = sampleItems.length > 0 ? (remPopValue / sampleItems.length) : 1;
    
    // rf already defined

    // rf already defined

    const preResult: SamplingResult = {
        populationSize: population.length,
        populationValue: popValue,
        trivialCount: trivialItems.length,
        trivialValue: trivialItems.reduce((acc, curr) => acc + curr.amount, 0),
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
