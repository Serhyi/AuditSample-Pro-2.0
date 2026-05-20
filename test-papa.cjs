const Papa = require("papaparse");
const text = "A;B;C\n1,0;2,0;3,0\n";
console.log(Papa.parse(text));
