import React from 'react';
import { t } from '../../utils/translations';
import { Language } from '../../types';
import { METHOD_PREFIX_MAP } from '../resultsUtils';
import { Calculator, Target, PlayCircle, Network, BarChart3, PieChart, ArrowDownUp, AlertTriangle, Siren, ListChecks, ListFilter, Sigma } from 'lucide-react';

interface MethodSelectorProps {
  currentMethod: string;
  onSelect: (id: string) => void;
  lang: Language;
}

const METHODS = Object.keys(METHOD_PREFIX_MAP);

const METHOD_STYLES: Record<string, { icon: React.ReactNode; colorClass: string; bgClass: string; activeBgClass: string }> = {
  MUS: { icon: <Calculator className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-emerald-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-emerald-50 border-emerald-50' },
  RiskAssessment: { icon: <Siren className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-rose-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-rose-50 border-rose-50' },
  Random: { icon: <ListChecks className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-emerald-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-emerald-50 border-emerald-50' },
  FixedRandom: { icon: <ListFilter className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-emerald-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-emerald-50 border-emerald-50' },
  CVS: { icon: <Sigma className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-orange-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-orange-50 border-orange-50' },
  Attribute: { icon: <Target className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-indigo-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-indigo-50 border-indigo-50' },
  StopOrGo: { icon: <PlayCircle className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-blue-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-blue-50 border-blue-50' },
  Cluster: { icon: <Network className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-purple-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-purple-50 border-purple-50' },
  Benford: { icon: <BarChart3 className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-violet-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-violet-50 border-violet-50' },
  Pareto: { icon: <PieChart className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-amber-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-amber-50 border-amber-50' },
  Percentile: { icon: <ArrowDownUp className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-cyan-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-cyan-50 border-cyan-50' },
  Grubbs: { icon: <AlertTriangle className="w-[22px] h-[22px]" strokeWidth={2} />, colorClass: 'text-red-500', bgClass: 'bg-white border border-slate-100', activeBgClass: 'bg-red-50 border-red-50' }
};

export const MethodSelector: React.FC<MethodSelectorProps> = ({ currentMethod, onSelect, lang }) => {
  return (
    <div className="flex flex-col h-full flex-1 w-full relative z-10 animate-fade-in lg:min-h-0">
      <div className="flex items-center gap-3 mb-0 border-b border-slate-200 pb-5 pt-2 shrink-0 px-4">
        <h3 className="block text-xs font-black text-brand-600 uppercase tracking-[0.2em] flex items-center gap-2">
          {t('methodLabel', lang)}
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-6 space-y-4 custom-scrollbar lg:min-h-0">
        {METHODS.map(m => {
          const isSelected = currentMethod === m;
          const styling = METHOD_STYLES[m] || { icon: <Target className="w-[22px] h-[22px]" strokeWidth={2.5}/>, colorClass: 'text-slate-600', bgClass: 'bg-slate-100' };
          return (
            <button
              key={m}
              onClick={() => onSelect(m)}
              className={`group relative w-full text-left px-5 py-[22px] rounded-[1.75rem] transition-all duration-300 flex items-start gap-5 bg-white ${
                isSelected
                  ? 'border-2 border-[rgb(16,155,90)] shadow-[0_12px_28px_-6px_rgba(0,133,75,0.15)] z-20 scale-[1.02]'
                  : 'border border-transparent hover:border-slate-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)] text-slate-700 hover:bg-slate-50/50'
              }`}
            >
              {isSelected && (
                <div className="absolute top-[18px] right-[18px] w-2.5 h-2.5 rounded-full bg-[rgb(126,206,173)]" />
              )}
              
              <div className={`p-4 rounded-[1.2rem] flex-shrink-0 transition-colors ${styling.colorClass} ${
                isSelected ? styling.activeBgClass : styling.bgClass
              }`}>
                {styling.icon}
              </div>
              
              <div className="flex-1 mt-[3px]">
                <div className={`font-black text-[15px] mb-[6px] tracking-tight transition-colors pr-4 ${
                  isSelected ? 'text-neutral-900' : 'text-slate-700 group-hover:text-neutral-900'
                }`}>
                  {t(METHOD_PREFIX_MAP[m] + 'Name', lang)}
                </div>
                <p className={`text-[13px] leading-snug tracking-[-0.01em] pr-2 ${
                  isSelected ? 'text-slate-500 font-bold' : 'text-slate-400 font-bold'
                }`}>
                  {t(METHOD_PREFIX_MAP[m] + 'Desc', lang)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
