
import React, { useState, useEffect } from 'react';
import { SamplingConfig, Language, GlobalSettings } from '../types';
import { Settings, Info, Dices, Zap, Check } from 'lucide-react';
import { t } from '../utils/translations';
import { formatMoney } from '../utils/samplingEngine';
import { MethodSelector } from './config/MethodSelector';

interface ConfigStepProps {
  config: SamplingConfig;
  setConfig: (config: SamplingConfig) => void;
  totalPopulationValue: number;
  lang: Language;
  settings: GlobalSettings;
}

interface NumberInputProps {
    value: number;
    onChange: (val: number) => void;
    placeholder?: string;
    className?: string;
    min?: number;
    max?: number;
}

const getMethodName = (method: string, lang: Language) => {
    const map: Record<string, string> = {
        'MUS': 'musName', 'Random': 'randomName', 'Attribute': 'attrName', 'StopOrGo': 'stopOrGoName',
        'FixedRandom': 'fixedRandomName', 'Cluster': 'clusterName', 'CVS': 'cvsName', 'Benford': 'benfordName',
        'Pareto': 'paretoName', 'Percentile': 'percentileName', 'Grubbs': 'grubbsName', 'RiskAssessment': 'riskAssessmentName'
    };
    const key = map[method] || method;
    return t(key, lang);
};

const NumberInput: React.FC<NumberInputProps> = ({ value, onChange, placeholder, className, min, max }) => {
    const [localVal, setLocalVal] = useState<string>(value.toString());
    useEffect(() => {
        const parsedLocal = localVal === '' ? 0 : parseFloat(localVal);
        if (parsedLocal !== value) { if (value === 0 && localVal === '') return; setLocalVal(value.toString()); }
    }, [value, localVal]);
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const str = e.target.value; setLocalVal(str);
        if (str === '') onChange(0); 
        else { const num = parseFloat(str); if (!isNaN(num)) onChange(num); }
    };
    return (
        <input type="number" className={`${className} font-mono text-[13px]`} placeholder={placeholder} value={localVal === '0' && value === 0 && placeholder ? '' : localVal} onChange={handleChange} min={min} max={max} />
    );
};

