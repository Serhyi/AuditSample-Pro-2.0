
// ResultsStep component
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isElectron } from '../utils/isElectron';

const SyncedScrollContainer = ({ children, setRefs }: any) => {
    const topScrollRef = React.useRef<HTMLDivElement>(null);
    const tableScrollRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = React.useState(0);

    React.useEffect(() => {
        if (setRefs && tableScrollRef.current) {
            setRefs(tableScrollRef.current);
        }
        
        if (!contentRef.current) return;
        const ro = new ResizeObserver((entries) => {
            setWidth(entries[0].target.scrollWidth);
        });
        ro.observe(contentRef.current);
        return () => ro.disconnect();
    }, [setRefs]);

    const onTopScroll = () => {
        if (tableScrollRef.current && topScrollRef.current) tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    };
    const onTableScroll = () => {
        if (tableScrollRef.current && topScrollRef.current) topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
    };

    return (
        <div className="flex flex-col w-full relative">
            <div 
                ref={topScrollRef} 
                onScroll={onTopScroll} 
                className="overflow-x-auto top-scrollbar-sync w-full sticky top-0 z-50 bg-slate-50 border-b border-slate-200"
                style={{ marginBottom: '-1px' }}
            >
                <div style={{ width, height: '1px' }} />
            </div>
            <div 
                ref={tableScrollRef} 
                onScroll={onTableScroll} 
                className="overflow-x-auto custom-scrollbar w-full"
            >
                <div ref={contentRef} className="min-w-max w-full">
                    {children}
                </div>
            </div>
        </div>
    );
};

import { SampledItem, SamplingResult, SamplingConfig, Language, Currency, ColumnIndices, TransactionItem, GlobalSettings } from '../types';
import { calculateExtrapolation, formatMoney, formatDate, smartFormat, methodsSupportingAnomalies } from '../utils/samplingEngine';
import { Upload, Download, CheckCircle2, AlertCircle, ShieldCheck, BookOpen, Sigma, PlayCircle, StopCircle, Calculator, Database, Info, Layers, Target } from 'lucide-react';
import { t } from '../utils/translations';
import { exportToExcel } from '../export/excel';
import { exportToCSV } from '../export/csv';
import { getCalculationDetails, getStaticFormula, METHOD_PREFIX_MAP } from './resultsUtils';

interface ResultsStepProps {
  results: SamplingResult;
  onResultsUpdate: (newResults: SamplingResult) => void;
  config: SamplingConfig;
  lang: Language;
  currency: Currency;
  sourceHeaders: string[];
  colIndices: ColumnIndices;
  getFullPopulation: () => TransactionItem[];
  settings: GlobalSettings;
}

interface SectionProps {
    title: string;
    children?: React.ReactNode;
    icon?: any;
}

const Section = ({ title, children, icon: Icon }: SectionProps) => (
    <div className="space-y-2 border-b border-slate-100 pb-5 last:border-0">
        <h4 className="text-[10px] font-black text-brand-600 uppercase tracking-widest flex items-center gap-2">
            {Icon && <Icon className="w-3.5 h-3.5" />}
            {title}
        </h4>
        <div className="text-[12px] text-slate-700 leading-relaxed font-medium">
            {children}
        </div>
    </div>
);

const DistributionGraphic: React.FC<{ items: SampledItem[], keys: SampledItem[] }> = ({ items, keys }) => {
    const all = [...items, ...keys];
    if (all.length === 0) return null;
    const maxVal = all.length > 0 ? all.reduce((max, i) => Math.max(max, Math.abs(i.bookValue)), 0) : 0;
    
    return (
        <div className="w-full h-32 bg-slate-50 rounded-2xl border border-slate-200 p-4 relative overflow-hidden mb-2 shadow-inner">
            <div className="relative w-full h-full flex items-end justify-around px-2">
                {all.map((item, idx) => {
                    const height = (Math.abs(item.bookValue) / maxVal) * 80;
                    return (
                        <div 
                            key={item.id} 
                            className={`w-1.5 h-1.5 rounded-full absolute transition-all duration-700 ${item.isKeyItem ? 'bg-brand-600 z-10' : 'bg-brand-300 opacity-60'}`}
                            style={{ bottom: `${height}%`, left: `${(idx / all.length) * 95 + 2}%` }}
                        />
                    );
                })}
            </div>
            <div className="absolute bottom-4 left-4 right-4 h-1 bg-slate-200/50 rounded-full" />
        </div>
    );
};

