
import React, { useState, useEffect, useRef } from 'react';
import { Upload, Download, AlertTriangle, CheckCircle, FileSpreadsheet, Loader2, Database, Info, Settings2, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { TransactionItem, ValidationResult, Language, Currency, ColumnIndices, GlobalSettings } from '../types';
import { t } from '../utils/translations';
import { formatMoney, formatDate } from '../utils/samplingEngine';
import WebImportWorker from './ImportWorker?worker';

interface ImportStepProps {
  onDataLoaded: (filePath: string | null, headers: string[], indices: ColumnIndices, startRow: number, parsedData?: TransactionItem[]) => void;
  onImportProject?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  lang: Language;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  settings: GlobalSettings;
}

const parseExcelRawDate = (rawVal: any): string | null => {
    if (rawVal === undefined || rawVal === null || rawVal === '') return null;
    if (rawVal instanceof Date) {
        const y = rawVal.getFullYear();
        const m = String(rawVal.getMonth() + 1).padStart(2, '0');
        const d = String(rawVal.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const numVal = Number(rawVal);
    if (!isNaN(numVal) && typeof rawVal !== 'boolean') {
        if (numVal > 10000 && numVal < 73050) {
            const date = new Date((numVal - 25569) * 86400 * 1000);
            const y = date.getUTCFullYear();
            const m = String(date.getUTCMonth() + 1).padStart(2, '0');
            const d = String(date.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        if (numVal > 1000000000000) {
            const date = new Date(numVal);
            const y = date.getUTCFullYear();
            const m = String(date.getUTCMonth() + 1).padStart(2, '0');
            const d = String(date.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
    }
    const strVal = String(rawVal).trim();
    const ddmmyyyy = strVal.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${String(ddmmyyyy[2]).padStart(2, '0')}-${String(ddmmyyyy[1]).padStart(2, '0')}`;
    const yyyymmdd = strVal.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (yyyymmdd) return `${yyyymmdd[1]}-${String(yyyymmdd[2]).padStart(2, '0')}-${String(yyyymmdd[3]).padStart(2, '0')}`;
    const ddmmyy = strVal.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
    if (ddmmyy) return `20${ddmmyy[3]}-${String(ddmmyy[2]).padStart(2, '0')}-${String(ddmmyy[1]).padStart(2, '0')}`;
    return null;
};

const parseAmount = (rawAmt: any): number => {
    if (typeof rawAmt === 'number') return rawAmt;
    if (rawAmt === null || rawAmt === undefined) return NaN;
    let str = String(rawAmt).trim();
    if (str === '') return NaN;
    if (str.startsWith('(') && str.endsWith(')')) str = '-' + str.slice(1, -1);
    const cleanStr = str.replace(/[\s\u00A0\u200B\u202F$€£₴]/g, ''); 
    if (cleanStr.includes(',') && !cleanStr.includes('.')) return parseFloat(cleanStr.replace(',', '.'));
    if (cleanStr.includes(',') && cleanStr.includes('.')) {
        const lastDot = cleanStr.lastIndexOf('.');
        const lastComma = cleanStr.lastIndexOf(',');
        if (lastComma > lastDot) return parseFloat(cleanStr.replace(/\./g, '').replace(',', '.'));
        else return parseFloat(cleanStr.replace(/,/g, ''));
    }
    return parseFloat(cleanStr);
};

const getColName = (idx: number) => {
    let dividend = idx + 1, columnName = "", modulo;
    while (dividend > 0) { modulo = (dividend - 1) % 26; columnName = String.fromCharCode(65 + modulo) + columnName; dividend = Math.floor((dividend - 1) / 26); }
    return columnName;
};

const detectTableStructure = (rawData: any[][]): { startRow: number, indices: ColumnIndices } => {
    const limit = Math.min(rawData.length, 50);
    for (let r = 0; r < limit; r++) {
        const row = rawData[r];
        if (!row || !Array.isArray(row) || row.length === 0) continue;
        const rowStr = row.map(c => String(c).trim().toLowerCase());
        const hasDate = rowStr.some(s => s.includes('дата') || s.includes('date') || s === 'dt');
        const hasAmount = rowStr.some(s => s.includes('сума') || s.includes('сумма') || s.includes('amount') || s.includes('sum') || s.includes('debit') || s.includes('credit'));
        
        if (hasDate && hasAmount) {
            const idIdx = rowStr.findIndex(s => ['№', 'nr', 'no', 'id', 'номер', '#'].some(t => s.includes(t)));
            let amtIdx = rowStr.findIndex(s => ['сума', 'сумма', 'amount', 'value', 'sum'].some(t => s === t));
            if (amtIdx === -1) amtIdx = rowStr.findIndex(s => s.includes('сума') || s.includes('сумма') || s.includes('amount'));
            let dateIdx = rowStr.findIndex(s => ['дата', 'date', 'dt'].some(t => s === t));
            if (dateIdx === -1) dateIdx = rowStr.findIndex(s => s.includes('дата') || s.includes('date'));
            
            if (amtIdx !== -1 && dateIdx !== -1) {
                return { startRow: r + 1, indices: { id: idIdx !== -1 ? idIdx : 0, amount: amtIdx, date: dateIdx } };
            }
        }
    }
    return { startRow: 6, indices: { id: 0, amount: 1, date: 2 } };
};

const ImportStep: React.FC<ImportStepProps> = ({ onDataLoaded, onImportProject, lang, currency, setCurrency, settings }) => {
  const [dragActive, setDragActive] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  
  const [rawData, setRawData] = useState<any[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [activeIndices, setActiveIndices] = useState<ColumnIndices>({ id: 0, amount: 1, date: 2 });
  const [startRow, setStartRow] = useState(6);
  
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
      workerRef.current = new WebImportWorker();
      return () => {
          workerRef.current?.terminate();
      };
  }, []);

  useEffect(() => {
      if (rawData.length > 0) {
          const headerRowIdx = Math.max(0, startRow - 1);
          let maxCols = 0;
          for(let i=0; i<Math.min(rawData.length, 50); i++) {
              if(rawData[i]) {
                  let rLen = rawData[i].length;
                  while(rLen > 0 && (rawData[i][rLen - 1] === null || rawData[i][rLen - 1] === undefined || String(rawData[i][rLen - 1]).trim() === '')) {
                     rLen--;
                  }
                  maxCols = Math.max(maxCols, rLen);
              }
          }
          
          const newHeaders: string[] = [];
          const rawHeaderRow = rawData[headerRowIdx] || [];
          
          for(let i=0; i < maxCols; i++) { 
                const val = rawHeaderRow[i];
                const colLetter = getColName(i);
                const label = (val !== undefined && val !== null && String(val).trim() !== '') 
                    ? String(val).substring(0, 40) 
                    : `${t('defaultColumn', lang)} ${colLetter}`;
                newHeaders.push(label);
          }
          setHeaders(newHeaders);
      }
  }, [startRow, rawData, lang]);

  const headersRef = React.useRef(headers);
  useEffect(() => { headersRef.current = headers; }, [headers]);
  const onDataLoadedRef = React.useRef(onDataLoaded);
  useEffect(() => { onDataLoadedRef.current = onDataLoaded; }, [onDataLoaded]);

  const [currentFile, setCurrentFile] = useState<string | null>(null);

  // Debounced Validation Effect
  useEffect(() => {
      if (rawData.length === 0 || !workerRef.current) return;

      setIsLoadingFile(true);
      setValidation(null);

      const timer = setTimeout(() => {
          workerRef.current!.onmessage = (e) => {
              if (e.data.type === 'VALIDATE_SUCCESS') {
                  const res = e.data.payload;
                  setValidation(res);
                  if (res.isValid) {
                      onDataLoadedRef.current(currentFile, headersRef.current, activeIndices, startRow, res.normalized);
                  }
                  setIsLoadingFile(false);
              } else if (e.data.type === 'VALIDATE_ERROR') {
                  console.error(e.data.payload);
                  setIsLoadingFile(false);
              }
          };
          
          workerRef.current!.postMessage({
              type: 'VALIDATE_DATA',
              payload: { data: rawData, startRow, indices: activeIndices }
          });
      }, 300);

      return () => clearTimeout(timer);
  }, [rawData, startRow, activeIndices, currentFile]);

  const handleFile = async (file: File) => {
    setIsLoadingFile(true);
    setValidation(null);
    setRawData([]);
    setFileError(null);
    
    const isElectron = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;
    if (isElectron && window.api && (file as any).path) {
        try {
            const filePath = (file as any).path;
            setCurrentFile(filePath);
            const { data } = await window.api.import.preview(filePath);
            
            if (!data || data.length === 0) throw new Error(t('errFileEmpty', lang));

            const { startRow: detStartRow, indices: detIndices } = detectTableStructure(data);
            
            setRawData(data);
            setStartRow(detStartRow);
            setActiveIndices(detIndices);
        } catch (e: any) {
            console.error("IPC Import Preview Error", e);
            setFileError(e.message);
            setIsLoadingFile(false);
        }
        return;
    }

    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';

    const reader = new FileReader();
    reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer;

        workerRef.current!.onmessage = (msgEvent) => {
            if (msgEvent.data.type === 'PARSE_SUCCESS') {
                const { data, startRow: detStartRow, indices: detIndices, validation: valInfo } = msgEvent.data.payload;
                
                setStartRow(detStartRow);
                setActiveIndices(detIndices);
                setRawData(data); // this will trigger the useEffect for headers and then validation
                
                // We don't call setIsLoadingFile(false) here, we let the validate_success effect do it
                // Actually wait! The Parse step ALREADY did the first validation! We can use it!
                setValidation(valInfo);
                if (valInfo.isValid) {
                   // headersRef is not ready yet because we just setRawData! 
                   // So we let the useEffect handle validation on rawData change, OR we can wait for headers.
                   // The easiest is just to let the normal useEffect pick it up. We do nothing here except setRawData.
                }
            } else if (msgEvent.data.type === 'PARSE_ERROR') {
                const errMessage = msgEvent.data.payload;
                setFileError(errMessage === 'errFileEmpty' ? t('errFileEmpty', lang) : errMessage);
                setIsLoadingFile(false);
            }
        };

        workerRef.current!.postMessage({
            type: 'PARSE_FILE',
            payload: { buffer, isCsv, lang }
        });
    };
    reader.onerror = () => {
        setFileError(t('errUnknownFileError', lang));
        setIsLoadingFile(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const renderPreviewRows = () => {
      const dataStartIndex = startRow;
      const displayData = rawData.slice(dataStartIndex, dataStartIndex + 50);
      
      return displayData.map((row, idx) => {
          const globalRowIndex = dataStartIndex + idx;
          const rawAmt = row[activeIndices.amount];
          const rawDate = row[activeIndices.date];
          const parsedAmt = parseAmount(rawAmt);
          const parsedDate = parseExcelRawDate(rawDate);
          const isAmtInvalid = isNaN(parsedAmt);
          const isDateInvalid = !parsedDate;
          
          return (
            <tr key={globalRowIndex} className="hover:bg-brand-50/20 transition-colors data-table-row group">
                <td className="px-4 py-3 text-[10px] text-slate-300 font-mono select-none">{globalRowIndex + 1}</td>
                {headers.map((_, cIdx: number) => {
                    const cell = row[cIdx];
                    const isId = cIdx === activeIndices.id;
                    const isAmount = cIdx === activeIndices.amount;
                    const isDate = cIdx === activeIndices.date;
                    let cellStyle = "text-slate-600";
                    let content = cell !== undefined && cell !== null ? String(cell) : '';
                    
                    if (isAmount) {
                        cellStyle = isAmtInvalid ? "bg-red-50 text-red-600 font-bold" : "font-mono font-bold text-neutral-900";
                        if (!isAmtInvalid) content = formatMoney(parsedAmt, settings);
                    } else if (isDate) {
                        cellStyle = isDateInvalid ? "bg-red-50 text-red-600" : "text-brand-700 font-medium";
                        if (parsedDate) content = formatDate(parsedDate, settings);
                    } else if (isId) {
                        cellStyle = "font-medium text-slate-800 bg-slate-50";
                    }

                    return (
                        <td key={cIdx} className={`px-4 py-3 text-[11px] truncate max-w-[200px] border-r border-slate-50 ${cellStyle}`}>
                            {content}
                        </td>
                    );
                })}
            </tr>
          );
      });
  };

  return (
    <div className="space-y-10 animate-fade-in max-w-[1400px] mx-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300">
        <div className="p-10">
          <div className="flex items-center justify-between mb-8">
            <div className="space-y-1">
              <h3 className="text-2xl font-display text-neutral-900 flex items-center gap-3">
                <FileSpreadsheet className="w-7 h-7 text-brand-600" />
                {t('importTitle', lang)}
              </h3>
              <p className="text-slate-400 text-[13px] font-medium ml-10">{t('importDesc', lang)}</p>
            </div>
            <div className="flex items-center gap-3">
               {/* Project Import Buttons */}
               <div className="flex gap-2 mr-4">
                   {onImportProject && (
                       <label className="cursor-pointer flex items-center gap-3 text-[11px] text-white font-black uppercase tracking-widest bg-brand-600 hover:bg-brand-700 px-7 py-3 rounded-xl shadow-[0_4px_12px_rgba(0,133,75,0.25)] transition-all active:scale-95">
                           <Download className="w-4 h-4 stroke-[3px]" />
                           {t('importXlsx', lang)}
                           <input type="file" className="hidden" accept=".xlsx" onChange={onImportProject} />
                       </label>
                   )}
               </div>

               <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200">
                  {(['UAH', 'USD', 'EUR'] as Currency[]).map((curr) => (
                    <button 
                      key={curr}
                      onClick={() => setCurrency(curr)}
                      className={`px-5 py-2 text-[11px] font-black rounded-lg transition-all ${currency === curr ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      {curr}
                    </button>
                  ))}
               </div>
            </div>
          </div>

          <div className="mb-8 p-5 bg-brand-50 border border-brand-100 rounded-2xl flex items-start gap-4">
            <Info className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
            <p className="text-[13px] font-medium text-brand-900 leading-relaxed italic opacity-80">
                {t('importFormatHint', lang)}
            </p>
          </div>

          {fileError && (
              <div className="mb-8 p-5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-4 animate-fade-in">
                  <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-[13px] font-bold text-red-700 leading-relaxed">
                      {t('fileError', lang)}{fileError}
                  </p>
              </div>
          )}

          <div 
            className={`border-2 border-dashed rounded-[2rem] p-16 text-center transition-all flex flex-col items-center justify-center gap-5 relative group ${dragActive ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 hover:border-brand-400 hover:bg-slate-50/50'}`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
          >
            <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} accept=".xlsx,.csv,.xls" />
            {isLoadingFile ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-14 h-14 text-brand-600 animate-spin" />
                <span className="text-[11px] font-black text-brand-600 uppercase tracking-widest">{t('loadingFile', lang)}</span>
              </div>
            ) : (
              <>
                <div className="bg-brand-100 p-6 rounded-3xl group-hover:scale-110 group-hover:rotate-3 transition-all duration-500 shadow-brand-100/50 shadow-lg"><Upload className="w-10 h-10 text-brand-600" /></div>
                <div>
                   <p className="text-xl font-bold text-neutral-900">{t('dragDrop', lang)}</p>
                   <p className="text-[13px] text-slate-400 mt-2 font-medium">{t('dragDropSub', lang)}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {rawData.length > 0 && validation && (
          <div className="mx-10 mb-10 p-8 bg-slate-50 border border-slate-200 rounded-[1.5rem] animate-fade-in shadow-sm">
            {/* ... Validation Stats & Mapping UI (same as before) ... */}
            <div className="flex flex-col lg:flex-row gap-10">
                <div className="flex-1 flex gap-6 items-start border-r border-slate-200 pr-10">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm shrink-0 ${validation.isValid ? 'bg-white border border-brand-100 text-brand-600' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                      {validation.isValid ? <CheckCircle className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
                    </div>
                    <div>
                      <h4 className={`text-[11px] font-black uppercase tracking-[0.15em] mb-3 ${validation.isValid ? 'text-brand-600' : 'text-red-600'}`}>
                          {validation.isValid ? lang === 'ua' ? 'Відображення налаштовано' : 'Mapping Ready' : t('validationError', lang)}
                      </h4>
                      <div className="grid grid-cols-2 gap-x-10 gap-y-4 mt-1">
                        {(validation.negativeCount > 0 || validation.zeroCount > 0) && (
                            <div className="flex flex-col col-span-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${validation.negativeCount > 0 ? 'text-red-400' : 'text-slate-400'}`}>{t('negItems', lang)} / {t('zeroItems', lang)}</span>
                                <div className="flex gap-2">
                                    <span className="text-md font-mono font-bold text-red-600">{validation.negativeCount}</span>
                                    <span className="text-md font-mono text-slate-400">/</span>
                                    <span className="text-md font-mono font-bold text-slate-600">{validation.zeroCount}</span>
                                </div>
                            </div>
                        )}
                        {!validation.isValid && (
                            <div className="col-span-2 text-red-500 text-[11px] font-bold mt-2 leading-tight">
                                {lang === 'ua' ? 'Налаштуйте колонки для коректного зчитування даних.' : 'Adjust columns to read data correctly.'}
                            </div>
                        )}
                      </div>
                    </div>
                </div>
                
                <div className="flex-1 space-y-6">
                    <div className="flex items-center gap-2 mb-2 border-b border-slate-100 pb-3">
                        <Settings2 className="w-4 h-4 text-brand-600" />
                        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{t('columnMapping', lang)}</h4>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                        {/* ID Column */}
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">{t('colId', lang)}</label>
                            <div className="relative">
                                <select 
                                    value={activeIndices.id} 
                                    onChange={(e) => setActiveIndices({...activeIndices, id: Number(e.target.value)})}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[12px] font-medium focus:ring-2 focus:ring-brand-500 outline-none appearance-none pr-8 truncate"
                                >
                                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        {/* Amount Column */}
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">{t('colAmount', lang)}</label>
                            <div className="relative">
                                <select 
                                    value={activeIndices.amount} 
                                    onChange={(e) => setActiveIndices({...activeIndices, amount: Number(e.target.value)})}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[12px] font-medium focus:ring-2 focus:ring-brand-500 outline-none appearance-none pr-8 truncate"
                                >
                                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                        {/* Date Column */}
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">{t('colDate', lang)}</label>
                            <div className="relative">
                                <select 
                                    value={activeIndices.date} 
                                    onChange={(e) => setActiveIndices({...activeIndices, date: Number(e.target.value)})}
                                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-[12px] font-medium focus:ring-2 focus:ring-brand-500 outline-none appearance-none pr-8 truncate"
                                >
                                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">{t('detectedHeaderRow', lang)}</label>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setStartRow(Math.max(1, startRow - 1))} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-600 font-bold transition-colors shadow-sm active:scale-95"><ChevronDown className="w-4 h-4" /></button>
                                <span className="font-mono font-bold text-neutral-900 bg-white border border-slate-200 px-4 py-1.5 rounded-lg min-w-[3rem] text-center shadow-inner">{startRow}</span>
                                <button onClick={() => setStartRow(startRow + 1)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 text-slate-600 font-bold transition-colors shadow-sm active:scale-95"><ChevronUp className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="text-[10px] text-slate-400 italic pt-6 leading-tight flex-1">
                            {t('adjustColumnsHint', lang)}
                        </div>
                    </div>
                </div>
            </div>
          </div>
        )}
      </div>

      {rawData.length > 0 && (
        <div className="space-y-5 animate-fade-in">
          <div className="flex items-center gap-3 px-2">
            <Database className="w-4 h-4 text-slate-400" />
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">
              {t('liveDataPreview', lang)} {startRow})
            </h4>
          </div>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden max-h-[450px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50/90 backdrop-blur sticky top-0 border-b z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-4 text-[9px] font-black uppercase text-slate-400 w-10">#</th>
                  {headers.map((h, i) => {
                      let colType = '';
                      if (i === activeIndices.id) colType = ' (ID)';
                      if (i === activeIndices.amount) colType = ' (SUM)';
                      if (i === activeIndices.date) colType = ' (DATE)';
                      
                      const isActive = i === activeIndices.id || i === activeIndices.amount || i === activeIndices.date;

                      return (
                        <th key={i} className={`px-4 py-4 text-[10px] font-black uppercase border-r last:border-0 border-slate-100 truncate max-w-[200px] ${isActive ? 'text-brand-700 bg-brand-50/50' : 'text-slate-400'}`}>
                            {h} {colType}
                        </th>
                      );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {renderPreviewRows()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportStep;
