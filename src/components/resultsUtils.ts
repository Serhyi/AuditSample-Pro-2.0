import { SamplingConfig, SamplingResult, GlobalSettings } from '../types';

export const METHOD_PREFIX_MAP: Record<string, string> = {
  MUS: 'mus',
  RiskAssessment: 'riskAssessment',
  Random: 'random',
  FixedRandom: 'fixedRandom',
  CVS: 'cvs',
  Attribute: 'attr',
  StopOrGo: 'stopOrGo',
  Cluster: 'cluster',
  Benford: 'benford',
  Pareto: 'pareto',
  Percentile: 'percentile',
  Grubbs: 'grubbs'
};

import { formatMoney } from '../utils/samplingEngine';

export function getCalculationDetails(config: SamplingConfig, results: SamplingResult, settings: GlobalSettings, lang: string): { vars: Record<string, string|number>, subst: string } {
    const isUa = lang === 'ua';
    let rf = 3.0; // 95%
    if (config.confidenceLevel === 70) rf = 1.20;
    else if (config.confidenceLevel === 80) rf = 1.61;
    else if (config.confidenceLevel === 90) rf = 2.31;
    else if (config.confidenceLevel === 95) rf = 3.00;
    else if (config.confidenceLevel === 99) rf = 4.61;
    
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
        vars[isUa ? 'Залишкова сукупність (BV):' : 'Residual Book Value (BV):'] = bvStr;
        vars[isUa ? `Коефіцієнт RF (${config.confidenceLevel}%):` : `Reliability Factor RF (${config.confidenceLevel}%):`] = rf;
        vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;
        
        const calcN = Math.ceil((bv * rf) / pm);
        subst = `n = (${bvStr} × ${rf}) / ${pmStr}\nn = ${calcN}`;
    } else if (config.method === 'Random' || config.method === 'FixedRandom') {
        vars[methodStr] = config.method;
        if (config.method === 'Random') {
            vars[confLevelStr] = `${config.confidenceLevel}%`;
            vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;
        }
        vars[isUa ? 'Кількість відібраних елементів (n):' : 'Sample Size (n):'] = results.samplingItems.length;
        subst = `n = ${results.samplingItems.length}`;
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
    } else {
        vars[methodStr] = config.method;
        subst = isUa ? `Тестування алгоритмом ${config.method}` : `Testing with ${config.method} algorithm.`;
    }

    return { vars, subst };
}

export function getStaticFormula(method: string): string {
    switch(method) {
        case 'MUS': return 'n = (BV × RF) / PM';
        case 'Random': return 'n = (N × Z² × p × (1-p)) / (E²)';
        case 'FixedRandom': return 'n = const';
        case 'CVS': return 'n = ((N × Z × σ) / PM)²';
        case 'Attribute': return 'n = AICPA_Table(ROR, TDR, EDR)';
        case 'StopOrGo': return 'n = n1 + n2';
        case 'Cluster': return 'k-Means++ Sampling';
        case 'Benford': return 'Z-score First Digit Analysis';
        case 'Pareto': return 'Cumulative Sum Threshold (80%)';
        case 'Percentile': return 'Top/Bottom Cut-off';
        case 'Grubbs': return 'Iterative Grubbs Test';
        case 'RiskAssessment': return 'n = Benford + Grubbs + Calendar + Cut-off + Random';
        default: return '';
    }
}
