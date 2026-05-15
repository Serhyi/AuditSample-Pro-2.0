
import React, { useState, useCallback, useEffect } from 'react';
import { ChevronRight, Check, Globe, Info, X, Settings as SettingsIcon, Loader2, Award, BookOpen, AlertCircle, Save, FolderOpen } from 'lucide-react';
import ImportStep from './components/ImportStep';
import ConfigStep from './components/ConfigStep';
import ResultsStep from './components/ResultsStep';
import { TransactionItem, SamplingConfig, SamplingResult, Currency, ColumnIndices, GlobalSettings } from './types';
import ExcelJS from 'exceljs';
import { runSampling } from './utils/samplingEngine';
import { t } from './utils/translations';
import { useAppStorage } from './contexts/StorageContext';
import { usePopulationAdapter } from './adapters/usePopulationAdapter';
import { isElectron } from './utils/isElectron';

const LogoFull = ({ height = 40 }: { height?: number }) => {
  return (
    <svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0" y="0" viewBox="0 0 300 114.3" style={{ height, width: "auto" }} xmlSpace="preserve">
      <g>
        <path fill="#00854b" d="M99.3 45.2 68.6 74.8 29 113h117.1V0z"/>
        <path fill="#00854b" d="m94.7 49.7 5.6-5.5H25.2v5.5z"/>
        <path fill="#fff" d="M125.6 49.7v-5.5h-25.3l-5.6 5.5z"/>
        <path fill="#00854b" d="m83.3 60.6 5.6-5.4H12.2v5.4z"/>
        <path fill="#fff" d="M125.6 60.6v-5.4H88.9l-5.6 5.4z"/>
        <path fill="#00854b" d="M0 66.7v5.5h71.4l5.6-5.5z"/>
        <path fill="#fff" d="M71.4 72.2h54.2v-5.5H77z"/>
        <path fill="#00854b" d="M195.7 67.4h56.2c.4-2.1.6-4.3.8-6.5h-69.1v-5.4h69.2c-.1-2-.2-4-.5-6h-56.5V44h55.5C245.3 18.9 222.8.1 195.8.1c-17.7 0-33.6 8.1-44.1 20.8v72.6c10.5 12.7 26.3 20.8 44.1 20.8 26.1 0 48.1-17.6 54.9-41.5h-54.9v-5.4z"/>
        <path fill="#00854b" d="M252.7 60.9h34.6v-5.4h-34.5c0 .6.1 1.2.1 1.8 0 1.2-.1 2.4-.2 3.6z"/>
        <path fill="#fff" d="M183.6 60.8h69.1c.1-1.2.2-2.4.2-3.6 0-.6-.1-1.2-.1-1.8h-69.2v5.4z"/>
        <path fill="#00854b" d="M300 67.4h-48.1c-.3 1.8-.8 3.6-1.3 5.4H300v-5.4z"/>
        <path fill="#fff" d="M195.7 67.4v5.4h54.9c.5-1.8.9-3.6 1.3-5.4h-56.2z"/>
        <path fill="#00854b" d="M299.6 49.5V44h-48.4c.4 1.8.8 3.6 1 5.4h47.4z"/>
        <path fill="#fff" d="M195.7 49.5h56.5c-.2-1.8-.6-3.7-1-5.4h-55.5v5.4z"/>
      </g>
    </svg>
  );
};

const LogoMark = ({ size = 32 }: { size?: number }) => (
  <LogoFull height={size} />
);

