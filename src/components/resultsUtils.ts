import { SamplingConfig, SamplingResult, Language } from '../types';
import { DEFAULT_HOLIDAYS, sanitizeHolidays } from '../utils/holidays';
import { t } from '../utils/translations';

export const METHOD_PREFIX_MAP: Record<string, string> = {
  MUS: 'mus',
  RiskAssessment: 'riskAssessment',
  Random: 'random',
  FixedRandom: 'fixedRandom',
  Systematic: 'systematic',
  CVS: 'cvs',
  Attribute: 'attr',
  StopOrGo: 'stopOrGo',
  Cluster: 'cluster',
  Benford: 'benford',
  Pareto: 'pareto',
  Percentile: 'percentile',
  Grubbs: 'grubbs'
};

export function getDynamicMethodName(config: SamplingConfig, lang: Language): string {
    const mPrefix = METHOD_PREFIX_MAP[config.method] || config.method.toLowerCase();
    let name = t(mPrefix + 'Name', lang);
    if (config.method === 'Pareto') {
        const pCov = config.paretoCoverage || 80;
        name = name.replace('80', String(pCov)).replace('20', String(100 - pCov));
    }
    return name;
}

export function getDynamicMethodDescription(config: SamplingConfig, lang: Language): string {
    const mPrefix = METHOD_PREFIX_MAP[config.method] || config.method.toLowerCase();
    let desc = t(mPrefix + 'EvaluationText', lang);
    if (config.method === 'RiskAssessment') {
        // Spelled out from the configuration: the criteria are switchable and
        // the holidays come from the settings, so a fixed sentence would
        // describe a run that did not happen.
        const isUa = lang === 'ua';
        const opts = riskCriteriaOptions(config);
        const parts: string[] = [];

        if (opts.includeWeekend) {
            parts.push(isUa
                ? 'операції у вихідні дні (субота, неділя) — день тижня визначається з дати операції'
                : 'entries on weekends (Saturday, Sunday), derived from the entry date');
        }
        if (opts.includeHoliday) {
            const days = opts.holidayList.map(formatHoliday).join(', ');
            parts.push(isUa
                ? `операції у святкові дні за списком з налаштувань (${opts.holidayList.length}): ${days}`
                : `entries on the holidays listed in the settings (${opts.holidayList.length}): ${days}`);
        }
        if (opts.closingDays > 0) {
            parts.push(isUa
                ? `операції періоду закриття — останні ${opts.closingDays} дн. кожного місяця`
                : `entries in the closing period - the last ${opts.closingDays} days of each month`);
        }

        const criteria = parts.length > 0
            ? (isUa ? `Критерії ризику: ${parts.join('; ')}.` : `Risk criteria: ${parts.join('; ')}.`)
            : (isUa ? 'Жоден критерій ризику не увімкнено.' : 'No risk criterion is enabled.');

        const cap = Number(config.riskMaxByCriteria) || 0;
        const capText = cap > 0
            ? (isUa
                ? `Обсяг вибірки обмежено ${cap} елементами: квота розподіляється між критеріями пропорційно кількості збігів, не менше одного елемента на критерій, добір усередині критерію — псевдовипадковий за зерном (seed).`
                : `The sample is capped at ${cap} items: the quota is split across the criteria in proportion to their matches, at least one item each, and drawn within a criterion pseudo-randomly from the seed.`)
            : (isUa
                ? 'Обмеження обсягу не задано: перевіряються всі операції, що відповідають критеріям.'
                : 'No cap is set: every entry meeting the criteria is checked.');

        const random = config.riskRandomAuto === false
            ? (isUa
                ? `Додатково відбирається ${config.riskRandomCount ?? 5} випадкових елементів з тих, що не відповідають жодному критерію (елемент непередбачуваності, МСА 240).`
                : `A further ${config.riskRandomCount ?? 5} items are drawn at random from entries matching no criterion (unpredictability, ISA 240).`)
            : (isUa
                ? 'Додатково відбираються випадкові елементи з тих, що не відповідають жодному критерію: 1% від їх кількості, але не менше 5 (елемент непередбачуваності, МСА 240).'
                : 'A random control group is drawn from entries matching no criterion: 1% of them, at least 5 (unpredictability, ISA 240).');

        const evaluation = isUa
            ? 'Метод нестатистичний (цільовий): прогнозоване викривлення та верхня межа дорівнюють сумі фактично встановлених помилок, екстраполяція на неперевірену частину сукупності не здійснюється.'
            : 'The method is non-statistical (judgmental): projected and upper misstatement equal the errors actually established, with no extrapolation to the untested remainder.';

        return `${criteria} ${capText} ${random} ${evaluation}`;
    }
    if (config.method === 'Pareto') {
        const pCov = config.paretoCoverage || 80;
        desc = desc.replace('80%', `${pCov}%`).replace('80', String(pCov));
    }
    return desc;
}


