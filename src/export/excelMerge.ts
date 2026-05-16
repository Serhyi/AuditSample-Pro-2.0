import ExcelJS from 'exceljs';
import { SamplingResult } from '../types';

export async function mergeExcelResults(
  file: File,
  currentResults: SamplingResult,
  sourceHeadersCount: number,
  idColIdx: number
): Promise<SamplingResult> {
  const content = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);

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

  const updateItemsFromSheet = (items: any[], sheetNameEn: string, sheetNameUa: string, sheetIndex: number) => {
    let updatedCount = 0;
    let sheet = workbook.getWorksheet(sheetNameEn) || workbook.getWorksheet(sheetNameUa);
    if (!sheet && workbook.worksheets.length > sheetIndex) {
        sheet = workbook.worksheets[sheetIndex];
    }
    
    if (sheet && items && items.length > 0) {
      const data: any[][] = [];
      sheet.eachRow((row) => {
        const rowData: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          let val = cell.value?.valueOf() ?? null;
          if (val && typeof val === 'object' && 'result' in val) {
              val = (val as any).result;
          }
          rowData[colNumber - 1] = val;
        });
        data.push(rowData);
      });

      const N = sourceHeadersCount;
      const rowMap = new Map<string, any[][]>();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row && row.length > N) {
          let idVal = '';
          if (idColIdx >= 0 && row.length > idColIdx) {
            idVal = String(row[idColIdx]).trim().replace('.0', '');
          } else {
            // fallback to using book value as an identifier if no ID column
            idVal = 'BV_' + parseAmount(row[N]);
          }
          
          if (!rowMap.has(idVal)) rowMap.set(idVal, []);
          rowMap.get(idVal)!.push(row);
        }
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        let idVal = '';
        if (idColIdx >= 0) {
            idVal = String(item.id).trim().replace('.0', '');
        } else {
            idVal = 'BV_' + item.bookValue;
        }

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
              updatedCount++;
            } else {
              item.auditedValue = '';
              item.difference = 0;
            }
          } else {
            item.auditedValue = '';
            item.difference = 0;
          }

          item.comments = comments !== undefined && comments !== null ? String(comments) : '';
        }
      }
    }
    return updatedCount;
  };

  const newResults = JSON.parse(JSON.stringify(currentResults)); // Deep clone
  let totalUpdated = 0;
  totalUpdated += updateItemsFromSheet(newResults.samplingItems, 'Sample', 'Вибірка', 0);
  if (newResults.keyItems) {
    totalUpdated += updateItemsFromSheet(newResults.keyItems, 'Key', 'Ключові', 1);
  }

  (newResults as any)._importUpdatedCount = totalUpdated;

  return newResults;
}
