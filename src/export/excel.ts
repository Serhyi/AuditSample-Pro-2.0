import ExcelJS from 'exceljs';
import { Language, TransactionItem } from '../types';
import { t } from '../utils/translations';
import { formatMoney, methodsSupportingAnomalies, calculateExtrapolation } from '../utils/samplingEngine';
import { METHOD_PREFIX_MAP, getStaticFormula, getCalculationDetails } from '../components/resultsUtils';

export async function exportToExcel(
  fullState: any,
  filename: string,
  isClientVersion: boolean,
  lang: Language
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const { results, sourceHeaders, config, settings, population } = fullState;
  
  const isUa = lang === 'ua';

  // Helper colors
  const colorGreen = 'FF00854B';
  const colorDarkBlue = 'FF1E293B';
  const colorRowBg = 'FFF8FAFC';
  
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

    // Method
    addSectionHeader(isUa ? 'Метод відбору' : 'Sampling Method', colorDarkBlue);
    const mPrefix = METHOD_PREFIX_MAP[config.method] || config.method.toLowerCase();
    addDetailRow(isUa ? 'Метод:' : 'Method:', t(mPrefix + 'Name', lang));
    addDetailRow(isUa ? 'Ціль застосування:' : 'Purpose:', t(mPrefix + 'PurposeText', lang));
    addDetailRow(isUa ? 'Опис методу:' : 'Description:', t(mPrefix + 'EvaluationText', lang));

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
    addDetailRow(isUa ? 'Поріг ВНС' : 'CTT Threshold', config.clearlyTrivialThreshold);

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
    addDetailRow(isUa ? 'ГЕНЕРАЛЬНА СУКУПНІСТЬ' : 'TOTAL POPULATION', results.populationValue);
    addDetailRow(isUa ? 'Обсяг ген. сукупності' : 'Population Size', results.populationSize, '0');
    if (config.seed) addDetailRow(isUa ? 'Зерно генератора (Seed)' : 'Generator Seed', config.seed);

    sheet.addRow([]);

    addSectionHeader(isUa ? '2. НАЛАШТУВАННЯ ТА ОЦІНКА РИЗИКІВ' : '2. SETTINGS AND RISK ASSESSMENT', 'FF0F172A');
    const calcDetails = getCalculationDetails(config, results, settings, lang);
    Object.entries(calcDetails.vars).forEach(([k, v]) => {
        // Render as number if it is a number
        if (!isNaN(Number(v))) {
             addDetailRow(k, Number(v), (k.includes('%') || k.includes('Rate')) ? '0.00%' : undefined);
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
    
    const isAttribute = config.method === 'Attribute';
    
    // Calculate live extraction based on current audited values
    const extrapolation = calculateExtrapolation(results, config);
    const projNum = extrapolation.projected;
    const ubNum = extrapolation.ub;
    
    if (isAttribute) {
        // Expose as actual numbers with % format in Excel
        addDetailRow(isUa ? 'Очікуваний ступінь відхилення' : 'Projected Deviation', projNum / 100, '0.00%');
        addDetailRow(isUa ? 'Максимальна помилка (СУЕВ)' : 'Upper Deviation Bound', ubNum / 100, '0.00%');
    } else {
        addDetailRow(isUa ? 'Прогнозоване викривлення' : 'Projected Misstatement', projNum);
        addDetailRow(isUa ? 'Верхня межа викривлення' : 'Upper Misstatement Bound', ubNum);
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
        conclusionPrefix = isUa ? "🟡 ОЦІНКА РИЗИКІВ" : "🟡 RISK ASSESSMENT";
        conclusionText = isUa ? `Знайдено викривлень на суму ${formatMoney(extrapolation.key, settings)}.` : `Total misstatements found is ${formatMoney(extrapolation.key, settings)}.`;
    } else {
        if (ubNum <= config.tolerableMisstatement) {
            conclusionPrefix = isUa ? "🟢 НИЗЬКИЙ РИЗИК" : "🟢 LOW RISK";
            conclusionText = isUa ? `Верхня межа викривлення (${formatMoney(ubNum, settings)}) НЕ ПЕРЕВИЩУЄ допустиме викривлення (${formatMoney(config.tolerableMisstatement, settings)}). Вибірка підтверджує відсутність суттєвих викривлень.` : `Upper misstatement bound (${formatMoney(ubNum, settings)}) DOES NOT EXCEED tolerable misstatement (${formatMoney(config.tolerableMisstatement, settings)}). Sample confirms absence of material misstatements.`;
        } else {
             conclusionPrefix = isUa ? "🔴 ВИСОКИЙ РИЗИК" : "🔴 HIGH RISK";
             conclusionText = isUa ? `Верхня межа викривлення (${formatMoney(ubNum, settings)}) ПЕРЕВИЩУЄ допустиме викривлення (${formatMoney(config.tolerableMisstatement, settings)}). Вибірка свідчить про наявність суттєвих викривлень.` : `Upper misstatement bound (${formatMoney(ubNum, settings)}) EXCEEDS tolerable misstatement (${formatMoney(config.tolerableMisstatement, settings)}). Sample indicates presence of material misstatements.`;
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
  };

  // Create summary sheet
  addSummarySheet();

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
      const rowData = [...(item.originalRow || [])];
      
      while (rowData.length < (sourceHeaders?.length || 0)) {
        rowData.push('');
      }

      let auditValNum: number | string | null = '';
      let diffValObj: any = null;
      const targetRowIdx = idx + 2; // header is row 1
      
      if (!isClientVersion) {
        if (item.auditedValue !== undefined && item.auditedValue !== '' && item.auditedValue !== null) {
            auditValNum = Number(item.auditedValue);
        } else {
            auditValNum = null; // Blank cell if not audited yet
        }
        
        diffValObj = { formula: `${bookColName}${targetRowIdx}-${auditColName}${targetRowIdx}`, result: item.bookValue - Number(auditValNum || 0) };
      }

      rowData.push(
        item.bookValue,
        auditValNum,
        diffValObj
      );
      
      rowData.push(!isClientVersion ? (item.comments || '') : '');
      
      sheet.addRow(rowData);
    });

    // Formatting
    sheet.columns.forEach((column, i) => {
      let maxLength = 0;
      column.eachCell!({ includeEmpty: true }, (cell) => {
        if (cell.value) {
            let strVal = '';
            if (typeof cell.value === 'object' && 'result' in cell.value) {
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
      const rowData = [...(item.originalRow || [])];
      while (rowData.length < (sourceHeaders?.length || 0)) {
        rowData.push('');
      }
      rowData.push(item.amount);
      sheet.addRow(rowData);
    });

    sheet.columns.forEach((column, i) => {
      column.width = 15;
      if (i === (sourceHeaders?.length || 0)) {
        column.numFmt = '#,##0.00';
      }
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  if (!isClientVersion) {
    const metadataSheet = workbook.addWorksheet('_metadata', { state: 'hidden' });
    let metaString = '';
    try {
        metaString = JSON.stringify(fullState);
    } catch (e) {
        console.warn("State too large to stringify, omitting population from metadata", e);
        const stateWithoutPop = { ...fullState, population: [] };
        metaString = JSON.stringify(stateWithoutPop);
    }
    
    const chunkSize = 30000;
    for (let i = 0; i < metaString.length; i += chunkSize) {
      metadataSheet.addRow([metaString.slice(i, i + chunkSize)]);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as any], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

