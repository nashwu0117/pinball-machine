import puppeteer from 'puppeteer';

const EXECUTABLE = process.env.CHROME_PATH
  || '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = process.env.PINBALL_URL || 'http://localhost:8231/index.html';

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--proxy-server=direct://', '--proxy-bypass-list=*'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });

const diag = await page.evaluate(async () => {
  const res = await fetch('./src/pinball.js', { cache: 'no-store' });
  const text = await res.text();
  return {
    url: location.href,
    version: document.getElementById('version-tag')?.textContent,
    hasPlusPull: text.includes('plungerRodRestZ + pull'),
    hasMinusPull: text.includes('plungerRodRestZ - pull'),
    rotX: window.__pinball.machine.group.rotation.x,
    tableY: window.__pinball.machine.group.position.y,
    bytes: text.length,
  };
});
console.log(JSON.stringify(diag, null, 2));
await browser.close();