const App: React.FC = () => {
  const { settings, updateSettings, isReady } = useAppStorage();
  
  const lang = settings.language;
  const currency = settings.currency;

  const [currentStep, setCurrentStep] = useState(0);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'about' | 'license'>('about');
  
  const { getFullPopulation, setPopulation, refreshStats, totalPopValue, isVirtual } = usePopulationAdapter([]);
  const [sourceHeaders, setSourceHeaders] = useState<string[]>([]);
  const [columnIndices, setColumnIndices] = useState<ColumnIndices>({id: -1, date: -1, amount: -1});

  const [config, setConfig] = useState<SamplingConfig>({
    method: 'MUS',
    confidenceLevel: 90,
    tolerableMisstatement: 0,
    expectedMisstatement: 0,
    clearlyTrivialThreshold: 0,
    riskFactor: 'Moderate',
    anomalyMethod: 'ModifiedZ',
    stopOrGoInitialSize: 25,
    stopOrGoExpansionSize: 25,
    seed: Math.floor(Math.random() * 100000)
  });
  const [results, setResults] = useState<SamplingResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [samplingError, setSamplingError] = useState<string | null>(null);

  const steps = [t('step1', lang), t('step2', lang), t('step3', lang)];

  const exportProject = async () => {
    const projectData = {
      version: "2.0",
      timestamp: Date.now(),
      currentStep,
      population: getFullPopulation(),
      sourceHeaders,
      columnIndices,
      config,
      results,
      settings
    };
    
    if (isElectron() && window.api && isVirtual) {
        try {
            await window.api.export.project(projectData);
        } catch (e) {
            console.error(e);
        }
        return;
    }

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Audit_Sample_${config.method}_${new Date().toISOString().slice(0,10)}.audsmpl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Electron optimized path for DuckDB .audsmpl
    if (file.name.endsWith('.audsmpl') && isElectron() && window.api) {
        try {
            const rawFilePath = (file as any).path;
            const data = await window.api.import.project(rawFilePath);
            
            await refreshStats();
            setSourceHeaders(data.sourceHeaders || []);
            setColumnIndices(data.columnIndices || {id: -1, date: -1, amount: -1});
            setConfig(data.config);
            setResults(data.results);
            if (data.settings) updateSettings(data.settings);
            setCurrentStep(data.currentStep || 0);
        } catch (e: any) {
            console.error(e);
            setSamplingError(t('errInvalidProjectFormat', lang));
        }
        return;
    }

    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const content = event.target?.result;
        
        if (file.name.endsWith('.xlsx')) {
            const workbook = new ExcelJS.Workbook();
            workbook.xlsx.load(content as ArrayBuffer).then(async () => {
                const metadataSheet = workbook.getWorksheet('_metadata');
                
                if (metadataSheet) {
                    let jsonString = '';
                    metadataSheet.eachRow((row) => {
                        const cell = row.getCell(1);
                        if (cell && cell.value) {
                            jsonString += String(cell.value);
                        }
                    });
                    
                    try {
                        const metadata = JSON.parse(jsonString);
                        if (metadata.version && Array.isArray(metadata.population)) {
                           const parseAmount = (rawAmt: any): number => {
                               if (typeof rawAmt === 'number') return rawAmt;
                               if (rawAmt === null || rawAmt === undefined) return NaN;
                               let str = String(rawAmt).trim();
                               if (str === '') return NaN;
                               if (str.startsWith('(') && str.endsWith(')')) str = '-' + str.slice(1, -1);
                               const cleanStr = str.replace(/[\s\u00A0\u200B$€£₴]/g, ''); 
                               if (cleanStr.includes(',') && !cleanStr.includes('.')) return parseFloat(cleanStr.replace(',', '.'));
                               if (cleanStr.includes(',') && cleanStr.includes('.')) {
                                   const lastDot = cleanStr.lastIndexOf('.');
                                   const lastComma = cleanStr.lastIndexOf(',');
                                   if (lastComma > lastDot) return parseFloat(cleanStr.replace(/\./g, '').replace(',', '.'));
                                   else return parseFloat(cleanStr.replace(/,/g, ''));
                               }
                               return parseFloat(cleanStr);
                           };

                           const updateItemsFromSheet = (items: any[], sheetNameEn: string, sheetNameUa: string) => {
                               const sheet = workbook.getWorksheet(sheetNameEn) || workbook.getWorksheet(sheetNameUa);
                               if (sheet && items && items.length > 0) {
                                   const data: any[][] = [];
                                   sheet.eachRow((row) => {
                                       const rowData: any[] = [];
                                       row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                                           rowData[colNumber - 1] = cell.value?.valueOf() ?? null;
                                       });
                                       data.push(rowData);
                                   });
                                   
                                   const N = metadata.sourceHeaders.length;
                                   const idColIdx = metadata.columnIndices.id;
                                   
                                   const rowMap = new Map<string, any[][]>();
                                   for (let i = 1; i < data.length; i++) {
                                   const row = data[i];
                                   if (row && row.length > idColIdx) {
                                       const idVal = String(row[idColIdx]).trim().replace('.0', '');
                                       if (!rowMap.has(idVal)) rowMap.set(idVal, []);
                                       rowMap.get(idVal)!.push(row);
                                   }
                               }

                               for (let i = 0; i < items.length; i++) {
                                   const item = items[i];
                                   const idVal = String(item.id).trim().replace('.0', '');
                                   let row;
                                   
                                   if (rowMap.has(idVal) && rowMap.get(idVal)!.length > 0) {
                                       row = rowMap.get(idVal)!.shift();
                                   } else if (data[i + 1]) {
                                       const fallbackRow = data[i + 1];
                                       if (fallbackRow && fallbackRow.length > N) {
                                           const fallbackBookVal = parseAmount(fallbackRow[N]);
                                           if (!isNaN(fallbackBookVal) && Math.abs(fallbackBookVal - item.bookValue) < 0.01) {
                                               row = fallbackRow;
                                           }
                                       }
                                   }

                                   if (row) {
                                       const auditVal = row[N + 1];
                                       const comments = row[N + 3];
                                       
                                       if (auditVal !== undefined && auditVal !== null && auditVal !== '') {
                                           const parsedAuditVal = parseAmount(auditVal);
                                           if (!isNaN(parsedAuditVal)) {
                                               item.auditedValue = parsedAuditVal;
                                               item.difference = item.bookValue - parsedAuditVal;
                                           } else {
                                               item.auditedValue = '';
                                               item.difference = item.bookValue; // If empty, diff is bookValue
                                           }
                                       } else {
                                           item.auditedValue = '';
                                           item.difference = item.bookValue; // If empty, diff is bookValue
                                       }
                                       
                                       item.comments = comments !== undefined && comments !== null ? String(comments) : '';
                                   }
                               }
                           }
                       };

                       if (metadata.results) {
                           updateItemsFromSheet(metadata.results.samplingItems, 'Sample', 'Вибірка');
                           if (metadata.results.keyItems) {
                               updateItemsFromSheet(metadata.results.keyItems, 'Key', 'Ключові');
                           }
                       }

                       if (isElectron() && window.api && isVirtual) {
                           await window.api.query.insertRows('population', metadata.population);
                           await refreshStats();
                       } else {
                           setPopulation(metadata.population);
                       }
                       setSourceHeaders(metadata.sourceHeaders || []);
                       setColumnIndices(metadata.columnIndices || {id: -1, date: -1, amount: -1});
                       setConfig(metadata.config);
                       setResults(metadata.results);
                       if (metadata.settings) updateSettings(metadata.settings);
                       setCurrentStep(metadata.currentStep || 0);
                    } else {
                       setSamplingError(t('errInvalidExcelProject', lang));
                    }
                } catch {
                    setSamplingError(t('errParseExcelMeta', lang));
                }
            } else {
                setSamplingError(t('errNoExcelMeta', lang));
            }
        }).catch(() => setSamplingError(t('errLoadExcel', lang)));
        } else {
            const data = JSON.parse(content as string);
            
            if (data.version && Array.isArray(data.population)) {
               if (isElectron() && window.api && isVirtual) {
                   await window.api.query.insertRows('population', data.population);
                   await refreshStats();
               } else {
                   setPopulation(data.population);
               }
               setSourceHeaders(data.sourceHeaders || []);
               setColumnIndices(data.columnIndices || {id: -1, date: -1, amount: -1});
               setConfig(data.config);
               setResults(data.results);
               if (data.settings) updateSettings(data.settings);
               setCurrentStep(data.currentStep || 0);
            } else {
               setSamplingError(t('errInvalidProjectFormat', lang));
            }
        }
      } catch (err) {
        console.error("Error importing project:", err);
        setSamplingError(t('errReadProject', lang));
      }
    };

    if (file.name.endsWith('.xlsx')) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }

    // Reset input value to allow re-importing same file
    e.target.value = '';
  };

  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [currentParsedData, setCurrentParsedData] = useState<TransactionItem[]>([]);

  const [currentStartRow, setCurrentStartRow] = useState<number>(2);

  const handleDataLoaded = useCallback(async (filePath: string | null, headers: string[], indices: ColumnIndices, startRow: number, parsedData?: TransactionItem[]) => {
    if (filePath) setCurrentFilePath(filePath);
    if (parsedData) setCurrentParsedData(parsedData);
    setSourceHeaders(headers);
    setColumnIndices(indices);
    setCurrentStartRow(startRow);
  }, []);

  const handleContinueFromImport = async () => {
      setIsProcessing(true);
      try {
          if (isElectron() && currentFilePath && window.api) {
              await window.api.import.start(currentFilePath, { 
                  activeIndices: columnIndices, 
                  startRow: currentStartRow
              });
              await refreshStats();
          } else if (currentParsedData.length > 0) {
              setPopulation(currentParsedData);
          }
          setCurrentStep(1);
      } catch (e) {
          console.error(e);
      } finally {
          setIsProcessing(false);
      }
  };

  useEffect(() => {
    if (totalPopValue > 0 && config.tolerableMisstatement === 0) {
        setConfig(prev => ({ ...prev, tolerableMisstatement: Math.floor(totalPopValue * 0.01) }));
    }
  }, [totalPopValue, config.tolerableMisstatement]);

  const handleRunSampling = async () => {
    setIsProcessing(true);
    setSamplingError(null);
    try {
        let res;
        if (isElectron() && window.api && isVirtual) {
            console.log('Dispatching sampling to DuckDB engine via IPC');
            res = await window.api.sampling.execute(config);
        } else {
            console.log('Running sampling in browser memory');
            res = runSampling(getFullPopulation(), config);
        }
        setResults(res);
        setCurrentStep(2);
    } catch (e: unknown) {
        let errorMsg = e instanceof Error ? e.message : t('errUnknownSampling', lang);
        if (errorMsg === 'Population cannot be empty') errorMsg = t('errPopEmpty', lang);
        else if (errorMsg === 'Tolerable misstatement must be positive') errorMsg = t('errTMPositive', lang);
        else if (errorMsg === 'Confidence level must be between 0 and 1') errorMsg = t('errCLBetween01', lang);
        else if (errorMsg === 'Sample count cannot exceed population size') errorMsg = t('errSampleCount', lang);
        setSamplingError(errorMsg);
    } finally {
        setIsProcessing(false);
    }
  };

  const toggleLanguage = () => {
    updateSettings({ ...settings, language: lang === 'en' ? 'ua' : 'en' });
  };

  const setCurrency = (c: Currency) => {
    updateSettings({ ...settings, currency: c });
  };

  const renderRichText = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return (
          <h4 key={i} className="text-base font-bold text-brand-700 mt-8 mb-4 border-b border-brand-100 pb-1 uppercase tracking-tight font-sans">
            {line.replace('### ', '')}
          </h4>
        );
      }
      
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <p key={i} className="mb-2 leading-relaxed text-[13px]">
          {parts.map((part, pi) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={pi} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
            }
            return part;
          })}
        </p>
      );
    });
  };

  if (!isReady) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-brand-600" />
        <p className="font-mono text-xs uppercase tracking-widest">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-neutral-900 flex flex-col selection:bg-brand-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <LogoFull height={32} />
            <div className="flex items-baseline gap-1.5 ml-1">
              <span className="text-xl font-bold text-neutral-900 tracking-tight">{t('appTitle', lang).replace(' Pro', '')}</span>
              <span className="text-xl font-light text-brand-600">Pro</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-xs font-bold text-slate-400 hidden md:flex items-center gap-2 border-r border-slate-200 pr-5 mr-1 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></span>
                {t('appSubtitle', lang)}
             </div>
             
             <div className="flex items-center gap-2 mr-2 border-r border-slate-200 pr-4">
                <button onClick={exportProject} title={lang === 'ua' ? "Зберегти проєкт" : "Save Project"} className="p-2 text-slate-500 hover:text-brand-600 hover:bg-slate-50 rounded-full transition-all">
                  <Save className="w-5 h-5" />
                </button>
                <label title={lang === 'ua' ? "Відкрити проєкт" : "Open Project"} className="p-2 text-slate-500 hover:text-brand-600 hover:bg-slate-50 rounded-full transition-all cursor-pointer">
                  <FolderOpen className="w-5 h-5" />
                  <input type="file" accept=".audsmpl,.xlsx" className="hidden" onChange={importProject} />
                </label>
             </div>

             <button onClick={() => setShowSettingsModal(true)} title={t('settingsTitle', lang)} className="p-2 text-slate-500 hover:text-brand-600 hover:bg-slate-50 rounded-full transition-all"><SettingsIcon className="w-5 h-5" /></button>
             <button onClick={() => setShowInfoModal(true)} title={t('aboutBtn', lang)} className="p-2 text-slate-500 hover:text-brand-600 hover:bg-slate-50 rounded-full transition-all"><Info className="w-5 h-5" /></button>
             <button onClick={toggleLanguage} className="flex items-center gap-2 text-[11px] font-black text-slate-600 hover:text-brand-600 transition-all bg-white border border-slate-200 hover:border-brand-300 px-4 py-1.5 rounded-full uppercase tracking-tighter shadow-sm"><Globe className="w-3.5 h-3.5 text-brand-500" />{lang === 'en' ? 'UA' : 'EN'}</button>
          </div>
        </div>
      </header>

      {/* Global Error Banner */}
      {samplingError && (
          <div className="bg-red-600 text-white px-6 py-3 shadow-md flex items-center justify-center gap-3 animate-fade-in sticky top-16 z-20">
              <AlertCircle className="w-5 h-5" />
              <span className="font-bold text-sm">{samplingError}</span>
              <button onClick={() => setSamplingError(null)} className="ml-4 hover:bg-red-700 p-1 rounded"><X className="w-4 h-4" /></button>
          </div>
      )}

      <main className="flex-1 max-w-[1600px] mx-auto px-6 py-10 w-full">
        <div className="mb-14">
          <div className="flex items-center justify-center">
            {steps.map((step, idx) => (
              <React.Fragment key={idx}>
                <div className="flex items-center group">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 ${
                    currentStep > idx ? 'bg-brand-600 text-white shadow-md' : 
                    currentStep === idx ? 'bg-white border-2 border-brand-500 text-brand-700 shadow-sm' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {currentStep > idx ? <Check className="w-4 h-4 stroke-[3px]" /> : <span className="text-xs font-black">{idx + 1}</span>}
                  </div>
                  <span className={`ml-3 text-[13px] font-bold tracking-tight ${currentStep === idx ? 'text-neutral-900' : 'text-slate-400'}`}>
                    {step}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`w-20 h-[2px] mx-8 rounded-full transition-colors duration-500 ${currentStep > idx ? 'bg-brand-400' : 'bg-slate-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto">
          {currentStep === 0 && (
            <div className="space-y-8">
                <ImportStep 
                  onDataLoaded={handleDataLoaded} 
                  onImportProject={importProject}
                  lang={lang} 
                  currency={currency}
                  setCurrency={setCurrency}
                  settings={settings}
                />
                <div className="flex justify-end">
                    <button 
                        disabled={!currentFilePath && currentParsedData.length === 0}
                        onClick={handleContinueFromImport}
                        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 text-white px-10 py-3.5 rounded-xl text-sm font-bold transition-all shadow-[0_4px_12px_rgba(0,133,75,0.25)] active:scale-95"
                    >
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{t('continue', lang)} <ChevronRight className="w-4 h-4" /></>}
                    </button>
                </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-8">
                <ConfigStep 
                    config={config} 
                    setConfig={setConfig} 
                    totalPopulationValue={totalPopValue}
                    lang={lang}
                    settings={settings}
                />
                <div className="flex justify-between">
                     <button onClick={() => setCurrentStep(0)} className="text-brand-600 bg-white border border-brand-200 hover:bg-brand-50 px-10 py-3.5 rounded-xl text-sm font-bold transition-all shadow-sm">{t('back', lang)}</button>
                    <button onClick={handleRunSampling} disabled={isProcessing} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-12 py-3.5 rounded-xl text-sm font-bold transition-all shadow-[0_4px_12px_rgba(0,133,75,0.25)] disabled:opacity-70">{isProcessing ? t('processing', lang) : t('run', lang)}</button>
                </div>
            </div>
          )}

          {currentStep === 2 && results && (
            <div className="space-y-8">
                <ResultsStep 
                  results={results} 
                  onResultsUpdate={setResults}
                  config={config} 
                  lang={lang} 
                  currency={currency}
                  sourceHeaders={sourceHeaders}
                  colIndices={columnIndices}
                  getFullPopulation={getFullPopulation}
                  settings={settings}
                />
                <div className="flex justify-start">
                     <button onClick={() => setCurrentStep(1)} className="text-white bg-brand-600 hover:bg-brand-700 px-10 py-3.5 rounded-xl text-sm font-bold transition-all shadow-[0_4px_12px_rgba(0,133,75,0.25)]">{t('restart', lang)}</button>
                </div>
            </div>
          )}
        </div>
      </main>

      <footer className="w-full max-w-[1600px] mx-auto px-6 py-12 border-t border-slate-200 mt-auto">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <LogoMark size={20} />
            <span className="text-[12px] text-slate-500 font-medium tracking-tight">{t('footerCopyright', lang)}</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1 bg-brand-50 rounded-full">
              <span className="w-1.5 h-1.5 bg-brand-600 rounded-full"></span>
              <span className="text-[10px] font-black text-brand-700 uppercase tracking-widest">{t('isaCompliant', lang)}</span>
            </div>
            <div className="text-[10px] font-mono text-slate-300 uppercase tracking-widest">{t('appVersion', lang)}</div>
          </div>
        </div>
      </footer>

      {/* Модальні вікна */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-neutral-900/70 backdrop-blur-md animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col border border-slate-200">
            <div className="flex items-center justify-between p-7 border-b bg-slate-50/50">
              <div className="flex items-center gap-3">
                 <div className="bg-brand-600 p-2 rounded-lg shadow-inner"><Info className="w-5 h-5 text-white" /></div>
                 <h2 className="text-2xl font-display text-neutral-900">{t('aboutTitle', lang)}</h2>
              </div>
              <button onClick={() => setShowInfoModal(false)} className="text-slate-400 hover:text-neutral-900 transition-all p-2 hover:bg-slate-100 rounded-full"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="flex border-b px-7">
               <button onClick={() => setActiveTab('about')} className={`py-4 text-[13px] font-bold flex items-center gap-2 transition-all relative mr-8 ${activeTab === 'about' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
                 <BookOpen className="w-4 h-4" /> {t('tabAbout', lang)}
                 {activeTab === 'about' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-brand-600 rounded-t-full" />}
               </button>
               <button onClick={() => setActiveTab('license')} className={`py-4 text-[13px] font-bold flex items-center gap-2 transition-all relative ${activeTab === 'license' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
                 <Award className="w-4 h-4" /> {t('tabLicense', lang)}
                 {activeTab === 'license' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-brand-600 rounded-t-full" />}
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-9 custom-scrollbar bg-white">
               {activeTab === 'about' ? (
                 <div className="space-y-12 animate-fade-in">
                    <section>
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-1.5 h-7 bg-brand-600 rounded-full" />
                        <h3 className="text-xl font-display text-neutral-900">{t('decisionTreeTitle', lang)}</h3>
                      </div>
                      <div className="bg-neutral-950 p-7 rounded-xl font-mono text-[12.5px] leading-relaxed text-brand-200 border border-neutral-800 shadow-xl overflow-x-auto whitespace-pre">
                        {t('decisionTreeContent', lang)}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-1.5 h-7 bg-brand-600 rounded-full" />
                        <h3 className="text-xl font-display text-neutral-900">{t('tabAbout', lang)}</h3>
                      </div>
                      <div className="bg-slate-50 p-8 rounded-2xl border border-slate-200 leading-relaxed text-slate-700 shadow-sm font-medium">
                        {renderRichText(t('methodologyDetailed', lang))}
                      </div>
                    </section>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 border-t border-slate-100 pt-10">
                       <section>
                         <h4 className="font-black text-brand-600 mb-3 uppercase text-[10px] tracking-[0.15em]">{t('authorLabel', lang)}</h4>
                         <p className="text-sm text-neutral-900 font-bold">{t('authorName', lang)}</p>
                       </section>
                       <section>
                         <h4 className="font-black text-brand-600 mb-3 uppercase text-[10px] tracking-[0.15em]">{t('firmLabel', lang)}</h4>
                         <p className="text-sm text-neutral-900 font-bold">{t('firmName', lang)}</p>
                       </section>
                    </div>
                 </div>
               ) : (
                 <div className="animate-fade-in space-y-8">
                    <div className="bg-brand-50/50 border border-brand-100 p-8 rounded-2xl text-brand-900 shadow-sm">
                       <h3 className="font-bold text-brand-800 uppercase text-[11px] tracking-widest mb-6 border-b border-brand-100 pb-3">{t('licenseTermsLabel', lang)}</h3>
                       <p className="text-[13px] font-medium whitespace-pre-wrap leading-relaxed opacity-80">{t('licenseContent', lang)}</p>
                    </div>
                    <p className="text-[11px] text-slate-400 text-center font-bold uppercase tracking-[0.2em] pt-4">{t('copyright', lang)}</p>
                 </div>
               )}
            </div>

            <div className="p-7 border-t bg-slate-50/30 text-right">
              <button onClick={() => setShowInfoModal(false)} className="px-10 py-2.5 bg-brand-600 text-white text-[13px] font-bold rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-100 transition-all">{t('ok', lang)}</button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-neutral-900/70 backdrop-blur-md animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
                  <div className="flex items-center justify-between p-7 border-b bg-slate-50/50">
                      <h2 className="text-xl font-display text-neutral-900 flex items-center gap-2"><SettingsIcon className="w-5 h-5 text-brand-600" />{t('settingsTitle', lang)}</h2>
                      <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-neutral-900 p-2 hover:bg-slate-100 rounded-full transition-all"><X className="w-6 h-6" /></button>
                  </div>
                  <div className="p-8 space-y-8">
                      <div>
                          <label className="block text-[10px] font-black text-brand-600 mb-3 uppercase tracking-[0.15em]">{t('settingRegion', lang)}</label>
                          <div className="grid grid-cols-3 gap-2">
                              {(['ua', 'us', 'eu'] as const).map((r) => (
                                  <button
                                      key={r}
                                      onClick={() => updateSettings({
                                          ...settings, 
                                          region: r, 
                                          dateFormat: r === 'us' ? 'mm/dd/yyyy' : 'dd.mm.yyyy', 
                                          numberSeparator: r === 'us' ? 'comma_dot' : (r === 'ua' ? 'space_comma' : 'dot_comma')
                                      })}
                                      className={`py-2.5 text-[11px] rounded-xl border text-center transition-all ${settings.region === r ? 'bg-brand-50 border-brand-600 text-brand-800 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{r === 'ua' ? 'Ukraine' : (r === 'us' ? 'USA' : 'Europe')}</button>
                              ))}
                          </div>
                      </div>
                      <div>
                          <label className="block text-[10px] font-black text-brand-600 mb-3 uppercase tracking-[0.15em]">{t('settingDate', lang)}</label>
                          <select 
                            className="w-full border border-slate-200 rounded-xl p-3.5 text-[13px] font-medium focus:ring-2 focus:ring-brand-500 outline-none transition-all bg-slate-50" 
                            value={settings.dateFormat} 
                            onChange={(e) => updateSettings({...settings, dateFormat: e.target.value as GlobalSettings['dateFormat']})}
                          >
                              <option value="dd.mm.yyyy">DD.MM.YYYY (30.09.2025)</option>
                              <option value="mm/dd/yyyy">MM/DD/YYYY (09/30/2025)</option>
                              <option value="yyyy-mm-dd">YYYY-MM-DD (2025-09-30)</option>
                          </select>
                      </div>
                      <div>
                          <label className="block text-[10px] font-black text-brand-600 mb-3 uppercase tracking-[0.15em]">{t('settingNumber', lang)}</label>
                          <select 
                            className="w-full border border-slate-200 rounded-xl p-3.5 text-[13px] font-medium focus:ring-2 focus:ring-brand-500 outline-none transition-all bg-slate-50" 
                            value={settings.numberSeparator} 
                            onChange={(e) => updateSettings({...settings, numberSeparator: e.target.value as GlobalSettings['numberSeparator']})}
                          >
                              <option value="space_comma">1 234,56</option>
                              <option value="comma_dot">1,234.56</option>
                              <option value="dot_comma">1.234,56</option>
                          </select>
                      </div>
                  </div>
                  <div className="p-7 bg-slate-50/50 border-t text-right">
                      <button onClick={() => setShowSettingsModal(false)} className="px-10 py-2.5 bg-brand-600 text-white text-[13px] font-bold rounded-xl hover:bg-brand-700 shadow-lg shadow-brand-100 transition-all">{t('saveSettings', lang)}</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
