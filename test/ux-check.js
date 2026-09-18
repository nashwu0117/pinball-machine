/**
 * Responsive UI smoke test for the B.B.MAN night-market experience.
 *
 * Run with the local server active:
 *   npm run test:ux
 */
import puppeteer from 'puppeteer';

const executablePath = process.env.CHROME_PATH
  || '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const url = process.env.PINBALL_URL || 'http://localhost:8181/index.html';

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

let failed = false;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
};
const isVisible = (selector) => page.$eval(selector, (element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden'
    && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
await new Promise((resolve) => setTimeout(resolve, 700));

check('welcome teaches the rules on first load', await isVisible('#welcome:not(.hidden)'));
check('base score readout exists', await isVisible('#hud-base'));
check('three-step rule ribbon exists', await isVisible('#how-to'));
await page.screenshot({ path: 'test/screen-welcome.png' });

await page.click('[data-base-score="100"]');
await page.click('[data-batch-size="20"]');
const setup = await page.evaluate(() => ({ base: window.__pinball.game.baseScore, batch: window.__pinball.game.batchSize }));
check('base score and batch size can be selected', setup.base === 100 && setup.batch === 20);

await page.click('#welcome-start');
check('welcome CTA starts the roulette', await page.evaluate(() => window.__pinball.game.state === 'SPINNING'));
await new Promise((resolve) => setTimeout(resolve, 320));
check('welcome dismisses after starting', !(await isVisible('#welcome')));

await page.evaluate(() => {
  const { game } = window.__pinball;
  for (let i = 0; i < 180 && game.state !== 'AIMING'; i++) {
    game.update(1 / 60);
    if (i === 120 && game.state === 'SPINNING') game.stopSpin();
  }
});
await page.$eval('#touch-power', (element) => {
  element.value = '80';
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.$eval('#action-button', (element) => element.click());
check('touch fire button launches at selected power', await page.evaluate(() => window.__pinball.game.state === 'IN_PLAY'));
const scoring = await page.evaluate(() => {
  const { game } = window.__pinball;
  const scoreBefore = game.score;
  game._scorePocket(4);
  return { scoreBefore, score: game.score, multiplier: game.history[0]?.multiplier, points: game.history[0]?.points };
});
check('multiplier hole awards base score times multiplier',
  scoring.multiplier === 10 && scoring.points === 1000 && scoring.score === scoring.scoreBefore + 1000);

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
await new Promise((resolve) => setTimeout(resolve, 700));
check('mobile controls appear on a phone viewport', await isVisible('#mobile-controls'));
check('desktop help ribbon hides on a phone viewport', !(await isVisible('#how-to')));
await page.screenshot({ path: 'test/screen-mobile.png' });

await browser.close();
process.exit(failed ? 1 : 0);
