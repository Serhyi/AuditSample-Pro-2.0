const fs = require('fs');
const ExcelJS = require('exceljs');
(async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow([1, 2, 3]);
    await wb.xlsx.writeFile('dummy.xlsx');
    console.log('Created dummy.xlsx');
})();