const ConfigStep: React.FC<ConfigStepProps> = ({ config, setConfig, totalPopulationValue, lang, settings }) => {
  const handleChange = (key: keyof SamplingConfig, value: any) => { setConfig({ ...config, [key]: value }); };
  const suggestedPM = Math.floor(totalPopulationValue * 0.01);
  const suggestedTrivial = Math.floor(suggestedPM * 0.05); 

  const getAnomalyDesc = () => { switch (config.anomalyMethod) { case 'ModifiedZ': return t('anomDescModZ', lang); case 'None': return t('anomDescNone', lang); default: return ''; } };

  const showSeed = ['StopOrGo', 'MUS', 'CVS', 'Cluster', 'Random', 'FixedRandom', 'Attribute', 'RiskAssessment'].includes(config.method);
  const showPM = ['MUS', 'CVS', 'Cluster', 'Random', 'FixedRandom'].includes(config.method);
  const showTrivial = ['StopOrGo', 'MUS', 'CVS', 'Cluster', 'Random', 'FixedRandom', 'RiskAssessment'].includes(config.method);
  const showAnomalySelect = ['CVS', 'Cluster', 'Random', 'FixedRandom'].includes(config.method);
  const showConfidence = config.method === 'MUS' || config.method === 'CVS' || config.method === 'Random';
  const showStopOrGoParams = config.method === 'StopOrGo';
  const showAttributeParams = config.method === 'Attribute';
  const showFixedSize = config.method === 'FixedRandom';
  const showRiskParams = config.method === 'RiskAssessment';
  
  const showPareto = config.method === 'Pareto';
  const showPercentile = config.method === 'Percentile';
  const showGrubbs = config.method === 'Grubbs';
  const showBenford = config.method === 'Benford';

  const getConfidenceHelp = () => { if (config.method === 'MUS') return t('clHelpMUS', lang); if (config.method === 'CVS') return t('clHelpCVS', lang); return t('clHelpRandom', lang); };

  return (
    <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-slate-200 animate-fade-in transition-all">
      <div className="flex items-center justify-between mb-10">
        <h2 className="text-2xl font-display text-neutral-900 flex items-center gap-3">
          <Settings className="w-7 h-7 text-brand-600" />
          {t('configTitle', lang)}
        </h2>
        <div className="flex items-center gap-2 px-4 py-1.5 bg-brand-50 border border-brand-100 rounded-full">
            <span className="text-[10px] font-black text-brand-700 uppercase tracking-widest">{t('isaCompliant', lang)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
        <div className="lg:col-span-5 bg-white rounded-[2.5rem] pt-8 pb-8 px-4 lg:pt-10 lg:pb-10 lg:px-6 border border-slate-200 shadow-sm flex flex-col lg:h-[887px] overflow-hidden">
            <MethodSelector currentMethod={config.method} onSelect={(id) => handleChange('method', id)} lang={lang} />
        </div>

        <div className="lg:col-span-7 bg-white rounded-[2.5rem] p-8 lg:p-10 border border-slate-200 shadow-sm flex flex-col pt-8 lg:pt-10 lg:h-[887px] overflow-y-auto custom-scrollbar">
          <div className="flex items-center gap-3 mb-8 border-b border-slate-200 pb-5 shrink-0">
            <h3 className="text-xs font-black text-brand-600 uppercase tracking-[0.2em]">{t('configTitle', lang)}:</h3>
            <span className="text-[15px] font-bold text-brand-700">{getMethodName(config.method, lang)}</span>
          </div>
          
          <div className="space-y-8 pr-2">
            {showAnomalySelect && (
                <div className="animate-fade-in group">
                <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-brand-600" />
                    {t('anomalyLabel', lang)}
                </label>
                <div className="relative">
                    <select value={config.anomalyMethod || 'ModifiedZ'} onChange={(e) => handleChange('anomalyMethod', e.target.value)} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white shadow-sm font-bold text-[13px] appearance-none cursor-pointer transition-all">
                        <option value="ModifiedZ">{t('methodModZ', lang)}</option>
                        <option value="None">{t('methodNone', lang)}</option>
                    </select>
                </div>
                <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                  <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                  {getAnomalyDesc()}
                </p>
                </div>
            )}
            
            {showSeed && (
                <div className="animate-fade-in">
                <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">
                    {t('seedLabel', lang)}
                </label>
                <div className="flex gap-3">
                    <NumberInput value={config.seed || 0} onChange={(val) => handleChange('seed', val)} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" placeholder="Enter seed..." />
                    <button onClick={() => handleChange('seed', Math.floor(Math.random() * 100000))} className="px-4 border border-slate-200 rounded-2xl hover:bg-white hover:border-brand-300 text-slate-400 hover:text-brand-600 transition-all bg-slate-100 shadow-sm" title="Generate Random">
                        <Dices className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                  <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                  {t('seedDesc', lang)}
                </p>
                </div>
            )}

            {showFixedSize && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('fixedSizeLabel', lang)}</label>
                    <NumberInput min={1} value={config.fixedSampleSize || 10} onChange={(val) => handleChange('fixedSampleSize', Math.max(1, val))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('fixedSizeDesc', lang)}
                    </p>
                </div>
            )}

            {showPareto && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('paretoCoverageLabel', lang)}</label>
                    <NumberInput min={1} max={100} value={config.paretoCoverage || 80} onChange={(val) => handleChange('paretoCoverage', Math.max(1, Math.min(100, val)))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('paretoCoverageDesc', lang)}
                    </p>
                </div>
            )}

            {showPercentile && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('percentileCountLabel', lang)}</label>
                    <NumberInput min={1} max={50} value={config.percentileCount || 5} onChange={(val) => handleChange('percentileCount', Math.max(1, Math.min(50, val)))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('percentileCountDesc', lang)}
                    </p>
                </div>
            )}

            {showGrubbs && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('grubbsAlphaLabel', lang)}</label>
                    <div className="relative">
                        <select value={config.grubbsAlpha || 0.05} onChange={(e) => handleChange('grubbsAlpha', parseFloat(e.target.value))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 bg-white shadow-sm font-bold text-[13px] appearance-none cursor-pointer transition-all">
                            <option value={0.10}>0.10 (10%)</option>
                            <option value={0.05}>0.05 (5%)</option>
                            <option value={0.01}>0.01 (1%)</option>
                            <option value={0.001}>0.001 (0.1%)</option>
                        </select>
                    </div>
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('grubbsAlphaDesc', lang)}
                    </p>
                </div>
            )}

            {showBenford && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('benfordSampleSizeLabel', lang)}</label>
                    <NumberInput min={5} value={config.benfordSampleSize || 25} onChange={(val) => handleChange('benfordSampleSize', Math.max(5, val))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('benfordSampleSizeDesc', lang)}
                    </p>
                </div>
            )}

            {showRiskParams && (
                <div className="animate-fade-in space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('riskClosingDaysLabel', lang)}</label>
                            <NumberInput min={0} value={config.riskClosingDays ?? 5} onChange={(val) => handleChange('riskClosingDays', val)} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                        </div>
                        <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('riskRandomCountLabel', lang)}</label>
                            <NumberInput min={0} value={config.riskRandomCount ?? 5} onChange={(val) => handleChange('riskRandomCount', val)} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                        <label className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl cursor-pointer hover:border-brand-400 transition-all">
                             <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${config.riskWeekend !== false ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-300 bg-slate-50'}`}>
                                 {config.riskWeekend !== false && <Check className="w-3.5 h-3.5" />}
                             </div>
                             <input type="checkbox" className="hidden" checked={config.riskWeekend !== false} onChange={(e) => handleChange('riskWeekend', e.target.checked)} />
                             <span className="text-[12px] font-bold text-slate-700">{t('riskWeekendLabel', lang)}</span>
                        </label>
                        <label className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl cursor-pointer hover:border-brand-400 transition-all">
                             <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${config.riskHoliday !== false ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-300 bg-slate-50'}`}>
                                 {config.riskHoliday !== false && <Check className="w-3.5 h-3.5" />}
                             </div>
                             <input type="checkbox" className="hidden" checked={config.riskHoliday !== false} onChange={(e) => handleChange('riskHoliday', e.target.checked)} />
                             <span className="text-[12px] font-bold text-slate-700">{t('riskHolidayLabel', lang)}</span>
                        </label>
                    </div>
                     <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('riskAssessmentPurposeText', lang)}
                    </p>
                </div>
            )}

            {showStopOrGoParams && (
                <div className="animate-fade-in grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('stopOrGoInitLabel', lang)}</label>
                        <NumberInput min={1} value={config.stopOrGoInitialSize || 25} onChange={(val) => handleChange('stopOrGoInitialSize', Math.max(1, val))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('stopOrGoExpLabel', lang)}</label>
                        <NumberInput min={1} value={config.stopOrGoExpansionSize || 25} onChange={(val) => handleChange('stopOrGoExpansionSize', Math.max(1, val))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px]" />
                    </div>
                    <div className="col-span-2">
                        <div className="text-[12px] font-black text-brand-700 bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 flex items-center gap-2">
                            <Check className="w-4 h-4" />
                            {t('stopOrGoRec', lang)} <span className="font-mono">{(config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25)}</span>.
                        </div>
                    </div>
                </div>
            )}

            {showAttributeParams && (
                <div className="animate-fade-in space-y-6">
                     <div>
                        <label className="block text-[11px] font-black text-slate-500 mb-3 uppercase tracking-widest">{t('riskLabel', lang)}</label>
                        <div className="flex bg-white p-1.5 rounded-[1rem] border border-slate-200 shadow-sm overflow-x-auto">
                            {['Low', 'Moderate', 'High'].map((risk) => (
                                <button key={risk} onClick={() => handleChange('riskFactor', risk)} className={`flex-1 py-2.5 px-4 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${config.riskFactor === risk ? 'bg-brand-600 text-white shadow-lg shadow-brand-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
                                    {risk === 'Low' ? t('riskLowBtn', lang) : risk === 'Moderate' ? t('riskModBtn', lang) : t('riskHighBtn', lang)}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2.5 font-medium italic px-2">{t('attrRiskHelp', lang)}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                         <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('tdrLabel', lang)}</label>
                            <select value={config.tolerableDeviationRate || 5} onChange={(e) => handleChange('tolerableDeviationRate', Number(e.target.value))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px] appearance-none cursor-pointer transition-all">
                                {[3,4,5,6,7,8,9,10,15,20].map(val => <option key={val} value={val}>{val}%</option>)}
                            </select>
                            <p className="text-[11px] text-slate-400 mt-2 font-medium leading-tight">{t('tdrDesc', lang)}</p>
                         </div>
                         <div>
                            <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('edrLabel', lang)}</label>
                            <select value={config.expectedDeviationRate || 0} onChange={(e) => handleChange('expectedDeviationRate', Number(e.target.value))} className="w-full px-5 py-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-bold text-[13px] appearance-none cursor-pointer transition-all">
                                {[0, 0.5, 1, 1.5, 2, 2.5, 3, 4].map(val => <option key={val} value={val}>{val}%</option>)}
                            </select>
                            <p className="text-[11px] text-slate-400 mt-2 font-medium leading-tight">{t('edrDesc', lang)}</p>
                         </div>
                    </div>
                </div>
            )}

            {showPM && (
              <div className="animate-fade-in">
                <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('pmLabel', lang)}</label>
                <div className="relative group">
                  <NumberInput value={config.tolerableMisstatement} onChange={(val) => handleChange('tolerableMisstatement', val)} className="w-full px-5 py-3.5 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-black text-[15px]" placeholder={formatMoney(suggestedPM, settings)} />
                </div>
                <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                  <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                  {t('pmDesc', lang)}
                </p>
              </div>
            )}

            {showTrivial && (
                <div className="animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-500 mb-2 uppercase tracking-widest">{t('trivialLabel', lang)}</label>
                    <NumberInput value={config.clearlyTrivialThreshold} onChange={(val) => handleChange('clearlyTrivialThreshold', val)} className="w-full px-5 py-3.5 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 bg-white shadow-sm font-black text-[15px]" placeholder={formatMoney(suggestedTrivial, settings)} />
                    <p className="text-[12px] font-medium text-slate-400 mt-2.5 flex items-start gap-2 italic">
                        <Info className="w-4 h-4 flex-shrink-0 text-brand-400" />
                        {t('trivialDesc', lang)}
                    </p>
                </div>
            )}

            {showConfidence && (
              <div className="animate-fade-in pt-4 border-t border-slate-200">
                <label className="block text-[11px] font-black text-slate-500 mb-4 uppercase tracking-widest">
                  {t('clLabel', lang)}
                </label>
                <div className="flex bg-slate-200/50 p-1.5 rounded-[1rem] border border-slate-200 shadow-inner overflow-x-auto">
                  {[70, 80, 90, 95, 99].map((level) => (
                    <button key={level} onClick={() => handleChange('confidenceLevel', level)} className={`flex-1 py-3 px-2 text-[12px] font-black rounded-xl transition-all ${config.confidenceLevel === level ? 'bg-brand-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}>
                      {level}%
                    </button>
                  ))}
                </div>
                <div className="mt-5 p-5 bg-white rounded-2xl border border-brand-100 flex items-start gap-4 shadow-sm">
                  <Info className="w-5 h-5 flex-shrink-0 text-brand-600 mt-0.5" />
                  <p className="text-[12px] font-medium text-brand-900 leading-relaxed opacity-80 whitespace-pre-line italic">
                    {getConfidenceHelp()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigStep;