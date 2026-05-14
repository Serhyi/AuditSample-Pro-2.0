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

    let vars: Record<string, string|number> = {};
    let subst = '';

    if (config.method === 'MUS') {
        const bvStr = formatMoney(bv, settings);
        const pmStr = formatMoney(pm, settings);
        vars[isUa ? 'Залишкова сукупність (BV):' : 'Residual Book Value (BV):'] = bvStr;
        vars[isUa ? `Коефіцієнт RF (${config.confidenceLevel}%):` : `Reliability Factor RF (${config.confidenceLevel}%):`] = rf;
        vars[isUa ? 'Допустиме викривлення (PM):' : 'Tolerable Misstatement (PM):'] = pmStr;
        
        const calcN = Math.ceil((bv * rf) / pm);
        subst = `n = (${bvStr} × ${rf}) / ${pmStr}\nn = ${calcN}`;
    } else {
        vars = { "Method": config.method };
        subst = isUa ? 'Спрощений розрахунок' : 'Calculation details are simplified.';
    }

    return { vars, subst };
}

export function getStaticFormula(method: string): string {
    if (method === 'MUS') {
        return 'n = (BV × RF) / PM';
    }
    return '';
}
