import './worker-polyfill';
import Papa from 'papaparse';
import * as ExcelJSModule from 'exceljs';
import { TransactionItem, ColumnIndices } from '../types';

const ExcelJS: any = (ExcelJSModule as any).default || ExcelJSModule;
console.log('WORKER init: ExcelJS keys:', Object.keys(ExcelJSModule).join(', '));
if (ExcelJS) console.log('WORKER init: ExcelJS is truthy, Workbook is:', typeof ExcelJS.Workbook);
else console.log('WORKER init: ExcelJS is falsy');

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
    if (str === '' || str === '-') return NaN; // - may appear for zero formatting
    if (str.startsWith('(') && str.endsWith(')')) str = '-' + str.slice(1, -1);
    
    // Also strip generic characters not parsing well
    const cleanStr = str.replace(/[\s\u00A0\u200B\u202F$€£₴]/g, ''); 
    if (cleanStr === '') return NaN;
    
    if (cleanStr.includes(',') && cleanStr.includes('.')) {
        const lastDot = cleanStr.lastIndexOf('.');
        const lastComma = cleanStr.lastIndexOf(',');
        if (lastComma > lastDot) {
            return parseFloat(cleanStr.replace(/\./g, '').replace(/,/g, '.'));
        } else {
            return parseFloat(cleanStr.replace(/,/g, ''));
        }
    }
    
    if (cleanStr.includes(',')) {
        const commaParts = cleanStr.split(',');
        if (commaParts.length > 2) {
            return parseFloat(cleanStr.replace(/,/g, ''));
        }
        const afterComma = commaParts[commaParts.length - 1];
        if (afterComma.length === 3) {
            return parseFloat(cleanStr.replace(/,/g, ''));
        } else {
            return parseFloat(cleanStr.replace(/,/g, '.'));
        }
    }
    
    if (cleanStr.includes('.')) {
        const dotParts = cleanStr.split('.');
        if (dotParts.length > 2) {
            return parseFloat(cleanStr.replace(/\./g, ''));
        }
        const afterDot = dotParts[dotParts.length - 1];
        if (afterDot.length === 3) {
            return parseFloat(cleanStr.replace(/\./g, ''));
        } else {
            return parseFloat(cleanStr);
        }
    }
    
    return parseFloat(cleanStr);
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

const doValidation = (data: any[][], sRow: number, indices: ColumnIndices) => {
    const normalized: TransactionItem[] = [];
    const invalidAmountRows: number[] = [];
    const invalidDateRows: number[] = [];
    let totalVal = 0, negCount = 0, zeroCount = 0, dupCount = 0;
    const seenIds = new Set<string>();
    
    for (let i = sRow; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length === 0) continue;
        
        const idVal = row[indices.id];
        const idStr = (idVal !== undefined && idVal !== null) ? String(idVal).trim() : `row-${i+1}`;
        
        if (seenIds.has(idStr)) dupCount++;
        seenIds.add(idStr);
        
        const rawAmt = row[indices.amount];
        const val = parseAmount(rawAmt);
        
        if (isNaN(val)) { 
            invalidAmountRows.push(i + 1); 
            continue; 
        }
        
        if (val < 0) negCount++;
        if (val === 0) zeroCount++;
        
        const dateStr = parseExcelRawDate(row[indices.date]);
        if (!dateStr) {
            invalidDateRows.push(i + 1);
            continue; 
        }
        
        totalVal += Math.abs(val);
        normalized.push({ id: idStr, amount: val, date: dateStr, originalRow: row });
    }
    return { normalized, invalidAmountRows, invalidDateRows, totalVal, negativeCount: negCount, zeroCount, duplicateCount: dupCount };
};

