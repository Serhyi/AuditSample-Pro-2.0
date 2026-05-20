const Papa = require("papaparse");
const text = "A;B;C;D\n1;2;3,14;4\n2;3;4,14;5,0\n3;4;5;6\n";
console.log(Papa.parse(text));
