import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { TransactionItem, ColumnIndices } from '../types';

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
    const { type } = e.data;
    if (type === 'PARSE_FILE') {
        const { buffer, isCsv } = e.data.payload;
        try {
            const data: any[][] = [];
            
            if (isCsv) {
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

                const results = Papa.parse(text, { skipEmptyLines: true });
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
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buffer);
                
                const sheet = workbook.worksheets[0];
                
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

                const rowCount = sheet.rowCount;
                for (let r = 1; r <= rowCount; r++) {
                    const row = sheet.getRow(r);
                    if (!row) continue;
                    const rowData: any[] = [];
                    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        rowData[colNumber - 1] = getCellValue(cell.value);
                    });
                    while(rowData.length > 0 && isCellEmpty(rowData[rowData.length - 1])) {
                        rowData.pop();
                    }
                    data.push(rowData);
                }
                
                if (!data || data.length === 0) throw new Error('errFileEmpty');
            }

            const { startRow, indices } = detectTableStructure(data);
            const validationRaw = doValidation(data, startRow, indices);

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
