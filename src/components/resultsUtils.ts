import { SamplingConfig, SamplingResult, GlobalSettings, Language } from '../types';
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
    if (config.method === 'Pareto') {
        const pCov = config.paretoCoverage || 80;
        desc = desc.replace('80%', `${pCov}%`).replace('80', String(pCov));
    }
    return desc;
}


import { formatMoney } from '../utils/samplingEngine';
import { getReliabilityFactor, getExpansionFactor } from '../statistics/reliabilityFactor';

export function getCalculationDetails(config: SamplingConfig, results: SamplingResult, settings: GlobalSettings, lang: string): { vars: Record<string, string|number>, subst: string } {
    const isUa = lang === 'ua';
    const rf = getReliabilityFactor(config.confidenceLevel);
    
    // Remaining population value (Book Value - Key Items - Trivial)
    const bv = results.populationValue - results.keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0) - results.trivialValue;
    const pm = config.tolerableMisstatement || 1;

    const vars: Record<string, string|number> = {};
    let subst = '';

    const bvStr = formatMoney(bv, settings);
    const pmStr = formatMoney(pm, settings);
    const methodStr = isUa ? 'Метод:' : 'Method:';
    const confLevelStr = isUa ? 'Рівень впевненості:' : 'Confidence Level:';
    
    if (config.method === 'MUS') {
        const expectedMisstatement = config.expectedMisstatement || 0;
        const expansionFactor = getExpansionFactor(config.confidenceLevel);
        const denominator = Math.max(pm - expectedMisstatement * expansionFactor, pm * 0.01);
        const denomStr = formatMoney(denominator, settings);

        vars[isUa ? 'Залишкова сукупність (BV):' : 'Residual Book Value (BV):'] = bvStr;
        vars[isUa ? `Коефіцієнт RF (${config.confidenceLevel}%):` : `Reliability Factor RF (${config.confidenceLevel}%):`] = rf;
        vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;

        const calcN = Math.ceil((bv * rf) / denominator);
        if (expectedMisstatement > 0) {
            const eeStr = formatMoney(expectedMisstatement, settings);
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
        vars[isUa ? 'Суттєвість (PM):' : 'Materiality (PM):'] = pmStr;
        vars[isUa ? 'Оцінка ризику:' : 'Risk Assessment:'] = config.riskFactor;
        subst = isUa ? 'Відібрано записи за індикаторами ризику' : 'Selected entries based on risk indicators.';
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
