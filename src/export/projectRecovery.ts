import { ProjectState, SamplingConfig, SamplingResult, GlobalSettings, ColumnIndices } from '../types';

export function reconstructProjectState(payload: any, settings: GlobalSettings): ProjectState {
    const { samplingItems, keyItems, population, sourceHeaders, summaryData } = payload;
    
    // Create dummy config since we cannot perfectly extract it from string descriptions reliably
    // The user just wants to see the Results step table with their data.
    const config: SamplingConfig = {
        method: 'MUS', // fallback
        anomalyMethod: 'None',
        confidenceLevel: 95,
        tolerableMisstatement: 0,
        expectedMisstatement: 0,
        clearlyTrivialThreshold: 0,
        riskFactor: 'Moderate'
    };

    const results: SamplingResult = {
        populationSize: summaryData?.populationSize || population.length || 0,
        populationValue: summaryData?.populationValue || population.reduce((sum: number, i: any) => sum + (i.amount || 0), 0),
        trivialCount: summaryData?.trivialCount || 0,
        trivialValue: 0,
        areTrivialExcluded: true,
        sampleSize: summaryData?.sampleSize || samplingItems.length,
        sampleValue: samplingItems.reduce((sum: number, i: any) => sum + (i.amount || 0), 0),
        samplingInterval: 0,
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
