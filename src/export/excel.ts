import type ExcelJSType from 'exceljs';
import { Language, TransactionItem } from '../types';
import { t } from '../utils/translations';
import { formatMoney, methodsSupportingAnomalies, calculateExtrapolation } from '../utils/samplingEngine';
import { parseDateText, parseNumericText, looksLikeDate } from '../utils/cellNormalization';
import { getExcelDateFormat, isMonthFirstLocale } from '../utils/locale';
import { METHOD_PREFIX_MAP, getStaticFormula, getCalculationDetails, getDynamicMethodName, getDynamicMethodDescription } from '../components/resultsUtils';

// Hidden sheet that carries the machine-readable snapshots in client exports,
// which have no summary sheet to host them.
export const META_SHEET_NAME = '__AuditSampleData';

export async function exportToExcel(
  fullState: any,
  filename: string,
  isClientVersion: boolean,
  lang: Language
): Promise<void> {
  // Lazily load ExcelJS so it is split into its own chunk and only fetched
  // when the user actually exports, keeping the main bundle small.
  const ExcelJS = (await import('exceljs')).default as typeof ExcelJSType;
  const workbook = new ExcelJS.Workbook();
  const { results, sourceHeaders, config, settings, population, license } = fullState;
  
  const isUa = lang === 'ua';

  // Helper colors
  const colorGreen = 'FF00854B';
  const colorDarkBlue = 'FF1E293B';
  const colorRowBg = 'FFF8FAFC';
  
  // Machine-readable snapshots for lossless project recovery on re-import.
  // Written as hidden rows: the config restores the sampling parameters, and
  // the results snapshot carries the exact samplingInterval / trivialValue
  // needed to recompute projected misstatement and upper bound once the client
  // fills in audit values (they cannot be reverse-engineered from the
  // formatted text labels).
  const addMachineReadableRows = (sheet: ExcelJSType.Worksheet) => {
    const write = (label: string, payload: unknown) => {
      try {
        const row = sheet.addRow([label, JSON.stringify(payload)]);
        row.hidden = true;
        row.getCell(1).font = { color: { argb: 'FFCBD5E1' } };
        row.getCell(2).font = { color: { argb: 'FFCBD5E1' } };
      } catch {
        // If the payload cannot be serialized, text-based recovery still applies.
      }
    };

    write('__AUDITSAMPLE_CONFIG__', config);
    write('__AUDITSAMPLE_RESULTS__', {
      populationSize: results.populationSize,
      populationValue: results.populationValue,
      trivialCount: results.trivialCount,
      trivialValue: results.trivialValue,
      areTrivialExcluded: results.areTrivialExcluded,
      sampleSize: results.sampleSize,
      sampleValue: results.sampleValue,
      samplingInterval: results.samplingInterval
    });
  };

  // 1. "Опис та результат" (Description and Result) map
  const addSummarySheet = () => {
    const sheet = workbook.addWorksheet(isUa ? 'Опис та результат' : 'Description and Result');
    
    // Set Columns
    sheet.getColumn(1).width = 40;
    sheet.getColumn(2).width = 120;

    const addSectionHeader = (title: string, bgColor: string = colorDarkBlue, fontColor: string = 'FFFFFFFF') => {
      const r = sheet.addRow([title, '']);
      sheet.mergeCells(`A${r.number}:B${r.number}`);
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      r.getCell(1).font = { bold: true, color: { argb: fontColor } };
    };

    const addDetailRow = (lbl: string, val: string | number, numFmt?: string) => {
      const r = sheet.addRow([lbl, val]);
      r.getCell(1).font = { color: { argb: 'FF475569' }, bold: true };
      r.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
      if (typeof val === 'number') {
        r.getCell(2).numFmt = numFmt || '#,##0.00';
      } else if (numFmt) {
        r.getCell(2).numFmt = numFmt;
      }
    };

    // Main header
    addSectionHeader(isUa ? 'Опис та результат' : 'Description and Result', colorGreen);

    // Licensee — license requisites are included in every export.
    addSectionHeader(isUa ? 'Власник ліцензії (Аудитор)' : 'Licensee (Auditor)', colorDarkBlue);
    if (license && license.entityName) {
      addDetailRow(isUa ? 'Ліцензіат' : 'Licensee', license.entityName);
      if (license.licenseId) addDetailRow(isUa ? 'Номер ліцензії' : 'License ID', license.licenseId);
    } else {
      addDetailRow(isUa ? 'Ліцензія' : 'License', isUa ? 'Незареєстрована (безкоштовна) версія AuditSample Pro' : 'Unregistered (free) version of AuditSample Pro');
    }
    sheet.addRow([]);

    // Method
    addSectionHeader(isUa ? 'Метод відбору' : 'Sampling Method', colorDarkBlue);
    const mPrefix = METHOD_PREFIX_MAP[config.method] || config.method.toLowerCase();
    addDetailRow(isUa ? 'Метод:' : 'Method:', getDynamicMethodName(config, lang));
    addDetailRow(isUa ? 'Ціль застосування:' : 'Purpose:', t(mPrefix + 'PurposeText', lang));
    addDetailRow(isUa ? 'Опис методу:' : 'Description:', getDynamicMethodDescription(config, lang));

    sheet.addRow([]);

    // Anomalies
    addSectionHeader(isUa ? 'Ключові елементи' : 'Key Items', colorRowBg, 'FF1E293B');
    const isAnomalySupported = methodsSupportingAnomalies.includes(config.method);
    let anomalyAlg = t('notApplicable', lang);
    let anomalyDesc = t('anomDescNone', lang);
    if (config.anomalyMethod === 'ModifiedZ' && isAnomalySupported) {
        anomalyAlg = 'Modified Z-Score (Median + MAD)';
        anomalyDesc = t('anomDescModZ', lang);
    }
    addDetailRow(isUa ? 'Алгоритм аномалій' : 'Anomaly Algorithm', anomalyAlg);
    addDetailRow(isUa ? 'Опис аномалій' : 'Anomaly Description', anomalyDesc);
    addDetailRow(isUa ? 'Кількість ключових' : 'Key Items Count', results.keyItems.length, '0');

    sheet.addRow([]);

    // Trivial
    addSectionHeader(isUa ? 'Вочевидь незначні суми (ВНС)' : 'Clearly Trivial Items (CTT)', colorRowBg, 'FF1E293B');
    addDetailRow(isUa ? 'Поріг ВНС' : 'CTT Threshold', formatMoney(config.clearlyTrivialThreshold, settings));

    let trivialActionDesc = t('trivialItemsNotExcluded', lang);
    if (results.areTrivialExcluded) {
        trivialActionDesc = isUa 
            ? "Виключені: їх сумарна вартість не створює ризику суттєвого викривлення (МСА 450)."
            : "Excluded: their aggregate value does not pose a risk of material misstatement (ISA 450).";
    } else if (config.clearlyTrivialThreshold > 0) {
        trivialActionDesc = isUa
            ? "Залишені: сумарна вартість перевищує ліміти або потребує тестування."
            : "Kept: aggregate value exceeds limits or requires testing.";
    } else {
        trivialActionDesc = t('noneLabel', lang);
    }
    
    addDetailRow(isUa ? 'Дія' : 'Action', trivialActionDesc);
    addDetailRow(isUa ? 'Кількість ВНС' : 'CTT Items Count', results.trivialCount, '0');

    sheet.addRow([]);

    // Calculation section
    addSectionHeader(isUa ? 'РОЗРАХУНОК ВИБІРКИ' : 'SAMPLING CALCULATION', colorDarkBlue);
    
    addSectionHeader(isUa ? '1. ПАРАМЕТРИ ГЕНЕРАЛЬНОЇ СУКУПНОСТІ' : '1. POPULATION PARAMETERS', 'FF0F172A');
    addDetailRow(isUa ? 'ГЕНЕРАЛЬНА СУКУПНІСТЬ' : 'TOTAL POPULATION', formatMoney(results.populationValue, settings));
    addDetailRow(isUa ? 'Обсяг ген. сукупності' : 'Population Size', results.populationSize, '0');
    if (config.seed) addDetailRow(isUa ? 'Зерно генератора (Seed)' : 'Generator Seed', config.seed);

    sheet.addRow([]);

    addSectionHeader(isUa ? '2. НАЛАШТУВАННЯ ТА ОЦІНКА РИЗИКІВ' : '2. SETTINGS AND RISK ASSESSMENT', 'FF0F172A');
    const calcDetails = getCalculationDetails(config, results, settings, lang);
    Object.entries(calcDetails.vars).forEach(([k, v]) => {
        // Monetary figures already arrive as formatted strings from
        // getCalculationDetails. Raw numbers here are counts, seeds and
        // coefficients, so money formatting would misreport them (a step of 5
        // as "5,00", a reliability factor of 2.996 as "3,00").
        if (typeof v === 'number') {
             addDetailRow(k, Number.isInteger(v) ? String(v) : v.toFixed(3));
        } else {
             addDetailRow(k, String(v));
        }
    });
    
    sheet.addRow([]);
    addDetailRow(isUa ? 'ФОРМУЛА РОЗРАХУНКУ' : 'CALCULATION FORMULA', getStaticFormula(config.method, lang));
    addDetailRow(isUa ? 'Підстановка та результат' : 'Substitution and result', calcDetails.subst);

    sheet.addRow([]);

    addSectionHeader(isUa ? '3. РЕЗУЛЬТАТИ ТА ЕКСТРАПОЛЯЦІЯ' : '3. RESULTS AND EXTRAPOLATION', 'FF0F172A');
    addDetailRow(isUa ? 'ОБСЯГ ВИБІРКИ' : 'SAMPLE SIZE', results.sampleSize, '0');
    const coveragePercent = results.populationValue > 0 ? (results.sampleValue / results.populationValue) * 100 : 0;
    addDetailRow(isUa ? 'АНАЛІЗ ПОКРИТТЯ' : 'COVERAGE ANALYSIS', `${coveragePercent.toFixed(2)}%`);
    
    const isAttribute = config.method === 'Attribute';
    
    // Calculate live extraction based on current audited values
    const extrapolation = calculateExtrapolation(results, config);
    const projNum = extrapolation.projected;
    const ubNum = extrapolation.ub;
    
    if (isAttribute) {
        addDetailRow(isUa ? 'Очікуваний ступінь відхилення' : 'Projected Deviation', `${projNum.toFixed(2)}%`);
        addDetailRow(isUa ? 'Максимальна помилка (СУЕВ)' : 'Upper Deviation Bound', `${ubNum.toFixed(2)}%`);
    } else {
        addDetailRow(isUa ? 'Прогнозоване викривлення' : 'Projected Misstatement', formatMoney(projNum, settings));
        addDetailRow(isUa ? 'Верхня межа викривлення' : 'Upper Misstatement Bound', formatMoney(ubNum, settings));
    }
    
    sheet.addRow([]);

    addSectionHeader(isUa ? 'ВИСНОВОК' : 'CONCLUSION', colorDarkBlue);
    let conclusionPrefix = "";
    let conclusionText = "";
    if (config.method === 'Attribute') {
      if (ubNum <= config.tolerableMisstatement) {
        conclusionPrefix = isUa ? "🟢 ДОПУСТИМИЙ РИЗИК" : "🟢 ACCEPTABLE RISK";
        conclusionText = isUa ? `Верхня межа відхилення (${ubNum.toFixed(2)}%) НЕ ПЕРЕВИЩУЄ допустимий рівень відхилення (${config.tolerableMisstatement}%). Вибірка підтверджує ефективність контролів.` : `Upper deviation bound (${ubNum.toFixed(2)}%) DOES NOT EXCEED tolerable deviation rate (${config.tolerableMisstatement}%). Sample confirms control effectiveness.`;
      } else {
        conclusionPrefix = isUa ? "🔴 НЕПРИЙНЯТНИЙ РИЗИК" : "🔴 UNACCEPTABLE RISK";
        conclusionText = isUa ? `Верхня межа відхилення (${ubNum.toFixed(2)}%) ПЕРЕВИЩУЄ допустимий рівень відхилення (${config.tolerableMisstatement}%). Вибірка не підтверджує ефективність контролів.` : `Upper deviation bound (${ubNum.toFixed(2)}%) EXCEEDS tolerable deviation rate (${config.tolerableMisstatement}%). Sample does not confirm control effectiveness.`;
      }
    } else if (config.method === 'RiskAssessment') {
        const keyItemsMisstatements = (results.keyItems || []).reduce((acc: any, i: any) => acc + (i.difference || 0), 0);
        conclusionPrefix = isUa ? "🟡 ОЦІНКА РИЗИКІВ" : "🟡 RISK ASSESSMENT";
        conclusionText = isUa ? `Знайдено викривлень на суму ${formatMoney(keyItemsMisstatements, settings)}.` : `Total misstatements found is ${formatMoney(keyItemsMisstatements, settings)}.`;
    } else {
        if (ubNum <= config.tolerableMisstatement) {
            conclusionPrefix = isUa ? "🟢 НИЗЬКИЙ РИЗИК" : "🟢 LOW RISK";
            conclusionText = isUa ? `Верхня межа викривлення (${formatMoney(ubNum, settings)}) НЕ ПЕРЕВИЩУЄ допустиме викривлення (${formatMoney(config.tolerableMisstatement, settings)}). Вибірка підтверджує відсутність суттєвих викривлень (Низький ризик).` : `Upper misstatement bound (${formatMoney(ubNum, settings)}) DOES NOT EXCEED tolerable misstatement (${formatMoney(config.tolerableMisstatement, settings)}). Sample confirms absence of material misstatements (Low risk).`;
        } else {
             conclusionPrefix = isUa ? "🔴 ВИСОКИЙ РИЗИК" : "🔴 HIGH RISK";
             conclusionText = isUa ? `Верхня межа викривлення (${formatMoney(ubNum, settings)}) ПЕРЕВИЩУЄ допустиме викривлення (${formatMoney(config.tolerableMisstatement, settings)}). Вибірка свідчить про наявність суттєвих викривлень (Високий ризик).` : `Upper misstatement bound (${formatMoney(ubNum, settings)}) EXCEEDS tolerable misstatement (${formatMoney(config.tolerableMisstatement, settings)}). Sample indicates presence of material misstatements (High risk).`;
        }
    }
    
    // Add colored conclusion block
    const cr = sheet.addRow([isUa ? `ВИСНОВОК: ${conclusionPrefix}` : `CONCLUSION: ${conclusionPrefix}`, conclusionText]);
    
    let bgColor = 'FFE2FFE9'; // green for acceptable
    let textColor = 'FF006137'; // dark green
    if (conclusionPrefix.includes('🔴')) {
        bgColor = 'FFFFE4E6'; // light red
        textColor = 'FF991B1B'; // dark red
    } else if (conclusionPrefix.includes('🟡')) {
        bgColor = 'FFFFF0B2'; // light yellow
        textColor = 'FF854D0E'; // dark yellow
    }

    cr.getCell(1).font = { color: { argb: textColor }, bold: true };
    cr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cr.getCell(2).font = { color: { argb: textColor }, bold: true };
    cr.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    cr.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };

    sheet.addRow([]);

    addMachineReadableRows(sheet);
  };

  // The client receives only the selected items: no methodology, no
  // conclusion, no population. The snapshots still travel with the file on a
  // hidden sheet so the returned workbook re-imports losslessly.
  if (isClientVersion) {
    const metaSheet = workbook.addWorksheet(META_SHEET_NAME);
    metaSheet.state = 'veryHidden';
    addMachineReadableRows(metaSheet);
  } else {
    addSummarySheet();
  }

  // --- Source cell presentation --------------------------------------------
  // Cells are normalized on import (utils/cellNormalization): numbers are
  // numbers and dates are ISO 'YYYY-MM-DD' strings. Here they only need the
  // Excel representation: an ISO string becomes a real Date with the user's
  // date format. Files imported before normalization existed still carry raw
  // text, so the same parsers run as a fallback.

  const dateNumFmt = getExcelDateFormat();
  const monthFirst = isMonthFirstLocale();

  const isoToDate = (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // Returns the value to write plus the number format it needs (if any).
  const normalizeCell = (raw: any): { value: any; numFmt?: string } => {
    if (raw instanceof Date) return { value: raw, numFmt: dateNumFmt };
    if (typeof raw === 'number') {
      // Integers keep an integer format so IDs and account codes do not gain
      // a misleading ",00" tail.
      return { value: raw, numFmt: Number.isInteger(raw) ? '#,##0' : '#,##0.00' };
    }
    if (raw === null || raw === undefined) return { value: raw };
    if (typeof raw !== 'string') return { value: raw };

    const str = raw.trim();
    if (str === '') return { value: raw };

    const iso = parseDateText(str, monthFirst);
    if (iso) return { value: isoToDate(iso), numFmt: dateNumFmt };

    if (looksLikeDate(str)) return { value: raw };

    const asNumber = parseNumericText(str);
    if (asNumber !== null) {
      return { value: asNumber, numFmt: Number.isInteger(asNumber) ? '#,##0' : '#,##0.00' };
    }

    return { value: raw };
  };

  // Helper for column name
  const sheetLetter = (index: number) => {
    let temp = index;
    let letter = '';
    while (temp > 0) {
      const modulo = (temp - 1) % 26;
      letter = String.fromCharCode(65 + modulo) + letter;
      temp = Math.floor((temp - modulo) / 26);
    }
    return letter;
  };

  // Base headers based on original input plus our audit columns
  const baseHeaders = [...(sourceHeaders || [])];
  
  baseHeaders.push(
    isUa ? 'Облікова сума' : 'Book Value',
    isUa ? 'Аудиторська сума' : 'Audit Value',
    isUa ? 'Різниця' : 'Difference'
  );
  
  if (!isClientVersion) {
      baseHeaders.push(isUa ? 'Коментарі аудитора' : 'Auditor Comments');
  } else {
      baseHeaders.push(isUa ? 'Коментарі' : 'Comments');
  }

  const addItemsToSheet = (sheetName: string, items: any[]) => {
    if (!items || items.length === 0) return;
    const sheet = workbook.addWorksheet(sheetName);
    
    // Add Headers
    const headerRow = sheet.addRow(baseHeaders);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorGreen } // brand-600
    };
    
    const bookColIdx = (sourceHeaders?.length || 0) + 1;
    const auditColIdx = (sourceHeaders?.length || 0) + 2;
    
    const bookColName = sheetLetter(bookColIdx);
    const auditColName = sheetLetter(auditColIdx);

    // Add Data
    items.forEach((item, idx) => {
      // Normalize the source cells so dates and amounts are written as real
      // Excel values instead of text.
      const sourceCells = (item.originalRow || []).map(normalizeCell);
      const rowData: any[] = sourceCells.map((c: { value: any }) => c.value);

      while (rowData.length < (sourceHeaders?.length || 0)) {
        rowData.push('');
      }

      let auditValNum: number | string | null = '';
      let diffValObj: any = null;
      const targetRowIdx = idx + 2; // header is row 1
      
      if (item.auditedValue !== undefined && item.auditedValue !== '' && item.auditedValue !== null) {
          auditValNum = Number(item.auditedValue);
      } else {
          auditValNum = null; // Blank cell if not audited yet
      }

      // Always use a formula so Excel can recalculate live.
      // Use IF so that rows without an audit value stay blank rather than showing BookValue.
      // Cache `result` so Excel shows the correct value immediately (without needing to recalculate).
      const diffResult = typeof auditValNum === 'number'
          ? Math.round((item.bookValue - auditValNum) * 100) / 100
          : null;
      diffValObj = {
          formula: `IF(${auditColName}${targetRowIdx}="","",${bookColName}${targetRowIdx}-${auditColName}${targetRowIdx})`,
          result: diffResult ?? '',
      };

      rowData.push(
        item.bookValue,
        auditValNum,
        diffValObj
      );
      
      rowData.push(!isClientVersion ? (item.comments || '') : '');

      const addedRow = sheet.addRow(rowData);
      sourceCells.forEach((cell: { numFmt?: string }, colIdx: number) => {
        if (cell.numFmt) addedRow.getCell(colIdx + 1).numFmt = cell.numFmt;
      });
    });

    // Formatting
    sheet.columns.forEach((column, i) => {
      let maxLength = 0;
      column.eachCell!({ includeEmpty: true }, (cell) => {
        if (cell.value) {
            let strVal = '';
            if (cell.value instanceof Date) {
                // toString() would be the full locale timestamp and blow up the width.
                strVal = '00.00.0000';
            } else if (typeof cell.value === 'object' && 'result' in cell.value) {
                strVal = String(cell.value.result);
            } else {
                strVal = cell.value.toString();
            }
            if (strVal.length > maxLength) {
                maxLength = strVal.length;
            }
        }
      });
      column.width = Math.min(maxLength < 10 ? 10 : maxLength + 2, 50);

      // Set number format for monetary added columns
      if (i >= (sourceHeaders?.length || 0) && i < (sourceHeaders?.length || 0) + 3) {
        column.numFmt = '#,##0.00';
      }
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  addItemsToSheet(isUa ? 'Вибірка' : 'Sample', results.samplingItems);
  
  if (results.keyItems && results.keyItems.length > 0) {
    addItemsToSheet(isUa ? 'Ключові' : 'Key', results.keyItems);
  }

  if (!isClientVersion && population && population.length > 0 && population.length <= 150000) {
    // Also include a population sheet without audit values, just book values
    const sheetName = isUa ? 'Генеральна сукупність' : 'Population';
    const sheet = workbook.addWorksheet(sheetName);
    const popHeaders = [...(sourceHeaders || []), isUa ? 'Облікова сума' : 'Book Value'];
    
    const headerRow = sheet.addRow(popHeaders);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colorDarkBlue }
    };
    
    population.forEach((item: TransactionItem) => {
      const sourceCells = (item.originalRow || []).map(normalizeCell);
      const rowData: any[] = sourceCells.map((c: { value: any }) => c.value);
      while (rowData.length < (sourceHeaders?.length || 0)) {
        rowData.push('');
      }
      rowData.push(item.amount);
      const addedRow = sheet.addRow(rowData);
      sourceCells.forEach((cell: { numFmt?: string }, colIdx: number) => {
        if (cell.numFmt) addedRow.getCell(colIdx + 1).numFmt = cell.numFmt;
      });
    });

    sheet.columns.forEach((column, i) => {
      column.width = 15;
      if (i === (sourceHeaders?.length || 0)) {
        column.numFmt = '#,##0.00';
      }
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // Removed _metadata sheet as it's no longer used for project state loading (now using .audsmpl)

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