import { formatMoney } from '../utils/samplingEngine';
import { formatHoliday } from '../utils/holidays';
import { riskCriteriaOptions } from '../utils/riskSelection';
import { getReliabilityFactor, getExpansionFactor } from '../statistics/reliabilityFactor';

export function getCalculationDetails(config: SamplingConfig, results: SamplingResult, lang: string): { vars: Record<string, string|number>, subst: string } {
    const isUa = lang === 'ua';
    const rf = getReliabilityFactor(config.confidenceLevel);
    
    // Remaining population value (Book Value - Key Items - Trivial)
    const bv = results.populationValue - results.keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0) - results.trivialValue;
    const pm = config.tolerableMisstatement || 1;

    const vars: Record<string, string|number> = {};
    let subst = '';

    const bvStr = formatMoney(bv);
    const pmStr = formatMoney(pm);
    const methodStr = isUa ? 'Метод:' : 'Method:';
    const confLevelStr = isUa ? 'Рівень впевненості:' : 'Confidence Level:';
    
    if (config.method === 'MUS') {
        const expectedMisstatement = config.expectedMisstatement || 0;
        const expansionFactor = getExpansionFactor(config.confidenceLevel);
        const denominator = Math.max(pm - expectedMisstatement * expansionFactor, pm * 0.01);
        const denomStr = formatMoney(denominator);

        vars[isUa ? 'Залишкова сукупність (BV):' : 'Residual Book Value (BV):'] = bvStr;
        vars[isUa ? `Коефіцієнт RF (${config.confidenceLevel}%):` : `Reliability Factor RF (${config.confidenceLevel}%):`] = rf;
        vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;

        const calcN = Math.ceil((bv * rf) / denominator);
        if (expectedMisstatement > 0) {
            const eeStr = formatMoney(expectedMisstatement);
            vars[isUa ? 'Очікуване викривлення (EM):' : 'Expected Misstatement (EM):'] = eeStr;
            vars[isUa ? `Коефіцієнт розширення (EF):` : `Expansion Factor (EF):`] = expansionFactor;
            subst = `n = (${bvStr} × ${rf}) / (${pmStr} − ${eeStr} × ${expansionFactor})\nn = (${bvStr} × ${rf}) / ${denomStr}\nn = ${calcN}`;
        } else {
            subst = `n = (${bvStr} × ${rf}) / ${pmStr}\nn = ${calcN}`;
        }
    } else if (config.method === 'Random' || config.method === 'FixedRandom') {
        vars[methodStr] = config.method;
        if (config.method === 'Random') {
            vars[confLevelStr] = `${config.confidenceLevel}%`;
            vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;
        }
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;
        subst = `n = ${results.samplingItems.length}`;
    } else if (config.method === 'Systematic') {
        const sysStep = Math.max(1, Math.floor(config.systematicStep || 10));
        const sysN = Math.max(1, results.populationSize - results.trivialCount - (results.keyItems?.length || 0));
        const sysStart = (Math.floor(config.seed || 0) % sysN) + 1;
        vars[methodStr] = config.method;
        vars[isUa ? 'Зерно генератора (Seed):' : 'Seed:'] = config.seed || 0;
        vars[isUa ? 'Залишкова сукупність (N):' : 'Residual Population (N):'] = sysN;
        vars[isUa ? 'Початковий елемент (старт = seed mod N + 1):' : 'Starting Item (start = seed mod N + 1):'] = sysStart;
        vars[isUa ? 'Крок відбору (k):' : 'Selection Step (k):'] = sysStep;
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;
        subst = `start = ${config.seed || 0} mod ${sysN} + 1 = ${sysStart}\niₙ = ${sysStart} + (n − 1) × ${sysStep}\nn = ${results.samplingItems.length}`;
    } else if (config.method === 'CVS') {
        vars[isUa ? 'Залишкова сукупність (BV):' : 'Residual Book Value (BV):'] = bvStr;
        vars[confLevelStr] = `${config.confidenceLevel}%`;
        vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;
        subst = `n = ${results.samplingItems.length}`;
    } else if (config.method === 'RiskAssessment') {
        // Only the parameters this method actually uses. Materiality and the
        // risk factor are deliberately absent: neither is configurable for
        // RiskAssessment, so showing them would report values the user never set.
        const closingDays = config.riskClosingDays ?? 5;
        const includeWeekend = config.riskWeekend !== false;
        const includeHoliday = config.riskHoliday !== false;
        const randomCount = config.riskRandomCount ?? 5;
        const randomAuto = config.riskRandomAuto !== false;
        const cap = Number(config.riskMaxByCriteria) || 0;
        const configuredHolidays = sanitizeHolidays(config.holidays);
        const holidayList = configuredHolidays.length > 0 ? configuredHolidays : DEFAULT_HOLIDAYS;
        // 'Risk Criteria' is the older, undifferentiated label; current runs
        // name the criteria that matched ('Risk: holiday, weekend').
        const isByCriteria = (r?: string) => !!r && (r === 'Risk Criteria' || r.startsWith('Risk:'));
        const byCriteria = (results.samplingItems || []).filter(i => isByCriteria(i.selectionReason)).length;
        const byRandom = (results.samplingItems || []).filter(i => i.selectionReason === 'Random (Risk)').length;
        const yes = isUa ? 'так' : 'yes';
        const no = isUa ? 'ні' : 'no';

        // Hits are what the engine actually matched; showing them next to each
        // criterion makes a mismatch between description and selection visible.
        const hits = results.riskCriteriaHits;
        const withHits = (label: string, n: number | undefined) =>
            n === undefined ? label : `${label} — ${n}`;

        // When the selection was capped, each criterion reports selected/matched
        // so the auditor sees the coverage rather than assuming it was complete.
        const sel = results.riskCriteriaSelected;
        const withCoverage = (label: string, c: 'weekend' | 'holiday' | 'closing') => {
            const matched = hits?.[c];
            if (matched === undefined) return label;
            const chosen = sel?.[c];
            if (chosen === undefined || chosen === matched) return withHits(label, matched);
            return isUa ? `${label} — ${chosen} з ${matched}` : `${label} — ${chosen} of ${matched}`;
        };

        const criteria: string[] = [];
        if (includeWeekend) criteria.push(withCoverage(isUa ? 'вихідні дні' : 'weekends', 'weekend'));
        if (includeHoliday) criteria.push(withCoverage(isUa ? `святкові дні (${holidayList.length})` : `public holidays (${holidayList.length})`, 'holiday'));
        if (closingDays > 0) criteria.push(withCoverage(isUa ? `останні ${closingDays} дн. місяця` : `last ${closingDays} days of month`, 'closing'));

        vars[methodStr] = config.method;
        vars[isUa ? 'Операції у вихідні:' : 'Weekend entries:'] = includeWeekend ? yes : no;
        vars[isUa ? 'Операції у свята:' : 'Holiday entries:'] = includeHoliday
            ? (isUa ? `${yes} (у списку днів: ${holidayList.length})` : `${yes} (${holidayList.length} days listed)`)
            : no;
        vars[isUa ? 'Днів закриття періоду:' : 'Period closing days:'] = closingDays;
        vars[isUa ? 'Зерно генератора (Seed):' : 'Generator Seed:'] = config.seed || 0;
        const matchedTotal = results.riskMatchedTotal;
        vars[isUa ? 'Відібрано за критеріями ризику:' : 'Selected by risk criteria:'] =
            (matchedTotal !== undefined && matchedTotal !== byCriteria)
                ? (isUa ? `${byCriteria} з ${matchedTotal} збігів (ліміт ${cap})` : `${byCriteria} of ${matchedTotal} matches (cap ${cap})`)
                : byCriteria;
        vars[isUa ? 'Додано випадкових (контроль):' : 'Random control items:'] =
            randomAuto ? `${byRandom} (${isUa ? 'авто' : 'auto'})` : `${byRandom} / ${randomCount}`;
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;

        const criteriaStr = criteria.length > 0
            ? criteria.join(', ')
            : (isUa ? 'критерії вимкнено' : 'no criteria enabled');
        subst = isUa
            ? `Критерії ризику: ${criteriaStr}\nn = ${byCriteria} (за критеріями) + ${byRandom} (випадкові) = ${results.samplingItems.length}`
            : `Risk criteria: ${criteriaStr}\nn = ${byCriteria} (by criteria) + ${byRandom} (random) = ${results.samplingItems.length}`;
    } else if (config.method === 'Pareto') {
        vars[methodStr] = config.method;
        vars[isUa ? 'Цільове покриття (%):' : 'Target Coverage (%):'] = config.paretoCoverage || 80;
        subst = isUa ? `Відібрано найбільші суми для покриття ${config.paretoCoverage || 80}% ген. сукупності` : `Selected top amounts to cover ${config.paretoCoverage || 80}% of population`;
    } else if (config.method === 'Percentile') {
        vars[methodStr] = config.method;
        vars[isUa ? 'Відсоток хвостів (%):' : 'Tails Percentage (%):'] = config.percentileCount || 5;
        subst = isUa ? `Відібрано верхні та нижні ${config.percentileCount || 5}% значень` : `Selected top and bottom ${config.percentileCount || 5}% values`;
    } else if (config.method === 'Grubbs') {
        vars[methodStr] = config.method;
        vars[isUa ? 'Рівень значущості (Alpha):' : 'Significance Level (Alpha):'] = config.grubbsAlpha || 0.05;
        subst = isUa ? `Виявлено статистичні викиди з Alpha = ${config.grubbsAlpha || 0.05}` : `Detected statistical outliers with Alpha = ${config.grubbsAlpha || 0.05}`;
    } else if (config.method === 'Cluster') {
        vars[methodStr] = config.method;
        vars[isUa ? 'Кількість кластерів:' : 'Number of Clusters:'] = config.numberOfClusters || 5;
        subst = isUa ? `Дані розбито на ${config.numberOfClusters || 5} кластерів алгоритмом K-Means` : `Data partitioned into ${config.numberOfClusters || 5} clusters via K-Means`;
    } else if (config.method === 'Attribute') {
        vars[confLevelStr] = `${config.confidenceLevel}%`;
        vars[isUa ? 'Допустимий ступінь відхилення (TDR):' : 'Tolerable Deviation Rate (TDR):'] = `${config.tolerableDeviationRate || 5}%`;
        vars[isUa ? 'Очікуваний ступінь відхилення (EDR):' : 'Expected Deviation Rate (EDR):'] = `${config.expectedDeviationRate || 0}%`;
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;
        subst = isUa ? `Розмір визначено за таблицями AICPA: n = ${results.samplingItems.length}` : `Size determined via AICPA tables: n = ${results.samplingItems.length}`;
    } else if (config.method === 'StopOrGo') {
        vars[methodStr] = config.method;
        vars[isUa ? 'Початковий розмір (Етап 1):' : 'Initial Size (Stage 1):'] = config.stopOrGoInitialSize || 50;
        vars[isUa ? 'Резервний розмір (Етап 2):' : 'Expansion Size (Stage 2):'] = config.stopOrGoExpansionSize || 100;
        vars[isUa ? 'Фактичний розмір (n):' : 'Actual Sample Size (n):'] = results.samplingItems.length;
        subst = isUa ? `Відібрано ${results.samplingItems.length} елементів` : `Selected ${results.samplingItems.length} items`;
    } else {
        vars[methodStr] = config.method;
        subst = isUa ? `Тестування алгоритмом ${config.method}` : `Testing with ${config.method} algorithm.`;
    }

    return { vars, subst };
}

export function getStaticFormula(method: string, lang: string = 'en'): string {
    const isUa = lang === 'ua';
    switch(method) {
        case 'MUS': return 'n = (BV × RF) / (PM − EM × EF)';
        case 'Random': return 'n = (N × Z² × p × (1-p)) / (E²)';
        case 'FixedRandom': return 'n = const';
        case 'Systematic': return 'iₙ = start + (n − 1) × k';
        case 'CVS': return 'n = ((N × Z × σ) / PM)²';
        case 'Attribute': return 'n = AICPA_Table(ROR, TDR, EDR)';
        case 'StopOrGo': return 'n = n1 + n2';
        case 'Cluster': return 'k-Means++ Sampling';
        case 'Benford': return 'Z-score First Digit Analysis';
        case 'Pareto': return isUa ? 'Σ(x) >= Поріг покриття' : 'Σ(x) >= Coverage Threshold';
        case 'Percentile': return 'Top/Bottom Cut-off';
        case 'Grubbs': return 'Iterative Grubbs Test';
        case 'RiskAssessment': return 'n = Benford + Grubbs + Calendar + Cut-off + Random';
        default: return '';
    }
}
