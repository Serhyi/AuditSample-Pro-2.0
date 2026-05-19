const { Worker } = require('worker_threads');
const w = new Worker('./worker-test.cjs');
w.on('error', console.error);
