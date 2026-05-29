import { ProjectState, SamplingConfig, SamplingResult, GlobalSettings, ColumnIndices } from '../types';

export function reconstructProjectState(payload: any, settings: GlobalSettings): ProjectState {
    const { samplingItems, keyItems, population, sourceHeaders, summaryData } = payload;
    
    // Create dummy config since we cannot perfectly extract it from string descriptions reliably
    // The user just wants to see the Results step table with their data.
    // Prefer the lossless machine-readable config snapshot embedded in the
    // summary sheet. Fall back to values reverse-engineered from text labels.
    const config: SamplingConfig = summaryData?.config
        ? { ...summaryData.config }
        : {
            method: summaryData?.method || 'MUS', // Extracted from Excel or fallback
            anomalyMethod: 'None',
            confidenceLevel: summaryData?.confidenceLevel || 95,
            tolerableMisstatement: summaryData?.tolerableMisstatement || 0,
            expectedMisstatement: 0,
            clearlyTrivialThreshold: 0,
            riskFactor: 'Moderate'
        };

    const popValue = summaryData?.populationValue || population.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
    const keysValue = (keyItems || []).reduce((sum: number, i: any) => sum + (i.bookValue || 0), 0);
    const sSize = summaryData?.sampleSize || samplingItems.length;
    
    // Reverse engineer interval so any edits to audited values properly recalculate projected misstatements.
    // (popValue - keysValue) / sSize is the robust calculation for MUS that does not depend on confidence level.
    let recoveredInterval = sSize > 0 ? ((popValue - keysValue) / sSize) : 0;

    const results: SamplingResult = {
        populationSize: summaryData?.populationSize || population.length || 0,
        populationValue: popValue,
        trivialCount: summaryData?.trivialCount || 0,
        trivialValue: 0,
        areTrivialExcluded: true,
        sampleSize: sSize,
        sampleValue: samplingItems.reduce((sum: number, i: any) => sum + (i.amount || 0), 0),
        samplingInterval: recoveredInterval,
        keyItems: keyItems || [],
        samplingItems: samplingItems || [],
        projectedMisstatement: summaryData?.projectedMisstatement || 0,
        upperMisstatementBound: summaryData?.upperMisstatementBound || 0
    };

    const colIndices: ColumnIndices = {
        id: 0,
        date: -1,
        amount: sourceHeaders.length > 0 ? sourceHeaders.length - 1 : 0
    };

    return {
        version: 'imported',
        timestamp: new Date().toISOString(),
        settings,
        config,
        population: population || [],
        results,
        sourceHeaders: sourceHeaders || [],
        columnIndices: colIndices
    };
}
