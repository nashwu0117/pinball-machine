/** One-off smoke test for the orbit camera + clickable start button. */
import puppeteer from 'puppeteer';

const EXECUTABLE = process.env.CHROME_PATH
  || '/home/nash/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.PINBALL_URL || 'http://localhost:6767/index.html';

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1000));

let pass = true;
function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) pass = false;
}

/** Project a machine-local world point to screen px. */
function screenPosOf(getPoint) {
  return page.evaluate(getPoint);
}

// ---- 1. the 3D start button must be clickable in the default view ----------
const btnPos = await page.evaluate(() => {
  const { machine, camera } = window.__pinball;
  const v = machine.startButtonMesh.position.clone();
  machine.group.localToWorld(v);
  v.project(camera);
  return {
    x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
    y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
  };
});
await page.mouse.click(btnPos.x, btnPos.y);
await new Promise((r) => setTimeout(r, 300));
report(
  '3D start button clickable',
  await page.evaluate(() => window.__pinball.game.state) === 'SPINNING',
  `clicked ${btnPos.x},${btnPos.y}`,
);

// ---- 2. plunger drag fires (default camera, before any orbiting) -----------
await page.evaluate(async () => {
  const { game } = window.__pinball;
  const dt = 1 / 60;
  for (let i = 0; i < 400 && game.state !== 'AIMING'; i++) {
    game.update(dt);
    if (i === 120 && game.state === 'SPINNING') game.stopSpin();
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
  }
});
const knobPos = await page.evaluate(() => {
  const { machine, camera } = window.__pinball;
  const v = machine.plungerKnob.getWorldPosition(machine.plungerKnob.position.clone());
  v.project(camera);
  return {
    x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
    y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
  };
});
await page.mouse.move(knobPos.x, knobPos.y);
await page.mouse.down();
for (let i = 1; i <= 15; i++) await page.mouse.move(knobPos.x, knobPos.y + i * 12);
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const fired = await page.evaluate(() => ({
  state: window.__pinball.game.state,
  shots: window.__pinball.game.shots,
}));
report('plunger drag fires (orbit does not hijack)', fired.shots === 1, `state=${fired.state} shots=${fired.shots}`);

// ---- 3. orbit: drag on empty sky rotates, wheel zooms -----------------------
await page.evaluate(() => window.__pinball.game.reset());
await new Promise((r) => setTimeout(r, 200));

const before = await page.evaluate(() => {
  const { orbit } = window.__pinball;
  return {
    theta: +orbit.theta.toFixed(4),
    phi: +orbit.phi.toFixed(4),
    radius: +orbit.radius.toFixed(2),
    target: orbit.target.toArray().map((v) => +v.toFixed(1)),
  };
});

await page.mouse.move(60, 60);
await page.mouse.down();
for (let i = 1; i <= 20; i++) await page.mouse.move(60 + i * 10, 60 + i * 6);
await page.mouse.up();
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => {
    document.getElementById('scene').dispatchEvent(
      new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }),
    );
  });
  await new Promise((r) => setTimeout(r, 30));
}
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 2500)); // long hold: headless rAF is ~4fps
await page.keyboard.up('KeyW');
await new Promise((r) => setTimeout(r, 1500)); // let damping settle

const after = await page.evaluate(() => {
  const { orbit, controls } = window.__pinball;
  return {
    theta: +orbit.theta.toFixed(4),
    phi: +orbit.phi.toFixed(4),
    radius: +orbit.radius.toFixed(2),
    target: orbit.target.toArray().map((v) => +v.toFixed(1)),
    orbitDragging: controls.orbitDragging,
  };
});

const dTheta = Math.abs(after.theta - before.theta);
const dPhi = Math.abs(after.phi - before.phi);
const dRadius = after.radius - before.radius;
const walked = Math.hypot(after.target[0] - before.target[0], after.target[2] - before.target[2]);
report('orbit rotation', dTheta > 0.15, `dTheta=${dTheta.toFixed(3)}`);
report('pitch rotation', dPhi > 0.05, `dPhi=${dPhi.toFixed(3)}`);
report('wheel zoom', dRadius < -20, `dRadius=${dRadius.toFixed(1)}`);
report('WASD walk', walked > 2, `moved ${walked.toFixed(1)}cm target=${JSON.stringify(after.target)}`);
report('drag state released', after.orbitDragging === false);
report('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
process.exit(pass ? 0 : 1);
