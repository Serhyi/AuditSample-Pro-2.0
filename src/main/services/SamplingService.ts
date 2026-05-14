import { DatabaseService } from './DatabaseService';

export class SamplingService {
  constructor(private db: DatabaseService) {}

  public async runSampling(config: any): Promise<any> {
    console.log('SamplingService executing SQL-based sampling via DuckDB...', config.method);

    // 1. Get total population size and value
    const popAgg: any[] = await this.db.query(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val FROM population`);
    const popSize = popAgg[0]?.cnt || 0;
    const popValue = popAgg[0]?.val || 0;

    if (popSize === 0) {
      throw new Error('Population cannot be empty');
    }

    const tm = config.tolerableMisstatement || 0;
    const ctt = config.clearlyTrivialThreshold || 0;

    // 2. Trivial items
    let trivialCount = 0;
    let trivialValue = 0;
    let trivialItems: any[] = [];
    if (ctt > 0) {
      const trivAgg: any[] = await this.db.query(`SELECT COUNT(*) as cnt, SUM(amount) as val FROM population WHERE ABS(amount) < ?`, [ctt]);
      trivialCount = trivAgg[0]?.cnt || 0;
      trivialValue = trivAgg[0]?.val || 0;
      trivialItems = await this.db.query(`SELECT * FROM population WHERE ABS(amount) < ? LIMIT 10`, [ctt]);
    }

    // 3. Key items
    let keyItems: any[] = [];
    if (tm > 0) {
      keyItems = await this.db.query(`SELECT * FROM population WHERE ABS(amount) >= ?`, [tm]);
      keyItems = keyItems.map(item => ({
        ...item,
        bookValue: item.amount,
        auditedValue: '',
        difference: item.amount,
        tainting: 1,
        isKeyItem: true
      }));
    }

    const keyItemsValue = keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0);
    const remPopValue = popValue - keyItemsValue - Math.abs(trivialValue);

    let rf = 3.0;
    if (config.confidenceLevel === 70) rf = 1.20;
    else if (config.confidenceLevel === 80) rf = 1.61;
    else if (config.confidenceLevel === 90) rf = 2.31;
    else if (config.confidenceLevel === 95) rf = 3.00;
    else if (config.confidenceLevel === 99) rf = 4.61;

    let sampleItems: any[] = [];
    
    if (config.method === 'RiskAssessment') {
        const closingDays = config.riskClosingDays ?? 5;
        const includeWeekend = config.riskWeekend !== false;
        const includeHoliday = config.riskHoliday !== false;
        
        const riskQueryConds = [];
        if (includeWeekend) {
            riskQueryConds.push(`DAYOFWEEK(CAST(date AS DATE)) IN (0, 6)`);
        }
        if (includeHoliday) {
            riskQueryConds.push(`strftime(CAST(date AS DATE), '%m-%d') IN ('01-01', '03-08', '05-01', '05-08', '05-09', '06-28', '08-24', '10-01', '12-25')`);
        }
        if (closingDays > 0) {
            // DuckDB last_day works for end of month
            riskQueryConds.push(`date_diff('day', CAST(date AS DATE), last_day(CAST(date AS DATE))) <= ${closingDays}`);
        }
        
        const riskWhereStr = riskQueryConds.length > 0 ? `(${riskQueryConds.join(' OR ')})` : 'FALSE';
        
        // Find risk matched
        const riskMatchedQuery = `
          SELECT * FROM population 
          WHERE ABS(amount) < ? AND ABS(amount) >= ? AND ${riskWhereStr}
          LIMIT 5000
        `;
        const riskMatched = await this.db.query(riskMatchedQuery, [tm > 0 ? tm : 999999999999, ctt]);
        
        for (const item of riskMatched) {
            sampleItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '',
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: 'Risk Criteria'
            });
        }
        
        // Find risk unmatched (random ones)
        const randomCount = config.riskRandomCount ?? 5;
        const riskUnmatchedQuery = `
          SELECT * FROM population 
          WHERE ABS(amount) < ? AND ABS(amount) >= ? AND NOT ${riskWhereStr}
          ORDER BY random() 
          LIMIT ?
        `;
        const randomMatched = await this.db.query(riskUnmatchedQuery, [tm > 0 ? tm : 999999999999, ctt, randomCount]);
        
        for (const item of randomMatched) {
            sampleItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '',
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: 'Random (Risk)'
            });
        }
        
    } else {
        let sampleSize = 10;
        if (config.method === 'MUS') {
          const pm = config.tolerableMisstatement || 1;
          sampleSize = Math.ceil((remPopValue * rf) / Math.max(pm, 0.01));
        } else if (config.method === 'FixedRandom') {
          sampleSize = config.fixedSampleSize || 10;
        } else if (config.method === 'StopOrGo') {
          sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
        } else if (config.method === 'Attribute') {
          sampleSize = 25;
        } else {
          sampleSize = config.fixedSampleSize || 25;
        }

        // Adjust sample size against remaining population size limit
        const remPopSize = popSize - keyItems.length - trivialCount;
        if (sampleSize > remPopSize) sampleSize = remPopSize;
        if (sampleSize > 5000) sampleSize = 5000;

        // 4. Regular items sampled using SQL Random ordering
        const sampleItemsQuery = `
          SELECT * FROM population 
          WHERE ABS(amount) < ? AND ABS(amount) >= ?
          ORDER BY random() 
          LIMIT ?
        `;
        const rawSampleItems: any[] = await this.db.query(sampleItemsQuery, [tm > 0 ? tm : 999999999999, ctt, sampleSize]);

        sampleItems = rawSampleItems.map((item, idx) => ({
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

    const preResult = {
      populationSize: popSize,
      populationValue: popValue,
      trivialCount,
      trivialValue,
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
    
    // Defer complex extrapolation to the same code path or replicate here
    // For now we will replicate the basic math logic here rather than importing React dependencies from UI
    return this.calculateExtrapolation(preResult, config, rf);
  }

  private calculateExtrapolation(results: any, config: any, rf: number): any {
    let pm = 0;
    
    const keyMisstatements = (results.keyItems || []).reduce((acc: any, item: any) => acc + (item.difference || 0), 0);
    
    const sampleProjected = (results.samplingItems || []).reduce((acc: any, item: any) => {
        const diff = item.difference || 0;
        const tainting = item.bookValue !== 0 ? diff / item.bookValue : 0;
        return acc + (tainting * results.samplingInterval);
    }, 0);

    pm = keyMisstatements + sampleProjected;
    let ub = (results.samplingInterval * rf) + pm;

    if (config.method === 'Attribute') {
        const errors = (results.samplingItems || []).filter((item: any) => Math.abs(item.difference || 0) > 0.001).length;
        const total = (results.samplingItems || []).length || 1;
        pm = (errors / total) * 100;
        ub = ((errors + rf) / total) * 100;
    } else if (['RiskAssessment', 'FixedRandom', 'Pareto', 'Percentile', 'Grubbs', 'Benford', 'StopOrGo'].includes(config.method)) {
        pm = keyMisstatements + (results.samplingItems || []).reduce((acc: any, item: any) => acc + (item.difference || 0), 0);
        ub = pm;
    } else if (['Random', 'CVS', 'Cluster'].includes(config.method)) {
        const sampleErrors = (results.samplingItems || []).reduce((acc: any, item: any) => acc + (item.difference || 0), 0);
        const n = results.samplingItems?.length || 1;
        const N_rem = results.populationSize - (results.keyItems?.length || 0) - (results.trivialCount || 0);
        const meanDiff = sampleErrors / n;
        
        pm = keyMisstatements + (meanDiff * N_rem);
        
        let variance = (results.samplingItems || []).reduce((acc: any, item: any) => acc + Math.pow((item.difference || 0) - meanDiff, 2), 0);
        if (n > 1) {
            variance = variance / (n - 1);
        }
        const stdErr = N_rem * Math.sqrt(variance) / Math.sqrt(n);
        const zScore = config.confidenceLevel === 70 ? 1.04 : (config.confidenceLevel === 80 ? 1.28 : (config.confidenceLevel === 90 ? 1.64 : (config.confidenceLevel === 95 ? 1.96 : (config.confidenceLevel === 99 ? 2.58 : 1.96))));
        ub = pm + Math.abs(zScore * stdErr);
    }

    results.projectedMisstatement = pm;
    results.upperMisstatementBound = ub;
    return results;
  }
}

