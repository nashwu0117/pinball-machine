import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH
    || '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file:///home/nash/workspace/pinball-machine/game.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
await new Promise(r => setTimeout(r, 1500));

// boot + structure
const boot = await page.evaluate(() => {
  const { machine, game } = window.__pinball;
  const tag = document.getElementById('version-tag')?.textContent;
  const loadingGone = document.getElementById('loading')?.classList.contains('hidden');
  return { pegs: machine.pegBodies.length, state: game.state, tag, loadingGone };
});
console.log(`boot: pegs=${boot.pegs} state=${boot.state} tag=${boot.tag} loadingHidden=${boot.loadingGone}`);

// full game loop: start, aim, launch, resolve
const loop = await page.evaluate(async () => {
  const { game } = window.__pinball;
  const dt = 1 / 60;
  game.pressStart();
  for (let i = 0; i < 600 && game.state !== 'AIMING'; i++) {
    game.update(dt);
    if (i === 120 && game.state === 'SPINNING') game.stopSpin();
    if (i % 12 === 0) await new Promise(r => setTimeout(r, 0));
  }
  const target = game.target;
  const before = game.balls;
  game.releasePlunger(9);
  for (let i = 0; i < 1400 && (game.state === 'IN_PLAY' || game.state === 'RESOLVING'); i++) { game.update(dt); if (i % 12 === 0) await new Promise(r => setTimeout(r, 0)); }
  return { target, before, after: game.balls, result: game.lastResult?.type, shots: game.shots };
});
console.log(`loop: target=${loop.target} balls ${loop.before}->${loop.after} result=${loop.result} shots=${loop.shots}`);

// orbit: thetaGoal is set synchronously by rotate() -> deterministic even at
// headless ~4fps where the damped theta has no time to converge.
const goalBefore = await page.evaluate(() => window.__pinball.orbit.thetaGoal);
await page.mouse.move(60, 60); await page.mouse.down();
for (let i = 1; i <= 15; i++) await page.mouse.move(60 + i * 10, 60);
await page.mouse.up();
await new Promise(r => setTimeout(r, 600));
const { goalAfter, thetaMoved } = await page.evaluate(() => {
  const o = window.__pinball.orbit;
  return { goalAfter: o.thetaGoal, thetaMoved: Math.abs(o.theta - o.thetaGoal) < 5 };
});
const goalDelta = Math.abs(goalAfter - goalBefore);
console.log(`orbit: thetaGoal ${goalBefore.toFixed(3)} -> ${goalAfter.toFixed(3)} (delta ${goalDelta.toFixed(3)})`);
console.log(goalDelta > 0.5 && thetaMoved ? 'PASS orbit drag' : 'FAIL orbit drag');

console.log(`errors: ${errors.length === 0 ? 'none' : errors.slice(0,3).join(' | ')}`);
const ok = boot.pegs >= 65 && loop.shots === 1 && goalDelta > 0.5 && thetaMoved
  && errors.length === 0 && boot.tag?.startsWith('v7');
console.log(ok ? 'OFFLINE BUILD OK' : 'OFFLINE BUILD BROKEN');
await browser.close();
process.exit(ok ? 0 : 1);