const MoneyInput: React.FC<{ 
  id: string | number, 
  value: number | '', 
  settings: GlobalSettings, 
  onChange: (val: string) => void, 
  onQuickFill: () => void, 
  onKeyDown: (e: React.KeyboardEvent) => void 
}> = ({ id, value, settings, onChange, onQuickFill, onKeyDown }) => {
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState(value === '' ? '' : value.toString().replace('.', ','));
  useEffect(() => { if (!isFocused) setLocalValue(value === '' ? '' : value.toString().replace('.', ',')); }, [value, isFocused]);
  return (
    <input
      id={`audit-input-${id}`}
      type="text"
      inputMode="decimal"
      className="w-full text-right bg-transparent border-b border-brand-300 focus:border-brand-700 focus:outline-none font-mono font-bold text-[13px] cursor-pointer hover:bg-brand-50/50 transition-colors whitespace-nowrap focus:bg-white focus:px-2 rounded-t-sm"
      value={isFocused ? localValue : (value === '' ? '' : formatMoney(Number(value), settings))}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(e) => { setLocalValue(e.target.value); onChange(e.target.value); }}
      onDoubleClick={onQuickFill}
      onKeyDown={onKeyDown}
      autoComplete="off"
    />
  );
};



const TablePagination: React.FC<{ items: SampledItem[], title?: string, isKey?: boolean, renderTable: (items: SampledItem[], title?: string, isKey?: boolean) => React.ReactNode }> = ({ items, title, isKey, renderTable }) => {
   const [page, setPage] = useState(0);
   const PAGE_SIZE = 50;
   
   React.useEffect(() => { setPage(0); }, [items.length, title]);

   const paginated = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
   const totalPages = Math.ceil(items.length / PAGE_SIZE);

   return (
       <div className="flex flex-col h-full relative space-y-4 pb-4">
          <div className="flex-1">
              {renderTable(paginated, title, isKey)}
          </div>
          {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 bg-white border border-slate-200 shadow-sm rounded-xl mx-6 mt-4">
                  <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                      Page {page + 1} of {totalPages} <span className="mx-2">|</span> {items.length} items total
                  </span>
                  <div className="flex items-center gap-2">
                      <button 
                         disabled={page === 0} 
                         onClick={() => setPage(p => p - 1)}
                         className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 text-[11px] font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                         &larr; Prev
                      </button>
                      <button 
                         disabled={page >= totalPages - 1} 
                         onClick={() => setPage(p => p + 1)}
                         className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 text-[11px] font-bold hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 disabled:opacity-50 transition-colors"
                      >
                         Next &rarr;
                      </button>
                  </div>
              </div>
          )}
       </div>
   );
};

