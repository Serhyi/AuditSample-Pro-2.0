import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'UserGuide_FinDiscounting_Pro.html');
const pdfPath  = path.join(__dirname, 'UserGuide_FinDiscounting_Pro.pdf');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });

// Wait for fonts to load
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1500));

await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '22mm', bottom: '24mm', left: '20mm', right: '20mm' },
  displayHeaderFooter: true,
  headerTemplate: `
    <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 7.5px; color: #94A3B8; width: 100%; padding: 0 20mm; display: flex; justify-content: space-between;">
      <span>Марінченко і Партнери — FinDiscounting Pro</span>
      <span style="color: #CBD5E1;">v2.0</span>
    </div>`,
  footerTemplate: `
    <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 7.5px; color: #94A3B8; width: 100%; padding: 0 20mm; display: flex; justify-content: space-between;">
      <span>© 2025 ТОВ «АФ „Марінченко і партнери"»</span>
      <span>Стор. <span class="pageNumber"></span></span>
    </div>`,
});

await browser.close();
console.log('PDF created:', pdfPath);