self.onmessage = async (e) => {
    console.log("WORKER RECEIVED MESSAGE", e.data?.type);
    const { type } = e.data;
    if (type === 'PARSE_FILE') {
        const { buffer, isCsv } = e.data.payload;
        try {
            self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 10, stage: 'Reading file...' } });
            const data: any[][] = [];
            
            if (isCsv) {
                self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 30, stage: 'Importing...' } });
                const uint8 = new Uint8Array(buffer);
                const hasBOM = uint8.length >= 3 && uint8[0] === 0xEF && uint8[1] === 0xBB && uint8[2] === 0xBF;
                let isUtf8 = hasBOM;
                if (!hasBOM) {
                    try {
                        new TextDecoder('utf-8', { fatal: true }).decode(uint8.slice(0, Math.min(4096, uint8.length)));
                        isUtf8 = true; 
                    } catch { isUtf8 = false; }
                }
                
                const text = isUtf8 
                    ? new TextDecoder('utf-8').decode(uint8)
                    : new TextDecoder('windows-1251').decode(uint8);

                let detectedDelimiter = "";
                const lines = text.split('\n');
                const firstLine = lines[0] || "";
                
                const headerSemi = (firstLine.match(/;/g) || []).length;
                const headerComma = (firstLine.match(/,/g) || []).length;
                const headerTab = (firstLine.match(/\t/g) || []).length;
                
                if (headerSemi > headerComma && headerSemi > headerTab) detectedDelimiter = ';';
                else if (headerTab > headerComma && headerTab > headerSemi) detectedDelimiter = '\t';
                else if (headerComma > headerSemi && headerComma > headerTab) detectedDelimiter = ',';
                else {
                    const firstLines = lines.slice(0, 5).join('\n');
                    const semiCount = (firstLines.match(/;/g) || []).length;
                    const commaCount = (firstLines.match(/,/g) || []).length;
                    const tabCount = (firstLines.match(/\t/g) || []).length;
                    if (semiCount > commaCount && semiCount > tabCount) detectedDelimiter = ';';
                    else if (tabCount > commaCount && tabCount > semiCount) detectedDelimiter = '\t';
                    else if (commaCount > semiCount && commaCount > tabCount) detectedDelimiter = ',';
                }

                self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 60, stage: 'Importing...' } });
                const results = Papa.parse(text, { 
                    skipEmptyLines: true, 
                    ...(detectedDelimiter ? { delimiter: detectedDelimiter } : {}) 
                });
                const rawResultsData = results.data as any[][];
                if (!rawResultsData || rawResultsData.length === 0) throw new Error('errFileEmpty');
                
                for (let i = 0; i < rawResultsData.length; i++) {
                    const row = rawResultsData[i];
                    while (row.length > 0 && (row[row.length - 1] === null || row[row.length - 1] === undefined || String(row[row.length - 1]).trim() === '')) {
                        row.pop();
                    }
                    data.push(row);
                }
            } else {
                self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 30, stage: 'Importing Excel...' } });
                
                const workbook = new (ExcelJS as any).Workbook();
                await workbook.xlsx.load(buffer);

                const getCellValue = (val: any): any => {
                    if (val === null || val === undefined) return null;
                    if (typeof val === 'object') {
                        if ('error' in val) return null;
                        if ('result' in val) return getCellValue(val.result);
                        if ('richText' in val) return val.richText.map((rt: any) => rt.text).join('');
                        if ('text' in val) return val.text;
                    }
                    return val.valueOf();
                };
                
                const isCellEmpty = (val: any): boolean => {
                    const v = getCellValue(val);
                    if (v === null || v === undefined) return true;
                    return String(v).trim() === '';
                };
                
                const extractSummaryInfo = (sheet: any): any => {
                    let populationSize = 0, populationValue = 0, projectedMisstatement = 0, upperMisstatementBound = 0;
                    let sampleSize = 0, trivialCount = 0, tolerableMisstatement = 0, confidenceLevel = 0;
                    let methodStr = 'MUS';

                    if (!sheet) return { populationSize, populationValue, projectedMisstatement, upperMisstatementBound, sampleSize, trivialCount, tolerableMisstatement, confidenceLevel, method: methodStr };
                    
                    for (let r = 1; r <= sheet.rowCount; r++) {
                        const row = sheet.getRow(r);
                        const lbl = String(getCellValue(row.getCell(1).value) || '');
                        const val = getCellValue(row.getCell(2).value);
                        
                        if (lbl.includes('Метод:') || lbl.includes('Method:')) {
                            const m = String(val).toLowerCase();
                            if (m.includes('mus') || m.includes('монетарна')) methodStr = 'MUS';
                            else if (m.includes('attribute') || m.includes('атрибутив')) methodStr = 'Attribute';
                            else if (m.includes('cvs') || m.includes('стратиф')) methodStr = 'CVS';
                            else if (m.includes('random') || m.includes('випад')) methodStr = 'Random';
                            else if (m.includes('benford')) methodStr = 'Benford';
                            else if (m.includes('stop') || m.includes('зупин')) methodStr = 'StopOrGo';
                            else if (m.includes('risk') || m.includes('ризик')) methodStr = 'RiskAssessment';
                        }
                        if (lbl.includes('Кількість елементів (Сукупність)') || lbl.includes('Population Size') || lbl.includes('Обсяг ген. сукупності')) {
                            populationSize = parseInt(String(val).replace(/\D/g, '')) || 0;
                        }
                        if (lbl.includes('Сума (Сукупність)') || lbl.includes('Population Value') || lbl.includes('ГЕНЕРАЛЬНА СУКУПНІСТЬ') || lbl.includes('TOTAL POPULATION')) {
                            populationValue = parseAmount(val);
                        }
                        if (lbl.includes('ОБСЯГ ВИБІРКИ') || lbl.includes('SAMPLE SIZE')) {
                            sampleSize = parseInt(String(val).replace(/\D/g, '')) || 0;
                        }
                        if (lbl.includes('Кількість ВНС') || lbl.includes('CTT Items Count')) {
                            trivialCount = parseInt(String(val).replace(/\D/g, '')) || 0;
                        }
                        if (lbl.includes('Прогнозоване викривлення') || lbl.includes('Projected Misstatement')) {
                            projectedMisstatement = parseAmount(val);
                        }
                        if (lbl.includes('Верхня межа викривлення') || lbl.includes('Upper Misstatement Bound') || lbl.includes('Максимальна помилка')) {
                            upperMisstatementBound = parseAmount(val);
                        }
                        if (lbl.includes('Допустиме викривлення') || lbl.includes('Tolerable Misstatement') || lbl.includes('Допустимий ступінь відхилення') || lbl.includes('Tolerable Deviation Rate')) {
                            const pm = parseAmount(val);
                            if (!isNaN(pm)) tolerableMisstatement = pm;
                        }
                        if (lbl.includes('Рівень впевненості') || lbl.includes('Confidence Level')) {
                            const cl = parseInt(String(val).replace(/[^\d]/g, '')) || 0;
                            if (cl > 0) confidenceLevel = cl;
                        }
                    }
                    return { populationSize, populationValue, projectedMisstatement, upperMisstatementBound, sampleSize, trivialCount, tolerableMisstatement, confidenceLevel, method: methodStr };
                };
                
                const sampleSheet = workbook.getWorksheet('Вибірка') || workbook.getWorksheet('Sample');
                if (sampleSheet) {
                    self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 50, stage: 'Reading exported project...' } });
                    
                    const summarySheet = workbook.getWorksheet('Опис та результат') || workbook.getWorksheet('Description and Result');
                    const summaryData = extractSummaryInfo(summarySheet);
                    
                    const extractSheet = (sheet: any): {items: any[], headers: string[]} => {
                        const items: any[] = [];
                        const sourceHeaders: string[] = [];
                        if (!sheet) return { items, headers: sourceHeaders };
                        
                        const headerRow = sheet.getRow(1);
                        let docCol = -1, audCol = -1, diffCol = -1, commentCol = -1;
                        for (let c=1; c<=sheet.columnCount; c++) {
                            const valStr = String(getCellValue(headerRow.getCell(c).value) || '');
                            if (valStr.includes('Облікова сума') || valStr.includes('Book Value')) docCol = c;
                            if (valStr.includes('Аудиторська сума') || valStr.includes('Audit Value')) audCol = c;
                            if (valStr.includes('Різниця') || valStr.includes('Difference')) diffCol = c;
                            if (valStr.includes('Коментарі') || valStr.includes('Comments')) commentCol = c;
                        }
                        if (diffCol === -1) diffCol = audCol !== -1 ? audCol + 1 : -1;
                        if (commentCol === -1) commentCol = audCol !== -1 ? audCol + 2 : -1;
                        
                        const baseN = (docCol !== -1) ? docCol - 1 : Math.max(0, sheet.columnCount - 4);
                        
                        for (let c=1; c<=baseN; c++) sourceHeaders.push(String(getCellValue(headerRow.getCell(c).value) || ''));

                        for (let r=2; r<=sheet.rowCount; r++) {
                            const row = sheet.getRow(r);
                            const originalRow = [];
                            for(let c=1; c<=baseN; c++) originalRow.push(getCellValue(row.getCell(c).value));
                            
                            const bookVal = (docCol !== -1) ? parseAmount(getCellValue(row.getCell(docCol).value)) : 0;
                            const auditValRaw = (audCol !== -1) ? getCellValue(row.getCell(audCol).value) : null;
                            const diffValRaw = (diffCol !== -1) ? getCellValue(row.getCell(diffCol).value) : null;
                            const commentsVal = (commentCol !== -1) ? String(getCellValue(row.getCell(commentCol).value) || '') : '';
                            
                            const auditVal = auditValRaw !== null && auditValRaw !== '' ? parseAmount(auditValRaw) : '';
                            
                            let diffVal = 0;
                            let parsedDiff = NaN;
                            
                            if (diffValRaw !== null && diffValRaw !== '') {
                                parsedDiff = parseAmount(diffValRaw);
                            }
                            
                            if (!isNaN(parsedDiff)) {
                                diffVal = parsedDiff;
                            } else {
                                const auditNum = typeof auditVal === 'number' ? auditVal : 0;
                                diffVal = bookVal - auditNum;
                            }

                            items.push({
                                id: `row-${r-1}`,
                                amount: bookVal,
                                bookValue: bookVal,
                                originalRow: originalRow,
                                auditedValue: auditVal,
                                difference: diffVal,
                                comments: commentsVal
                            });
                        }
                        return { items, headers: sourceHeaders };
                    };
                    
                    const sampleData = extractSheet(sampleSheet);
                    const keySheet = workbook.getWorksheet('Ключові') || workbook.getWorksheet('Key');
                    const keyData = extractSheet(keySheet);
                    
                    const popSheet = workbook.getWorksheet('Генеральна сукупність') || workbook.getWorksheet('Population');
                    const popData = extractSheet(popSheet);

                    self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 100, stage: 'Complete' } });
                    self.postMessage({
                        type: 'PARSE_RECOVERED_PROJECT',
                        payload: {
                            samplingItems: sampleData.items,
                            keyItems: keyData.items,
                            population: popData.items.map(i => ({...i, amount: i.bookValue})),
                            sourceHeaders: sampleData.headers.length > 0 ? sampleData.headers : (popData.headers || []),
                            summaryData
                        }
                    });
                    return; // exit early since it was a recovered project
                }
                
                const sheet = workbook.worksheets[0];

                const rowCount = sheet.rowCount;
                self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 75, stage: `Parsing ${rowCount} rows...` } });
                for (let r = 1; r <= rowCount; r++) {
                    const row = sheet.getRow(r);
                    if (!row) continue;
                    const rowData: any[] = [];
                    row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
                        rowData[colNumber - 1] = getCellValue(cell.value);
                    });
                    while(rowData.length > 0 && isCellEmpty(rowData[rowData.length - 1])) {
                        rowData.pop();
                    }
                    data.push(rowData);
                }
                
                if (!data || data.length === 0) throw new Error('errFileEmpty');
            }

            self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 85, stage: 'Validating data...' } });
            const { startRow, indices } = detectTableStructure(data);
            const validationRaw = doValidation(data, startRow, indices);

            self.postMessage({ type: 'PARSE_PROGRESS', payload: { pct: 100, stage: 'Complete' } });
            self.postMessage({
                type: 'PARSE_SUCCESS',
                payload: {
                    data,
                    startRow,
                    indices,
                    validation: {
                        isValid: validationRaw.normalized.length > 0,
                        errors: [],
                        itemCount: validationRaw.normalized.length,
                        ...validationRaw
                    }
                }
            });
        } catch (err: any) {
            console.error("Worker extraction error", err);
            self.postMessage({
                type: 'PARSE_ERROR',
                payload: err.message
            });
        }
    } else if (type === 'VALIDATE_DATA') {
        const { data, startRow, indices } = e.data.payload;
        try {
            const validationRaw = doValidation(data, startRow, indices);
            self.postMessage({
                type: 'VALIDATE_SUCCESS',
                payload: {
                    isValid: validationRaw.normalized.length > 0,
                    errors: [],
                    itemCount: validationRaw.normalized.length,
                    ...validationRaw
                }
            });
        } catch (err: any) {
            self.postMessage({
                type: 'VALIDATE_ERROR',
                payload: err.message
            });
        }
    }
};
