export function exportToCSV(
  results: any,
  sourceHeaders: string[],
  filename: string,
  isUa: boolean
) {
  let csvContent = "";

  // Helper to escape CSV strings
  const escapeCSV = (val: any) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    ...sourceHeaders, 
    isUa ? 'Облікова сума' : 'Book Value', 
    isUa ? 'Аудиторська сума' : 'Audit Value',
    isUa ? 'Різниця' : 'Difference',
    isUa ? 'Коментарі аудитора' : 'Auditor Comments',
    isUa ? 'Тип' : 'Item Type'
  ];
  csvContent += headers.map(escapeCSV).join(',') + '\n';

  const items: any[] = [];
  if (results.samplingItems) {
    results.samplingItems.forEach((item: any) => items.push({ ...item, itemType: isUa ? 'Вибірка' : 'Sample' }));
  }
  if (results.keyItems) {
    results.keyItems.forEach((item: any) => items.push({ ...item, itemType: isUa ? 'Ключовий' : 'Key Item' }));
  }

  items.forEach(item => {
    const rowData = [...(item.originalRow || [])];
    while (rowData.length < sourceHeaders.length) {
      rowData.push('');
    }
    
    let auditValNum: number | string = '';
    let diffVal: number | string = '';
    
    if (item.auditedValue !== undefined && item.auditedValue !== '' && item.auditedValue !== null) {
        auditValNum = Number(item.auditedValue);
        diffVal = item.bookValue - auditValNum;
    }

    rowData.push(item.bookValue);
    rowData.push(auditValNum);
    rowData.push(diffVal);
    rowData.push(item.comments || '');
    rowData.push(item.itemType);
    
    csvContent += rowData.map(escapeCSV).join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
