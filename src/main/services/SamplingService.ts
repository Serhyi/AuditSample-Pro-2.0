import { DatabaseService } from './DatabaseService';
import { getReliabilityFactor, getZScore } from '../../statistics/reliabilityFactor';

export class SamplingService {
  constructor(private db: DatabaseService) {}

    private async getRandomSample(whereClause: string, params: any[], sampleSize: number): Promise<any[]> {
        // Find total matching count first
        const countAgg = await this.db.query(`SELECT COUNT(*) as cnt FROM population WHERE ${whereClause}`, params);
        const total = countAgg[0]?.cnt || 0;
        if (total === 0) return [];

        // Calculate probability multiplier to fetch slightly more than we need
        // E.g. we want 25 items from 100,000, we pull ~150 to randomize.
        const poolSize = Math.max(sampleSize * 5, 200);
        let prob = poolSize / total;
        if (prob >= 1) {
            prob = 1; // Fetch all if total is small
        }

        // P is probability out of 1,000,000 to avoid floats in modulo
        const pThreshold = Math.ceil(prob * 1000000);

        // Fetch a pool of IDs using random modulus matching
        // (ABS(RANDOM()) % 1000000) generates number from 0 to 999999
        let poolIds: number[] = [];
        if (prob < 1) {
            const poolQuery = `SELECT rowid FROM population WHERE ${whereClause} AND (ABS(RANDOM()) % 1000000) < ${pThreshold}`;
            const poolResults = await this.db.query(poolQuery, params);
            poolIds = poolResults.map((r: any) => r.rowid);
        }

        // If the pool somehow is smaller than sampleSize (due to RNG variance), fallback to fetching all IDs
        if (poolIds.length < sampleSize) {
           const fallbackQuery = `SELECT rowid FROM population WHERE ${whereClause}`;
           const fallbackResults = await this.db.query(fallbackQuery, params);
           poolIds = fallbackResults.map((r: any) => r.rowid);
        }

        // Shuffle in JS O(N)
        for (let i = poolIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [poolIds[i], poolIds[j]] = [poolIds[j], poolIds[i]];
        }

        // Slice to required size
        const pickedRowIds = poolIds.slice(0, sampleSize);
        if (pickedRowIds.length === 0) return [];

        // Fetch actual items
        const results: any[] = [];
        const chunkSize = 500;
        for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
            const chunk = pickedRowIds.slice(i, i + chunkSize);
            const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(',')})`);
            results.push(...chunkResults);
        }
        return results;
    }

  public async runSampling(config: any, onProgress?: (stage: string) => void): Promise<any> {
    const updateProgress = async (stage: string) => {
      if (onProgress) {
          onProgress(stage);
          // Yield to let the main thread flush IPC before blocking on synchronous steps
          await new Promise(resolve => setTimeout(resolve, 30));
      }
    };

    if (!this.db || !this.db.isInitialized()) {
      throw new Error('Database not initialized. Please import population data or load a project first.');
    }
    console.log('SamplingService executing SQL-based sampling via SQLite...', config.method);
    await updateProgress('Підготовка бази даних...');

    // Attempt to create indices if they don't exist yet (important if loaded from an old file)
    try {
      await this.db.execute('CREATE INDEX IF NOT EXISTS idx_abs_amount ON population(ABS(amount));');
      await this.db.execute('CREATE INDEX IF NOT EXISTS idx_amount ON population(amount);');
    } catch (e) {
      console.error('Failed to create indices during sampling prep:', e);
    }

    // 1. Get total population size and value
    await updateProgress('Обчислення генеральної сукупності...');
    const popAgg: any[] = await this.db.query(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val FROM population`);
    const popSize = popAgg[0]?.cnt || 0;
    const popValue = popAgg[0]?.val || 0;

    if (popSize === 0) {
      throw new Error('Population cannot be empty');
    }

    const tm = Number(config.tolerableMisstatement) || 0;
    const ctt = Number(config.clearlyTrivialThreshold) || 0;
    const isAnomalyDisabled = config.anomalyMethod === 'None';
    // Only extract key items for these variable/stratified approaches. 
    // It shouldn't be extracted for MUS, StopOrGo, Attribute, Pareto, etc.
    const allowedMethodsForKeyItems = ['Random', 'FixedRandom', 'CVS', 'Cluster', 'RiskAssessment'];
    const excludeKeyItems = !isAnomalyDisabled && tm > 0 && allowedMethodsForKeyItems.includes(config.method);
    const upperLimit = excludeKeyItems ? tm : 999999999999;

    // 2. Trivial items
    let trivialCount = 0;
    let trivialValue = 0;
    let trivialItems: any[] = [];
    if (ctt > 0) {
      await updateProgress('Відбір тривіальних елементів...');
      const trivAgg: any[] = await this.db.query(`SELECT COUNT(*) as cnt, SUM(amount) as val FROM population WHERE ABS(amount) < ?`, [ctt]);
      trivialCount = trivAgg[0]?.cnt || 0;
      trivialValue = trivAgg[0]?.val || 0;
      const items = await this.db.query(`SELECT * FROM population WHERE ABS(amount) < ? LIMIT 10`, [ctt]);
      trivialItems = items.map((i: any) => ({
          ...i,
          originalRow: typeof i.originalRow === 'string' ? JSON.parse(i.originalRow) : (i.originalRow || [])
      }));
    }

    // 3. Key items
    let keyItems: any[] = [];
    if (excludeKeyItems) {
      await updateProgress('Відбір ключових елементів...');
      keyItems = await this.db.query(`SELECT * FROM population WHERE ABS(amount) >= ? LIMIT 5000`, [tm]);
      keyItems = keyItems.map(item => ({
        ...item,
        originalRow: item.originalRow ? JSON.parse(item.originalRow) : [],
        bookValue: item.amount,
        auditedValue: '' as const,
        difference: item.amount,
        tainting: 1,
        isKeyItem: true
      }));
    }

    const keyItemsValue = keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0);
    const remPopValue = popValue - keyItemsValue - Math.abs(trivialValue);

    const rf = getReliabilityFactor(config.confidenceLevel);

    let sampleItems: any[] = [];
    
    await updateProgress('Застосування методу відбору...');
    if (config.method === 'RiskAssessment') {
        const closingDays = config.riskClosingDays ?? 5;
        const includeWeekend = config.riskWeekend !== false;
        const includeHoliday = config.riskHoliday !== false;
        
        const riskQueryConds = [];
        if (includeWeekend) {
            riskQueryConds.push(`CAST(strftime('%w', date) AS INTEGER) IN (0, 6)`);
        }
        if (includeHoliday) {
            riskQueryConds.push(`strftime('%m-%d', date) IN ('01-01', '03-08', '05-01', '05-08', '05-09', '06-28', '08-24', '10-01', '12-25')`);
        }
        if (closingDays > 0) {
            // SQLite last_day logic using start of next month - 1 day
            riskQueryConds.push(`(julianday(date(date, 'start of month', '+1 month', '-1 day')) - julianday(date)) <= ${closingDays}`);
        }
        
        const riskWhereStr = riskQueryConds.length > 0 ? `(${riskQueryConds.join(' OR ')})` : 'FALSE';
        
        // Find risk matched
        const riskMatchedQuery = `
          SELECT * FROM population 
          WHERE ABS(amount) < ? AND ABS(amount) >= ? AND ${riskWhereStr}
          LIMIT 5000
        `;
        const riskMatched: any[] = await this.db.query(riskMatchedQuery, [upperLimit, ctt]);
        
        for (const item of riskMatched) {
            sampleItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '' as const,
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: 'Risk Criteria'
            });
        }
        
        // Find risk unmatched (random ones)
        const randomCount = config.riskRandomCount ?? 5;
        const riskUnmatchedWhere = `ABS(amount) < ? AND ABS(amount) >= ? AND NOT ${riskWhereStr}`;
        const randomMatched: any[] = await this.getRandomSample(riskUnmatchedWhere, [upperLimit, ctt], randomCount);
        
        for (const item of randomMatched) {
            sampleItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '' as const,
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: 'Random (Risk)'
            });
        }
        
    } else if (config.method === 'Pareto') {
        await updateProgress('Аналіз розподілу Парето (визначення 80% вартості)...');
        const targetPercent = (config.paretoCoverage || 80) / 100;
        const targetValue = remPopValue * targetPercent;
        
        await updateProgress('Вибір найбільших елементів таблиці...');
        const paretoItemsQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY ABS(amount) DESC`;
        const pickedRowIds = await this.db.MUS_and_Pareto_Helpers.getParetoPickedRows(paretoItemsQuery, [upperLimit, ctt], targetValue);
        
        if (pickedRowIds.length > 0) {
            await updateProgress(`Отримання даних вибраних елементів (${pickedRowIds.length})...`);
            const results: any[] = [];
            const chunkSize = 500;
            for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
                const chunk = pickedRowIds.slice(i, i + chunkSize);
                const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(',')})`);
                results.push(...chunkResults);
            }
            sampleItems = results.map(item => ({
                ...item,
                bookValue: item.amount,
                auditedValue: '' as const,
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: 'Pareto (Top 80%)'
            }));
        }

    } else if (config.method === 'Percentile') {
        const percent = config.percentileCount || 5;
        const limitCount = Math.max(1, Math.ceil((popSize * percent) / 100)); // from each tail
        
        const topQuery = `SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY amount DESC LIMIT ?`;
        const bottomQuery = `SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY amount ASC LIMIT ?`;
        
        const topItems: any[] = await this.db.query(topQuery, [upperLimit, ctt, limitCount]);
        const bottomItems: any[] = await this.db.query(bottomQuery, [upperLimit, ctt, limitCount]);
        
        const combined = [...topItems, ...bottomItems];
        // Deduplicate
        const uniqueSet = new Set();
        for (const item of combined) {
            if (!uniqueSet.has(item.id)) {
                uniqueSet.add(item.id);
                sampleItems.push({
                    ...item,
                    bookValue: item.amount,
                    auditedValue: '' as const,
                    difference: item.amount,
                    tainting: 1,
                    isSampled: true,
                    selectionReason: 'Percentile Tail'
                });
            }
        }
        
    } else if (config.method === 'Benford') {
        const benfordCount = config.benfordSampleSize || 50;
        const whereCond = `ABS(amount) < ? AND ABS(amount) >= ?`;
        const items: any[] = await this.getRandomSample(whereCond, [upperLimit, ctt], benfordCount);
        sampleItems = items.map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '' as const,
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Benford Review'
        }));

    } else if (config.method === 'Grubbs') {
        const grubbsItems: any[] = await this.db.query(`SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY ABS(amount) DESC LIMIT 15`, [upperLimit, ctt]);
        sampleItems = grubbsItems.map(item => ({
            ...item,
            bookValue: item.amount,
            auditedValue: '' as const,
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: 'Grubbs Outlier'
        }));

    } else {
        let sampleSize = 10;
        let isMUS = false;
        
        if (config.method === 'MUS') {
          isMUS = true;
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

        const remPopSize = popSize - keyItems.length - trivialCount;
        if (sampleSize > remPopSize) sampleSize = remPopSize;
        if (sampleSize > 5000) sampleSize = 5000;

        if (isMUS) {
            await updateProgress('Розрахунок інтервалу для Монетарної вибірки...');
            const pm = config.tolerableMisstatement || 1;
            const interval = Math.max(pm / rf, 1);
            
            await updateProgress(`Застосування інтервалу (${interval.toFixed(2)})...`);
            const musQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY rowid`;
            const pickedRowIds = await this.db.MUS_and_Pareto_Helpers.getMUSPickedRows(musQuery, [upperLimit, ctt], interval, sampleSize);

            if (pickedRowIds.length > 0) {
                await updateProgress(`Отримання даних вибраних елементів (${pickedRowIds.length})...`);
                const results: any[] = [];
                const chunkSize = 500;
                for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
                    const chunk = pickedRowIds.slice(i, i + chunkSize);
                    const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(',')})`);
                    results.push(...chunkResults);
                }
                sampleItems = results.map(item => ({
                    ...item,
                    bookValue: item.amount,
                    auditedValue: '' as const,
                    difference: item.amount,
                    tainting: 1,
                    isSampled: true,
                    selectionReason: 'MUS Hit'
                }));
            }
        } else {
            await updateProgress(`Виконання випадкового вибору (${sampleSize} елементів)...`);
            const whereStr = `ABS(amount) < ? AND ABS(amount) >= ?`;
            const rawSampleItems: any[] = await this.getRandomSample(whereStr, [upperLimit, ctt], sampleSize);
    
            sampleItems = rawSampleItems.map((item, idx) => ({
              ...item,
              bookValue: item.amount,
              auditedValue: '' as const,
              difference: item.amount,
              tainting: 1,
              isSampled: true,
              selectionReason: config.method === 'StopOrGo' ? (idx < (config.stopOrGoInitialSize || 25) ? 'Stage 1' : 'Stage 2') : 'Sampled'
            }));
        }
    }

    await updateProgress('Формування результатів...');

    sampleItems = sampleItems.map(item => ({
      ...item,
      originalRow: typeof item.originalRow === 'string' ? JSON.parse(item.originalRow) : (item.originalRow || [])
    }));

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
    
    // In MUS, Basic Precision should equal Materiality (Tolerable Misstatement) when sample is planned ideally.
    // We use Tolerable Misstatement for the Basic Precision if available, otherwise fallback.
    const basicPrecision = config.method === 'MUS' && config.tolerableMisstatement > 0 
        ? config.tolerableMisstatement 
        : (results.samplingInterval * rf);
        
    let ub = basicPrecision + pm;

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
        const zScore = getZScore(config.confidenceLevel);
        ub = pm + Math.abs(zScore * stdErr);
    }

    results.projectedMisstatement = pm;
    results.upperMisstatementBound = ub;
    return results;
  }
}

