import { DatabaseService } from './DatabaseService';
import { getReliabilityFactor, getZScore, getExpansionFactor } from '../../statistics/reliabilityFactor';
import { Mulberry32 } from '../../statistics/prng';
import { DEFAULT_HOLIDAYS, sanitizeHolidays, splitHolidays } from '../../utils/holidays';
import { allocateRiskSample, autoRandomCount, riskReasonLabel, RiskFlags, RiskCounts } from '../../utils/riskSelection';

export class SamplingService {
  constructor(private db: DatabaseService) {}

  /**
   * SQL for the risk criteria, one condition per criterion. Shared by the run
   * and by the settings preview so the counts shown before running are the
   * counts the run will use.
   */
  static buildRiskConditions(config: any) {
    const closingDays = config.riskClosingDays ?? 5;
    const includeWeekend = config.riskWeekend !== false;
    const includeHoliday = config.riskHoliday !== false;

    const riskQueryConds: string[] = [];
    const weekendCond = `CAST(strftime('%w', date) AS INTEGER) IN (0, 6)`;
    const holidayConds: string[] = [];
    let closingCond = '';

    if (includeWeekend) riskQueryConds.push(weekendCond);
    if (includeHoliday) {
      // sanitizeHolidays() is what makes inlining these safe: it accepts only
      // 'MM-DD' / 'YYYY-MM-DD', so nothing else can reach the SQL.
      const configured = sanitizeHolidays(config.holidays);
      const holidayList = configured.length > 0 ? configured : DEFAULT_HOLIDAYS;
      const { recurring, specific } = splitHolidays(holidayList);
      if (recurring.length > 0) {
        holidayConds.push(`strftime('%m-%d', date) IN (${recurring.map(h => `'${h}'`).join(', ')})`);
      }
      if (specific.length > 0) {
        holidayConds.push(`date IN (${specific.map(h => `'${h}'`).join(', ')})`);
      }
      riskQueryConds.push(...holidayConds);
    }
    if (closingDays > 0) {
      // SQLite last_day logic using start of next month - 1 day. "Last N days"
      // means exactly N days, so the comparison is strict.
      closingCond = `(julianday(date(date, 'start of month', '+1 month', '-1 day')) - julianday(date)) < ${closingDays}`;
      riskQueryConds.push(closingCond);
    }

    // COALESCE: strftime/julianday return NULL for unparseable dates; such rows
    // must count as non-risk (eligible for the random pick), otherwise both
    // NULL and NOT NULL filter them out and the sample comes back empty.
    const riskWhereStr = riskQueryConds.length > 0 ? `COALESCE((${riskQueryConds.join(' OR ')}), 0)` : '0';
    return { weekendCond, holidayConds, closingCond, riskWhereStr, includeWeekend };
  }

  /** Criteria hit counts for the settings screen; selects no rows. */
  async previewRisk(config: any): Promise<{ eligible: number; matched: number; hits: { weekend: number; holiday: number; closing: number } }> {
    const ctt = Number(config.clearlyTrivialThreshold) || 0;
    const { weekendCond, holidayConds, closingCond, riskWhereStr, includeWeekend } = SamplingService.buildRiskConditions(config);

    const countWhere = async (cond: string): Promise<number> => {
      if (!cond) return 0;
      const rows: { cnt: number }[] = await this.db.query(
        `SELECT COUNT(*) as cnt FROM population WHERE ABS(amount) >= ? AND COALESCE((${cond}), 0)`, [ctt]);
      return rows[0]?.cnt || 0;
    };
    const eligibleRows: { cnt: number }[] = await this.db.query(
      `SELECT COUNT(*) as cnt FROM population WHERE ABS(amount) >= ?`, [ctt]);

    return {
      eligible: eligibleRows[0]?.cnt || 0,
      matched: await countWhere(riskWhereStr),
      hits: {
        weekend: includeWeekend ? await countWhere(weekendCond) : 0,
        holiday: holidayConds.length > 0 ? await countWhere(holidayConds.join(' OR ')) : 0,
        closing: await countWhere(closingCond)
      }
    };
  }

