const text = "1; 760\n0,00; 12\n";
const firstLines = text.split('\n').slice(0, 5).join('\n');
const semiCount = (firstLines.match(/;/g) || []).length;
const commaCount = (firstLines.match(/,/g) || []).length;
const tabCount = (firstLines.match(/\t/g) || []).length;
let detectedDelimiter = "";
if (semiCount > commaCount && semiCount > tabCount) detectedDelimiter = ';';
else if (tabCount > commaCount && tabCount > semiCount) detectedDelimiter = '\t';
else if (commaCount > semiCount && commaCount > tabCount) detectedDelimiter = ',';

console.log("Delimiter detected:", detectedDelimiter);
