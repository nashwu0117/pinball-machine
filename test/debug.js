/** Quick diagnostic: load the page and dump all console output + errors. */
import puppeteer from 'puppeteer';

const URL = process.env.PINBALL_URL || 'http://localhost:8181/index.html';
const EXECUTABLE = process.env.CHROME_PATH
  || '/tmp/chs/chrome-headless-shell-linux64/chrome-headless-shell';

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();

page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message, '\n', e.stack));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http]', r.status(), r.url());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 4000));

const state = await page.evaluate(() => ({
  hasPinball: typeof window.__pinball !== 'undefined',
  canvases: document.querySelectorAll('canvas').length,
  loadingHidden: document.getElementById('loading')?.className,
  overlayReady: document.getElementById('overlay')?.className,
}));
console.log('STATE:', JSON.stringify(state));

await browser.close();