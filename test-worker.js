const { Worker } = require('worker_threads');
const w = new Worker('./worker-test.js');
w.on('error', console.error);
