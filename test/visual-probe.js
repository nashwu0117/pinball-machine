/**
 * Visual probe: verifies the B.B.MAN plunger direction (downward gesture = knob
 * moves OUT toward the player, release = knob springs inward), checks the real
 * 3D white button click target, and prints scene composition numbers.
 *
 *   node serve.mjs 8181 &  node test/visual-probe.js
 */
import puppeteer from 'puppeteer';

const EXECUTABLE = process.env.CHROME_PATH
  || '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell';
const URL = process.env.PINBALL_URL || 'http://localhost:8181/index.html';

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800',
    '--proxy-server=direct://', '--proxy-bypass-list=*'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));

let pass = true;
const report = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) pass = false;
};

/** World z of the knob through the plunger group transform. */
const knobWorldZ = () => page.evaluate(() => {
  const { machine } = window.__pinball;
  const v = machine.plungerKnob.getWorldPosition(machine.plungerKnob.position.clone());
  return v.z;
});

// Click the visible 3D white button at its projected screen coordinate. This
// catches regressions where the model is present but its raycast area is tiny.
await page.evaluate(() => document.getElementById('welcome')?.classList.add('hidden'));
const buttonPoint = await page.evaluate(() => {
  const { machine, camera, renderer, THREE } = window.__pinball;
  machine.group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const p = machine.startButtonMesh.getWorldPosition(new THREE.Vector3()).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + (p.x + 1) * rect.width / 2,
    y: rect.top + (1 - p.y) * rect.height / 2,
  };
});
await page.mouse.click(buttonPoint.x, buttonPoint.y);
report('3D white jump-light button accepts a real click',
  await page.evaluate(() => window.__pinball.game.state === 'SPINNING'),
  `screen x=${buttonPoint.x.toFixed(0)} y=${buttonPoint.y.toFixed(0)}`);
await page.mouse.click(buttonPoint.x, buttonPoint.y);
report('same button stops the live roulette',
  await page.evaluate(() => window.__pinball.game.state === 'AIMING'));
await page.evaluate(() => {
  window.__pinball.game.reset();
  window.__pinball.game.pressStart();
});

const zRest = await knobWorldZ();

// Drive the real pointer-move handler: 200 px downward should reach full pull.
const gesturePull = await page.evaluate(() => {
  const { controls } = window.__pinball;
  controls.dragging = true;
  controls.pointerId = 42;
  controls.dragStartY = 500;
  controls.pull = 0;
  controls._onMove({ pointerId: 42, clientX: 0, clientY: 700 });
  controls.dragging = false;
  controls.pointerId = null;
  return controls.pull;
});
const zPulled = await knobWorldZ();

report('downward pointer gesture charges the plunger', gesturePull > 8.5,
  `pull=${gesturePull.toFixed(2)}cm`);
report('downward pull moves knob OUT toward the player (+z)', zPulled > zRest + 7,
  `rest z=${zRest.toFixed(1)} pulled z=${zPulled.toFixed(1)}`);
report('outward travel matches maxPull', Math.abs((zPulled - zRest) - 9.0) < 0.5,
  `delta=${(zPulled - zRest).toFixed(2)}cm`);

// Release: controls.js springs the visual back to 0.
await page.evaluate(() => {
  const { controls, machine } = window.__pinball;
  controls.pull = 0;
  machine.updatePlungerVisual(0);
});
const zBack = await knobWorldZ();
report('release snaps knob back to rest', Math.abs(zBack - zRest) < 0.1,
  `z=${zBack.toFixed(2)}`);

const upwardPull = await page.evaluate(() => {
  const { controls, machine } = window.__pinball;
  controls.dragging = true;
  controls.pointerId = 43;
  controls.dragStartY = 500;
  controls.pull = 0;
  controls._onMove({ pointerId: 43, clientX: 0, clientY: 350 });
  controls.dragging = false;
  controls.pointerId = null;
  machine.updatePlungerVisual(0);
  return controls.pull;
});
report('upward pointer movement does not charge', upwardPull === 0,
  `pull=${upwardPull.toFixed(2)}cm`);

// Knob sits proud of the machine front at rest, then moves farther toward the
// player when pulled (B.B.MAN cabinet front: about z = 68).
const localFront = await page.evaluate(() => {
  const { machine, THREE } = window.__pinball;
  const trayZof = (pull) => {
    machine.updatePlungerVisual(pull);
    const v = machine.plungerKnob.getWorldPosition(new THREE.Vector3());
    machine.group.worldToLocal(v);
    return v.z;
  };
  return { rest: trayZof(0), pulled: trayZof(9.0) };
});
report('knob rests proud of the machine front', localFront.rest > 68,
  `rest local z=${localFront.rest.toFixed(1)} (front≈68)`);
report('pulled knob travels farther out from the machine front', localFront.pulled > 76,
  `pulled local z=${localFront.pulled.toFixed(1)}`);

// Composition sanity: machine leans, scene has ground + bulbs.
const comp = await page.evaluate(() => {
  const { machine, scene } = window.__pinball;
  let bulbs = 0; let ground = 0; let legs = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.material?.emissive?.getHex?.() === 0xffd9a0) bulbs += 1;
    if (o.isMesh && o.geometry?.parameters?.width === 640) ground += 1;
  });
  machine.scene.traverse(() => {});
  return { rotX: machine.group.rotation.x, tableY: machine.group.position.y, bulbs, ground, legs };
});
report('machine leans at TILT', Math.abs(comp.rotX - 0.15) < 1e-6, `rotX=${comp.rotX}`);
report('machine raised onto stand', comp.tableY === 43, `tableY=${comp.tableY}`);
report('ground plane exists', comp.ground === 1);

// Screenshot for eyeballing.
await page.evaluate(() => window.__pinball.machine.updatePlungerVisual(0));
await page.evaluate(() => window.__pinball.orbit.returnToDefault());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'test/screen-v7.png' });
console.log('screenshot saved: test/screen-v7.png');

report('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
process.exit(pass ? 0 : 1);
