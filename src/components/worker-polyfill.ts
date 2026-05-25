// Polyfill for UMD modules (like exceljs) that expect window in a web worker environment
if (typeof window === 'undefined') {
    (globalThis as any).window = globalThis;
}