const ResultsStep: React.FC<ResultsStepProps> = ({ results: currentResults, onResultsUpdate, config, lang, currency, sourceHeaders, colIndices, getFullPopulation, settings }) => {
  const [activeTab, setActiveTab] = useState<'sample' | 'key'>('sample');

  const extrapolation = useMemo(() => calculateExtrapolation(currentResults, config), [currentResults, config]);
  
  const isAttribute = config.method === 'Attribute';
  const isStopOrGo = config.method === 'StopOrGo';
  
  const mPrefix = useMemo(() => {
      return METHOD_PREFIX_MAP[config.method] || config.method.toLowerCase();
  }, [config.method]);

  const limitValue = isAttribute ? (config.tolerableDeviationRate || 5) : (config.tolerableMisstatement || 0);
  const isExceeded = extrapolation.ub > (isAttribute ? limitValue : limitValue * 1.001);
  const coveragePercent = (currentResults.sampleValue / currentResults.populationValue) * 100;
  const keyItemsValue = currentResults.keyItems.reduce((acc, i) => acc + Math.abs(i.bookValue), 0);

  // Stop-or-Go Calculations for Grid Display
  const stage1Items = useMemo(() => currentResults.samplingItems.filter(i => i.selectionReason?.includes('Stage 1')), [currentResults.samplingItems]);
  const stage1Audited = useMemo(() => stage1Items.filter(i => i.auditedValue !== ''), [stage1Items]);
  const stage1Errors = useMemo(() => stage1Audited.filter(i => Math.abs(i.difference) > 0.001).length, [stage1Audited]);
  const isStage1Complete = stage1Items.length > 0 && stage1Audited.length === stage1Items.length;
  const isStage1Clean = isStage1Complete && stage1Errors === 0;

  const stage2Items = useMemo(() => currentResults.samplingItems.filter(i => i.selectionReason?.includes('Stage 2')), [currentResults.samplingItems]);
  const stage2Audited = useMemo(() => stage2Items.filter(i => i.auditedValue !== ''), [stage2Items]);
  const stage2Errors = useMemo(() => stage2Audited.filter(i => Math.abs(i.difference) > 0.001).length, [stage2Audited]);

  const handleAuditValueChange = (id: string | number, isKey: boolean, rawValue: string | number) => {
    const listKey = isKey ? 'keyItems' : 'samplingItems';
    let clean = String(rawValue).replace(/[\s\u00A0]/g, '');
    const lastComma = clean.lastIndexOf(','), lastDot = clean.lastIndexOf('.');
    if (lastComma > lastDot) clean = clean.replace(/\./g, '').replace(',', '.');
    else if (lastDot > lastComma) clean = clean.replace(/,/g, '');
    else if (lastComma !== -1) clean = clean.replace(',', '.');
    const parsedVal = parseFloat(clean);
    const finalVal: number | '' = isNaN(parsedVal) ? '' : parsedVal;
    
    const list = [...currentResults[listKey]];
    const index = list.findIndex(i => String(i.id) === String(id));
    if (index === -1) return;
    
    const item: SampledItem = { ...list[index], auditedValue: finalVal };
    const auditActual = (item.auditedValue === '' || item.auditedValue === undefined) ? 0 : Number(item.auditedValue);
    item.difference = Math.round((item.bookValue - auditActual) * 100) / 100;
    item.tainting = item.bookValue !== 0 ? item.difference / item.bookValue : 0;
    list[index] = item;
    
    onResultsUpdate({ ...currentResults, [listKey]: [...list] });
  };

  const fillAllVisible = (isKey: boolean) => {
    const listKey = isKey ? 'keyItems' : 'samplingItems';
    const newList = [...currentResults[listKey]];
    let changed = false;
    
    newList.forEach((it, index) => {
        if (it.auditedValue === '') {
            const finalVal = it.bookValue;
            const item: SampledItem = { ...it, auditedValue: finalVal };
            const auditActual = Number(finalVal) || 0; // if finalVal is empty string, this will be 0
            item.difference = Math.round((item.bookValue - auditActual) * 100) / 100;
            item.tainting = item.bookValue !== 0 ? item.difference / item.bookValue : 0;
            newList[index] = item;
            changed = true;
        }
    });

    if (changed) {
        onResultsUpdate({ ...currentResults, [listKey]: newList });
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent, list: SampledItem[], index: number, isKey: boolean) => {
    if (e.key === 'Enter') {
      e.preventDefault(); handleAuditValueChange(list[index].id, isKey, list[index].bookValue);
      const nextId = list[index + 1]?.id;
      if (nextId) document.getElementById(`audit-input-${nextId}`)?.focus();
    } else if (e.key === 'ArrowDown' && list[index+1]) { e.preventDefault(); document.getElementById(`audit-input-${list[index+1].id}`)?.focus(); }
    else if (e.key === 'ArrowUp' && list[index-1]) { e.preventDefault(); document.getElementById(`audit-input-${list[index-1].id}`)?.focus(); }
  };

  const handleExport = async () => {
    const pop = getFullPopulation();

    const fullState = {
        version: "2.0",
        timestamp: Date.now(),
        currentStep: 2,
        population: pop,
        sourceHeaders,
        columnIndices: colIndices,
        config,
        results: currentResults,
        settings
    };

    if (isElectron() && window.api) {
        // Assume virtual if in Electron with API for excel export
        try {
            await (window as any).api.export.excel(fullState);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const dateStr = new Date().toISOString().slice(0,10);
    exportToExcel(fullState, `Audit_Sample_${config.method}_Full_${dateStr}.xlsx`, false, lang);
  };

  const handleExportClient = async () => {
    const clientState = {
        version: "2.0",
        timestamp: Date.now(),
        currentStep: 2,
        sourceHeaders,
        columnIndices: colIndices,
        config,
        results: currentResults,
        settings
    };

    if (isElectron() && window.api) {
        try {
            await (window as any).api.export.excel(clientState);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const dateStr = new Date().toISOString().slice(0,10);
    exportToExcel(clientState, `Audit_Sample_${config.method}_Client_${dateStr}.xlsx`, true, lang);
  };

  const handleImportClient = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
          const { mergeExcelResults } = await import('../export/excelMerge');
          const newResults = await mergeExcelResults(file, currentResults, sourceHeaders.length, colIndices.id);
          const updatedCount = (newResults as any)._importUpdatedCount || 0;
          onResultsUpdate(newResults);
          alert(lang === 'ua' ? `Дані успішно імпортовано з файлу клієнта! Оновлено ${updatedCount} рядків.` : `Data successfully imported from the client file! Updated ${updatedCount} rows.`);
      } catch (err: any) {
          console.error(err);
          alert((lang === 'ua' ? 'Помилка імпорту: ' : 'Import Error: ') + err.message);
      }
      e.target.value = '';
  };



  const renderMethodologyNote = () => {
    const calcDetails = getCalculationDetails(config, currentResults, settings, lang);
    
    // Check if current method supports anomalies
    const isAnomalySupported = methodsSupportingAnomalies.includes(config.method);
    
    let anomalyAlg = t('notApplicable', lang);
    let anomalyDesc = t('anomDescNone', lang);
    if (config.anomalyMethod === 'ModifiedZ' && isAnomalySupported) {
        anomalyAlg = 'Modified Z-Score (Median + MAD)';
        anomalyDesc = t('anomDescModZ', lang);
    }
    
    let trivialActionDesc = t('trivialItemsNotExcluded', lang);
    if (currentResults.areTrivialExcluded) {
        trivialActionDesc = lang === 'ua' 
            ? "Виключені: їх сумарна вартість не створює ризику суттєвого викривлення (МСА 450)."
            : "Excluded: their aggregate value does not pose a risk of material misstatement (ISA 450).";
    } else if (config.clearlyTrivialThreshold > 0) {
        trivialActionDesc = lang === 'ua'
            ? "Залишені: сумарна вартість перевищує ліміти або потребує тестування."
            : "Kept: aggregate value exceeds limits or requires testing.";
    } else {
        trivialActionDesc = t('noneLabel', lang);
    }

    return (
        <div className="bg-white p-7 rounded-[2rem] border border-slate-200 shadow-sm space-y-8 animate-fade-in h-full overflow-y-auto custom-scrollbar">
            <h3 className="text-lg font-display text-neutral-900 flex items-center gap-3 border-b border-slate-100 pb-5">
              <BookOpen className="w-5 h-5 text-brand-600" />
              {t('methodNote', lang)}
            </h3>

            <Section title={t('methodUsed', lang)}>
                <div className="text-brand-900 font-bold text-[14px] mb-2">{t(mPrefix + 'Name', lang)}</div>
                <DistributionGraphic items={currentResults.samplingItems} keys={currentResults.keyItems} />
            </Section>

            <Section title={t('mnPurpose', lang)} icon={Target}>
                {t(mPrefix + 'PurposeText', lang)}
            </Section>

            <Section title={t('mnDescription', lang)} icon={Info}>
                {t(mPrefix + 'EvaluationText', lang)}
            </Section>

            <Section title={t('tabKey', lang)} icon={Layers}>
                <div className="space-y-3">
                    <p className="italic text-slate-500 text-[11px] leading-snug">
                        {t('keyItemsNote', lang)}
                    </p>
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
                        <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{t('anomalyDetection', lang)}</span>
                            <span className="text-neutral-900 font-bold text-[11px]">{anomalyAlg}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 leading-snug">{anomalyDesc}</div>
                        <div className="flex justify-between items-center pt-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase">{t('keyItemsCount', lang)}</span>
                            <span className="text-brand-600 font-mono font-bold">{currentResults.keyItems.length} {t('items', lang)}</span>
                        </div>
                    </div>
                </div>
            </Section>

            <Section title={t('trivialLabel', lang)} icon={Database}>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">{lang === 'ua' ? 'Поріг ВНС' : 'CTT Threshold'}</span>
                        <span className="text-neutral-900 font-bold">{formatMoney(config.clearlyTrivialThreshold, settings)}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 leading-snug">{trivialActionDesc}</div>
                    <div className="flex justify-between items-center pt-1">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">{lang === 'ua' ? 'Кількість ВНС' : 'Trivial count'}</span>
                        <span className="text-slate-600 font-mono font-bold">{currentResults.trivialCount} {t('items', lang)}</span>
                    </div>
                </div>
            </Section>

            <Section title={t('calcTitle', lang)} icon={Calculator}>
                <div className="space-y-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2">
                        {Object.entries(calcDetails.vars).map(([key, val]) => (
                            <div key={key} className="flex justify-between items-baseline border-b border-slate-100 last:border-0 pb-1.5 last:pb-0">
                                <span className="text-slate-500 text-[9px] font-bold uppercase tracking-tighter">{key}</span>
                                <span className="font-mono text-neutral-900 font-bold text-[10px]">{val}</span>
                            </div>
                        ))}
                    </div>
                    <div className="space-y-1">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('mnFormula', lang)}</div>
                        <div className="font-mono text-[11px] text-brand-700 bg-brand-50/50 p-3 rounded-xl border border-brand-100/50 text-center shadow-inner italic">
                          {getStaticFormula(config.method)}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('mnSubstitution', lang)}</div>
                        <div className="font-mono text-[11px] text-neutral-900 bg-white p-3 rounded-xl border border-slate-200 text-center whitespace-pre-wrap shadow-sm">
                          {calcDetails.subst}
                        </div>
                    </div>
                </div>
            </Section>

            <Section title={lang === 'ua' ? "АНАЛІЗ ПОКРИТТЯ" : "COVERAGE ANALYSIS"} icon={Sigma}>
                <div className="space-y-3">
                   <p className="text-[11px] text-slate-600 leading-snug">
                       {lang === 'ua' 
                         ? "Відсоток вартості ген. сукупності, що був безпосередньо перевірений (Вибірка + Ключові)."
                         : "Directly tested percentage of the population value (Sample + Key items)."}
                   </p>
                   <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
                      <div className="w-3/4 bg-slate-200 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-brand-500 h-full shadow-[0_0_8px_rgba(0,133,75,0.3)] transition-all duration-1000" style={{ width: `${Math.min(100, coveragePercent)}%` }}></div>
                      </div>
                      <span className="text-[16px] font-mono font-black text-brand-600">{coveragePercent.toFixed(1)}%</span>
                   </div>
                </div>
            </Section>
        </div>
    );
  };

  const tableContainerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // Scroll all table containers to the right when component mounts or updates
    tableContainerRefs.current.forEach(container => {
      if (container) {
        container.scrollLeft = container.scrollWidth;
      }
    });
    
    // Add another try after a short delay to account for rendering tab switch
    const timer = setTimeout(() => {
      tableContainerRefs.current.forEach(container => {
        if (container) {
          container.scrollLeft = container.scrollWidth;
        }
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [currentResults.samplingItems.length, currentResults.keyItems.length, activeTab]);

  const renderTable = (items: SampledItem[], title?: string, isKey: boolean = false) => (
    <div className="mb-10">
      {title && <div className="px-7 py-4 bg-slate-50 border-y border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-[0.2em] flex items-center gap-3 sticky left-0 shadow-sm z-10">
        <div className={`w-2 h-2 rounded-full ${isKey ? 'bg-brand-600' : 'bg-brand-300'}`} />
        {title}
      </div>}
      <SyncedScrollContainer 
        setRefs={(el: any) => {
            if (el && !tableContainerRefs.current.includes(el)) {
                tableContainerRefs.current.push(el);
            }
        }}
      >
        <table className="min-w-max w-full text-[12px] border-collapse table-auto">
            <thead className="bg-white sticky top-0 z-20 border-b border-slate-200 shadow-sm text-slate-400 font-black">
            <tr>
                {sourceHeaders.map((h, i) => (<th key={i} className="px-6 py-5 whitespace-nowrap text-left border-r border-slate-50 uppercase tracking-tighter text-[10px]">{h}</th>))}
                <th className="px-6 py-5 text-right bg-slate-50/50 border-r border-slate-100 whitespace-nowrap uppercase tracking-tighter text-[10px]">{t('colBook', lang)}</th>
                <th 
                    className="px-6 py-5 text-right bg-brand-50 border-x border-brand-100 text-brand-900 min-w-[170px] whitespace-nowrap uppercase tracking-tighter text-[10px] shadow-[inset_0_-3px_0_rgba(0,133,75,0.2)] cursor-pointer group relative"
                    onClick={(e) => { if (e.ctrlKey) fillAllVisible(isKey); }}
                >
                  {t('colAudit', lang)}
                  <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-neutral-900 text-white text-[9px] rounded shadow-xl whitespace-nowrap z-50 normal-case font-medium">
                      <span className="text-brand-400 font-bold">Ctrl + Click:</span> Автозаповнення
                  </div>
                </th>
                <th className="px-6 py-5 text-right min-w-[130px] whitespace-nowrap border-r border-slate-50 uppercase tracking-tighter text-[10px]">{t('colDiff', lang)}</th>
                <th className="px-6 py-5 text-left min-w-[250px] whitespace-nowrap uppercase tracking-tighter text-[10px]">{t('colComments', lang)}</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
            {items.map((item, idx) => {
                const hasDiff = Math.abs(item.difference) > 0.001;
                return (
                    <tr key={item.id} className="hover:bg-brand-50/10 group transition-all data-table-row">
                        {sourceHeaders.map((_, i) => {
                            let content;
                            if (i === colIndices.date) {
                                content = formatDate(item.date, settings);
                            } else if (i === colIndices.id) {
                                // For the ID/Number column, show as is (plain string or integer)
                                content = item.originalRow[i] !== undefined && item.originalRow[i] !== null 
                                    ? String(item.originalRow[i]).replace('.0', '') 
                                    : '';
                            } else {
                                content = smartFormat(item.originalRow[i], settings);
                            }
                            return (
                                <td key={i} className="px-6 py-4 whitespace-nowrap font-medium text-left text-slate-600 border-r border-slate-50">
                                    {content}
                                </td>
                            );
                        })}
                        <td className="px-6 py-4 text-right font-mono font-bold text-neutral-900 bg-slate-50/20 border-r border-slate-50 whitespace-nowrap">{formatMoney(item.bookValue, settings)}</td>
                        <td className="px-6 py-4 bg-brand-50/30 group-hover:bg-brand-50/50 border-x border-brand-100/50 transition-colors">
                            <MoneyInput id={item.id} value={item.auditedValue} settings={settings} onChange={v => handleAuditValueChange(item.id, isKey, v)} onQuickFill={() => handleAuditValueChange(item.id, isKey, item.bookValue)} onKeyDown={e => handleGridKeyDown(e, items, idx, isKey)} />
                        </td>
                        <td className={`px-6 py-4 text-right font-mono font-bold whitespace-nowrap border-r border-slate-50 transition-colors ${hasDiff ? 'text-red-600' : 'text-slate-300 opacity-60'}`}>
                            {formatMoney(item.difference, settings)}
                        </td>
                        <td className="px-6 py-4">
                            <input type="text" value={item.comments || ''} onChange={(e) => {
                                const listKey = isKey ? 'keyItems' : 'samplingItems';
                                const list = [...currentResults[listKey]];
                                const index = list.findIndex(i => String(i.id) === String(item.id));
                                list[index] = { ...list[index], comments: e.target.value };
                                onResultsUpdate({ ...currentResults, [listKey]: list });
                            }} className="w-full bg-transparent border-b border-transparent focus:border-brand-400 focus:outline-none text-[12px] text-slate-600 placeholder:text-slate-200 transition-colors" placeholder="..." />
                        </td>
                    </tr>
                );
            })}
            </tbody>
        </table>
      </SyncedScrollContainer>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard label={t('totalPop', lang)} value={`${currentResults.populationSize} ${t('items', lang)}`} subValue={`${formatMoney(currentResults.populationValue, settings)} ${currency}`} icon={<Database className="w-4 h-4" />} />
        
        <div className="bg-white p-6 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col relative overflow-hidden group hover:shadow-md transition-all">
          <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-brand-600" />
            {t('sampleSize', lang)}
          </div>
          <div className="flex items-baseline gap-2 justify-end mb-6">
            <span className="text-2xl font-mono font-bold text-brand-600 tracking-tighter">{currentResults.sampleSize}</span>
            <span className="text-[10px] font-black text-slate-400 uppercase">{t('items', lang)}</span>
          </div>
          <div className="mt-auto pt-4 border-t border-slate-50 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] font-bold">
                <span className="text-slate-400 uppercase tracking-widest">Сума вибірки:</span>
                <span className="text-neutral-900 font-mono">{formatMoney(currentResults.sampleValue, settings)} <span className="text-[9px] text-slate-400 ml-0.5">{currency}</span></span>
            </div>
            <div className="flex justify-between items-center text-[10px] font-bold border-l-2 border-brand-500 pl-3">
                <span className="text-slate-400 uppercase tracking-widest">Ключові ел.:</span>
                <span className="text-neutral-900 font-mono">{formatMoney(keyItemsValue, settings)} <span className="text-[9px] text-slate-400 ml-0.5">{currency}</span></span>
            </div>
          </div>
        </div>

        {isStopOrGo ? (
            <StatCard 
                label={t('sogStage1TitleShort', lang)} 
                value={`${stage1Errors} ${t('items', lang)}`} 
                subValue={isStage1Complete ? "Етап 1 завершено" : "Перевірка триває..."} 
                icon={<PlayCircle className="w-4 h-4 text-brand-600" />} 
            />
        ) : (
            <StatCard 
                label={t('projError', lang)} 
                value={isAttribute ? `${extrapolation.projected.toFixed(2)}%` : formatMoney(extrapolation.projected, settings)} 
                subValue={t('projErrorDesc', lang)}
                currency={!isAttribute ? currency : undefined} 
                icon={<Sigma className="w-4 h-4 text-brand-600" />} 
            />
        )}
        
        {isStopOrGo ? (
            <div className={`p-6 rounded-[1.5rem] border shadow-sm flex flex-col transition-all duration-500 ${stage2Errors > 0 ? 'bg-red-50 border-red-200 shadow-red-100/50' : 'bg-brand-50/50 border-brand-200 shadow-brand-100/50'}`}>
                <div className={`text-[10px] font-black uppercase tracking-[0.15em] mb-4 flex items-center gap-2 ${stage2Errors > 0 ? 'text-red-700' : 'text-brand-700'}`}>
                    <StopCircle className={`w-4 h-4 ${stage2Errors > 0 ? 'text-red-600' : 'text-brand-600'}`} />
                    {t('sogStage2TitleShort', lang)}
                </div>
                <div className={`text-base xl:text-lg 2xl:text-xl font-mono font-bold text-right mb-6 break-all ${stage2Errors > 0 ? 'text-red-700' : 'text-brand-700'}`}>
                    {stage2Errors} {t('items', lang)}
                </div>
                <div className="mt-auto pt-4 border-t border-white/50 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                    <span className={stage2Errors > 0 ? 'text-red-400' : 'text-brand-400'}>Резерв:</span>
                    <span className={stage2Errors > 0 ? 'text-red-700 font-black' : 'text-brand-700'}>
                        {isStage1Clean ? t('sogStage2NotReq', lang) : (stage1Errors > 0 ? (lang === 'ua' ? "Потрібно" : "Required") : (lang === 'ua' ? "Очікує" : "Pending"))}
                    </span>
                </div>
            </div>
        ) : (
            <div className={`p-6 rounded-[1.5rem] border shadow-sm flex flex-col transition-all duration-500 ${isExceeded ? 'bg-red-50 border-red-200 shadow-red-100/50' : 'bg-brand-50/50 border-brand-200 shadow-brand-100/50'}`}>
                <div className={`text-[10px] font-black uppercase tracking-[0.15em] mb-4 flex items-center gap-2 ${isExceeded ? 'text-red-700' : 'text-brand-700'}`}>
                    <ShieldCheck className={`w-4 h-4 ${isExceeded ? 'text-red-600' : 'text-brand-600'}`} />
                    {t('upperBound', lang)}
                </div>
                <div className={`text-base xl:text-lg 2xl:text-xl font-mono font-bold text-right mb-6 break-all ${isExceeded ? 'text-red-700' : 'text-brand-700'}`}>
                    {isAttribute ? `${extrapolation.ub.toFixed(2)}%` : formatMoney(extrapolation.ub, settings)}
                    {!isAttribute && <span className="text-sm font-medium opacity-60 ml-1">{currency}</span>}
                </div>
                <div className="mt-auto pt-4 border-t border-white/50 flex justify-between items-center text-[10px] font-bold uppercase tracking-widest">
                    <span className={`${isExceeded ? 'text-red-400' : 'text-brand-400'}`}>
                        {t('upperBoundDesc', lang)}
                    </span>
                    <span className={`${isExceeded ? 'text-red-700' : 'text-brand-700'}`}>{isExceeded ? '>' : '<='} {isAttribute ? `${limitValue}%` : formatMoney(limitValue, settings)}</span>
                </div>
            </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-3 bg-white rounded-[2rem] shadow-sm border border-slate-200 flex flex-col h-[1050px] overflow-hidden transition-all hover:shadow-md">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
            <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
              <button onClick={() => setActiveTab('sample')} className={`px-6 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'sample' ? 'bg-white text-brand-600 shadow-md shadow-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>{t('tabSample', lang)} ({currentResults.samplingItems.length})</button>
              <button onClick={() => setActiveTab('key')} className={`px-6 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'key' ? 'bg-white text-brand-600 shadow-md shadow-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>{t('tabKey', lang)} ({currentResults.keyItems.length})</button>
            </div>
            <div className="flex gap-2">
                <label className="flex items-center gap-3 text-[11px] text-brand-700 font-black uppercase tracking-widest bg-brand-100 border border-brand-300 hover:bg-brand-200 px-7 py-3 rounded-xl transition-all active:scale-95 cursor-pointer">
                    <Download className="w-4 h-4 stroke-[3px]"/> 
                    {lang === 'ua' ? 'Імпорт від клієнта' : 'Import from Client'}
                    <input type="file" accept=".xlsx" className="hidden" onChange={handleImportClient} />
                </label>
                <button onClick={handleExportClient} className="flex items-center gap-3 text-[11px] text-brand-600 font-black uppercase tracking-widest bg-brand-50 border border-brand-200 hover:bg-brand-100 px-7 py-3 rounded-xl transition-all active:scale-95"><Upload className="w-4 h-4 stroke-[3px]"/> {lang === 'ua' ? 'Експорт для клієнта' : 'Export for Client'}</button>
                <button onClick={handleExport} className="flex items-center gap-3 text-[11px] text-white font-black uppercase tracking-widest bg-brand-600 hover:bg-brand-700 px-7 py-3 rounded-xl shadow-[0_4px_12px_rgba(0,133,75,0.25)] transition-all active:scale-95"><Upload className="w-4 h-4 stroke-[3px]"/> {t('exportBtn', lang)}</button>
            </div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar">
            {activeTab === 'key' ? 
                <TablePagination items={currentResults.keyItems} title={t('tabKey', lang)} isKey={true} renderTable={renderTable} /> : 
                (config.method === 'StopOrGo' ? <StopOrGoView currentResults={currentResults} lang={lang} renderTable={renderTable} /> : <TablePagination items={currentResults.samplingItems} renderTable={renderTable} />)
            }
          </div>
        </div>
        <div className="lg:col-span-1 h-[1050px]">{renderMethodologyNote()}</div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, subValue, icon, currency }: { label: string, value: string | number, subValue: string, icon: React.ReactNode, currency?: string }) => (
    <div className="bg-white p-6 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col relative overflow-hidden group hover:shadow-md transition-all">
      <div className="text-slate-400 text-[10px] font-black uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
        {icon}
        {label}
      </div>
      <div className="text-base xl:text-lg 2xl:text-xl font-mono font-bold text-neutral-900 text-right mb-6 group-hover:text-brand-600 transition-colors break-all">
          {value}
          {currency && <span className="text-sm font-medium text-slate-400 ml-1">{currency}</span>}
      </div>
      <div className="mt-auto pt-4 border-t border-slate-50 flex justify-end text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
         {subValue}
      </div>
    </div>
);

const StopOrGoView = ({ currentResults, lang, renderTable }: { currentResults: SamplingResult, lang: Language, renderTable: any }) => {
    let stage1Items = currentResults.samplingItems.filter(i => i.selectionReason?.includes('Stage 1'));
    let stage2Items = currentResults.samplingItems.filter(i => i.selectionReason?.includes('Stage 2'));

    // Backward compatibility if selectionReason is empty
    if (stage1Items.length === 0 && stage2Items.length === 0 && currentResults.samplingItems.length > 0) {
        const half = Math.ceil(currentResults.samplingItems.length / 2);
        stage1Items = currentResults.samplingItems.slice(0, half);
        stage2Items = currentResults.samplingItems.slice(half);
    }
    
    const stage1Audited = stage1Items.filter(i => i.auditedValue !== '');
    const stage1Errors = stage1Audited.filter(i => Math.abs(i.difference) > 0.001).length;
    
    const stage2Audited = stage2Items.filter(i => i.auditedValue !== '');
    const stage2Errors = stage2Audited.filter(i => Math.abs(i.difference) > 0.001).length;

    const isStage1Complete = stage1Audited.length === stage1Items.length;
    const isStage1Clean = isStage1Complete && stage1Errors === 0;
    
    const isStage2Complete = stage2Audited.length === stage2Items.length;

    return (
        <div className="space-y-10 pb-10">
            <div className={`mx-6 mt-6 p-6 rounded-3xl border ${isStage1Clean ? 'bg-brand-50 border-brand-100 shadow-brand-50' : (stage1Errors > 0 ? 'bg-red-50 border-red-100 shadow-red-50' : 'bg-slate-50 border-slate-200')} transition-all shadow-lg`}>
                <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center bg-white shadow-sm border border-slate-100 ${isStage1Clean ? 'text-brand-600' : (stage1Errors > 0 ? 'text-red-600' : 'text-slate-400')}`}>
                        {isStage1Clean ? <StopCircle className="w-8 h-8" /> : <PlayCircle className="w-8 h-8" />}
                    </div>
                    <div>
                        <h4 className="font-bold text-[15px] text-neutral-900">{isStage1Clean ? t('sogStatusStop', lang) : (stage1Errors > 0 ? t('sogStatusGo', lang) : t('sogStage1TitleShort', lang))}</h4>
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-1 flex items-center gap-2">{t('sogErrorsFound', lang)} <span className={`px-2 py-0.5 rounded-lg border ${stage1Errors > 0 ? 'bg-red-100 border-red-200 text-red-700' : 'bg-brand-100 border-brand-200 text-brand-700'}`}>{stage1Errors}</span></div>
                    </div>
                </div>
            </div>

            <TablePagination items={stage1Items} title={t('sogStage1Title', lang)} renderTable={renderTable} />

            <div className={`transition-all duration-700 ${isStage1Clean ? 'opacity-30 grayscale blur-[2px] pointer-events-none scale-[0.98]' : 'opacity-100'}`}>
                <TablePagination items={stage2Items} title={t('sogStage2Title', lang)} renderTable={renderTable} />
                
                {!isStage1Clean && (stage2Errors > 0 || isStage2Complete) && (
                  <div className={`mx-6 mt-4 p-5 rounded-2xl border flex items-start gap-4 animate-fade-in ${stage2Errors > 0 ? 'bg-red-50 border-red-200 text-red-800 shadow-[0_10px_30px_rgba(239,68,68,0.1)]' : 'bg-brand-50 border-brand-200 text-brand-800'}`}>
                      <AlertCircle className={`w-5 h-5 shrink-0 mt-0.5 ${stage2Errors > 0 ? 'text-red-600' : 'text-brand-600'}`} />
                      <div className="space-y-1">
                          <div className="text-[11px] font-black uppercase tracking-widest opacity-60">
                              {t('sogStage2ErrorsFound', lang)} <span className="font-mono">{stage2Errors}</span>
                          </div>
                          <p className="text-[13px] font-bold leading-relaxed">
                              {stage2Errors > 0 ? t('sogStage2StatusFail', lang) : t('sogStage2StatusSuccess', lang)}
                          </p>
                      </div>
                  </div>
                )}
            </div>
        </div>
    );
};



export default ResultsStep;