    /**
     * Draws `sampleSize` items at random from the rows matching `whereClause`.
     * Seeded from config.seed via Mulberry32 so a sample can be reproduced and
     * matches what the web engine produces for the same seed. SQL RANDOM() must
     * not be used here: it is unseedable, which would make the sample
     * impossible to reproduce for review.
     */
    private async getRandomSample(whereClause: string, params: any[], sampleSize: number, seed: number): Promise<any[]> {
        if (sampleSize <= 0) return [];

        const rowidRows = await this.db.query(`SELECT rowid FROM population WHERE ${whereClause}`, params);
        const poolIds: number[] = rowidRows.map((r: any) => r.rowid);
        if (poolIds.length === 0) return [];

        // Partial Fisher-Yates: only the first `count` positions are needed.
        const rng = new Mulberry32(Math.floor(seed) || 0);
        const count = Math.min(sampleSize, poolIds.length);
        for (let i = 0; i < count; i++) {
            const j = i + rng.nextInt(0, poolIds.length - i);
            [poolIds[i], poolIds[j]] = [poolIds[j], poolIds[i]];
        }
        const pickedRowIds = poolIds.slice(0, count);

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
    await updateProgress('Preparing database...');

    // Attempt to create indices if they don't exist yet (important if loaded from an old file)
    try {
      await this.db.execute('CREATE INDEX IF NOT EXISTS idx_abs_amount ON population(ABS(amount));');
      await this.db.execute('CREATE INDEX IF NOT EXISTS idx_amount ON population(amount);');
    } catch (e) {
      console.error('Failed to create indices during sampling prep:', e);
    }

    // 1. Get total population size and value
    await updateProgress('Computing population...');
    const popAgg: any[] = await this.db.query(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val FROM population`);
    const popSize = popAgg[0]?.cnt || 0;
    const popValue = popAgg[0]?.val || 0;

    if (popSize === 0) {
      throw new Error('Population cannot be empty');
    }

    const seed = Math.floor(Number(config.seed)) || 0;
    const tm = Number(config.tolerableMisstatement) || 0;
    const ctt = Number(config.clearlyTrivialThreshold) || 0;
    const isAnomalyDisabled = config.anomalyMethod === 'None';
    // ISA 530: for MUS, items >= PM are individually significant and must be
    // audited 100%. They are always separated regardless of anomaly settings.
    // For other variable/stratified methods, key items are extracted only when
    // anomaly detection is active.
    const isMUSKeyExtract = config.method === 'MUS' && tm > 0;
    const allowedMethodsForKeyItems = ['Random', 'FixedRandom', 'CVS', 'Cluster'];
    // RiskAssessment never splits off key items: it is not a value-based
    // method, so an amount alone says nothing about the risk of an entry.
    const excludeKeyItems = config.method !== 'RiskAssessment'
      && (isMUSKeyExtract || (!isAnomalyDisabled && tm > 0 && allowedMethodsForKeyItems.includes(config.method)));
    const upperLimit = excludeKeyItems ? tm : 999999999999;

    // 2. Trivial items
    let trivialCount = 0;
    let trivialValue = 0;
    let trivialItems: any[] = [];
    if (ctt > 0) {
      await updateProgress('Selecting trivial items...');
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
      await updateProgress('Selecting key items...');
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
    let riskCriteriaHits: RiskCounts | undefined;
    let riskCriteriaSelected: RiskCounts | undefined;
    let riskMatchedTotal: number | undefined;
    
    await updateProgress('Applying sampling method...');
    if (config.method === 'RiskAssessment') {
        const { weekendCond, holidayConds, closingCond, riskWhereStr, includeWeekend } = SamplingService.buildRiskConditions(config);

        // Fetch only the ids and the per-criterion flags first: the selection
        // is then capped and drawn in JS, shared with the in-memory engine, so
        // both produce the same sample from the same seed.
        const flagRows: any[] = await this.db.query(`
          SELECT rowid AS rid,
                 ${includeWeekend ? `COALESCE((${weekendCond}), 0)` : '0'} AS w,
                 ${holidayConds.length > 0 ? `COALESCE((${holidayConds.join(' OR ')}), 0)` : '0'} AS h,
                 ${closingCond ? `COALESCE((${closingCond}), 0)` : '0'} AS c
          FROM population
          WHERE ABS(amount) < ? AND ABS(amount) >= ? AND ${riskWhereStr}
        `, [upperLimit, ctt]);

        const flagsOf = (r: any): RiskFlags => ({ weekend: !!r.w, holiday: !!r.h, closing: !!r.c });
        riskCriteriaHits = {
            weekend: flagRows.filter(r => r.w).length,
            holiday: flagRows.filter(r => r.h).length,
            closing: flagRows.filter(r => r.c).length
        };
        riskMatchedTotal = flagRows.length;

        const cap = Number(config.riskMaxByCriteria) || 0;
        const allocation = allocateRiskSample(flagRows, flagsOf, cap, seed);
        riskCriteriaSelected = allocation.selected;

        const reasonById = new Map<number, string>();
        for (const r of allocation.picked) reasonById.set(r.rid, riskReasonLabel(flagsOf(r)));

        const pickedIds = allocation.picked.map(r => r.rid);
        const riskMatched: any[] = [];
        for (let i = 0; i < pickedIds.length; i += 500) {
            const chunk = pickedIds.slice(i, i + 500);
            const rows = await this.db.query(`SELECT rowid AS rid, * FROM population WHERE rowid IN (${chunk.join(',')})`);
            riskMatched.push(...rows);
        }

        for (const item of riskMatched) {
            sampleItems.push({
                ...item,
                bookValue: item.amount,
                auditedValue: '' as const,
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: reasonById.get(item.rid) || 'Risk Criteria'
            });
        }

        // Find risk unmatched (random ones)
        const riskUnmatchedWhere = `ABS(amount) < ? AND ABS(amount) >= ? AND NOT ${riskWhereStr}`;
        const nonRiskAgg: { cnt: number }[] = await this.db.query(
            `SELECT COUNT(*) as cnt FROM population WHERE ${riskUnmatchedWhere}`, [upperLimit, ctt]);
        const nonRiskSize = nonRiskAgg[0]?.cnt || 0;
        const randomCount = config.riskRandomAuto === false
            ? (config.riskRandomCount ?? 5)
            : autoRandomCount(nonRiskSize);
        const randomMatched: any[] = await this.getRandomSample(riskUnmatchedWhere, [upperLimit, ctt], randomCount, seed);
        
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
        await updateProgress('Analyzing Pareto distribution...');
        const targetPercent = (config.paretoCoverage || 80) / 100;
        const targetValue = remPopValue * targetPercent;
        
        await updateProgress('Selecting largest items...');
        const paretoItemsQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY ABS(amount) DESC`;
        const pickedRowIds = await this.db.MUS_and_Pareto_Helpers.getParetoPickedRows(paretoItemsQuery, [upperLimit, ctt], targetValue);
        
        if (pickedRowIds.length > 0) {
            await updateProgress(`Fetching selected items (${pickedRowIds.length})...`);
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
        const items: any[] = await this.getRandomSample(whereCond, [upperLimit, ctt], benfordCount, seed);
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

    } else if (config.method === 'Systematic') {
        // Систематична вибірка з фіксованим кроком: i_n = старт + (n - 1) × k.
        // Старт = (seed mod N) + 1, де N — розмір залишкової сукупності.
        const step = Math.max(1, Math.floor(Number(config.systematicStep) || 10));

        const rowidRows: any[] = await this.db.query(
            `SELECT rowid FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY rowid`,
            [upperLimit, ctt]
        );
        const N = rowidRows.length;
        const start = N > 0 ? (Math.floor(Number(config.seed) || 0) % N) + 1 : 1;
        await updateProgress(`Systematic selection (start=${start}, k=${step})...`);
        const pickedRowIds: number[] = [];
        for (let i = start - 1; i < rowidRows.length; i += step) {
            pickedRowIds.push(rowidRows[i].rowid);
            if (pickedRowIds.length >= 5000) break;
        }

        if (pickedRowIds.length > 0) {
            const results: any[] = [];
            const chunkSize = 500;
            for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
                const chunk = pickedRowIds.slice(i, i + chunkSize);
                const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(',')}) ORDER BY rowid`);
                results.push(...chunkResults);
            }
            sampleItems = results.map((item, idx) => ({
                ...item,
                bookValue: item.amount,
                auditedValue: '' as const,
                difference: item.amount,
                tainting: 1,
                isSampled: true,
                selectionReason: `Systematic (i=${start + idx * step})`
            }));
        }

    } else {
        let sampleSize = 10;
        let isMUS = false;

        if (config.method === 'MUS') {
          isMUS = true;
          const pm = config.tolerableMisstatement || 1;
          // ISA 530 / AICPA: знаменник зменшується на очікувані помилки,
          // зважені expansion factor (із захистом від нуля/від'ємного значення).
          const expectedMisstatement = config.expectedMisstatement || 0;
          const expansionFactor = getExpansionFactor(config.confidenceLevel);
          const denominator = Math.max(pm - expectedMisstatement * expansionFactor, pm * 0.01);
          sampleSize = Math.ceil((remPopValue * rf) / denominator);
        } else if (config.method === 'FixedRandom') {
          sampleSize = config.fixedSampleSize || 10;
        } else if (config.method === 'StopOrGo') {
          sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
        } else if (config.method === 'Attribute') {
          // AICPA attribute table approximation: n ≈ RF_attr / TDR
          const tdr = (config.tolerableDeviationRate ?? 5) / 100;
          const edr = (config.expectedDeviationRate ?? 0) / 100;
          const alphaAttr = 1 - config.confidenceLevel / 100;
          const rfAttr = -Math.log(alphaAttr);
          const denominatorAttr = Math.max(tdr - edr, tdr * 0.01);
          sampleSize = Math.ceil(rfAttr / denominatorAttr);
        } else if (config.method === 'CVS' || config.method === 'Random') {
          // Classical Variables / Random: n = (z × σ / E)² with FPC.
          const z = getZScore(config.confidenceLevel);
          const N_rem = popSize - keyItems.length - trivialCount;
          if (N_rem > 1 && remPopValue > 0) {
            // Variance from DB: use sum of squares approximation via population stats.
            const stats: any[] = await this.db.query(
              `SELECT AVG(ABS(amount)) as mean, AVG(ABS(amount)*ABS(amount)) as meanSq FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ?`,
              [upperLimit, ctt]
            );
            const mean = stats[0]?.mean || 0;
            const meanSq = stats[0]?.meanSq || 0;
            const variance = Math.max(meanSq - mean * mean, 0);
            const sigma = Math.sqrt(variance);
            const pm = config.tolerableMisstatement || remPopValue * 0.01;
            const E = pm / N_rem;
            const n0 = E > 0 && sigma > 0 ? Math.pow(z * sigma / E, 2) : 30;
            sampleSize = Math.ceil(n0 / (1 + n0 / N_rem));
          } else {
            sampleSize = N_rem;
          }
        } else {
          sampleSize = config.fixedSampleSize || 25;
        }

        const remPopSize = popSize - keyItems.length - trivialCount;
        if (sampleSize > remPopSize) sampleSize = remPopSize;
        if (sampleSize > 5000) sampleSize = 5000;

        if (isMUS) {
            await updateProgress('Calculating MUS interval...');
            const pm = config.tolerableMisstatement || 1;
            // Інтервал відбору узгоджуємо з фактичним (обмеженим) розміром вибірки,
            // щоб MUS-вибірка давала саме sampleSize влучань.
            const interval = sampleSize > 0 && remPopValue > 0 ? remPopValue / sampleSize : Math.max(pm / rf, 1);

            await updateProgress(`Applying interval (${interval.toFixed(2)})...`);
            const musQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY rowid`;
            const pickedRowIds = await this.db.MUS_and_Pareto_Helpers.getMUSPickedRows(musQuery, [upperLimit, ctt], interval, sampleSize);

            if (pickedRowIds.length > 0) {
                await updateProgress(`Fetching selected items (${pickedRowIds.length})...`);
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
            await updateProgress(`Performing random selection (${sampleSize} items)...`);
            const whereStr = `ABS(amount) < ? AND ABS(amount) >= ?`;
            const rawSampleItems: any[] = await this.getRandomSample(whereStr, [upperLimit, ctt], sampleSize, seed);
    
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

    await updateProgress('Building results...');

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
      upperMisstatementBound: 0,
      riskCriteriaHits,
      riskCriteriaSelected,
      riskMatchedTotal
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
    } else if (['RiskAssessment', 'FixedRandom', 'Systematic', 'Pareto', 'Percentile', 'Grubbs', 'Benford', 'StopOrGo'].includes(config.method)) {
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

