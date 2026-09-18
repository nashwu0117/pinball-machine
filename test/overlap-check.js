/**
 * Overlap diagnostic: where do the HTML buttons sit versus the projected 3D
 * controls, at several window sizes? Also saves a screenshot for reference.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const EXECUTABLE = process.env.CHROME_PATH
  || '/home/nash/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const URL = process.env.PINBALL_URL || 'http://localhost:6767/index.html';

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
});

const sizes = [
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 800, h: 600 },
];

function rectsOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

for (const { w, h } of sizes) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));

  const info = await page.evaluate(() => {
    const { machine, camera } = window.__pinball;
    const project = (obj, local) => {
      const v = (local ?? obj.position).clone();
      if (local) obj.localToWorld(v); else {
        obj.updateWorldMatrix(true, false);
        v.setFromMatrixPosition(obj.matrixWorld);
      }
      v.project(camera);
      return {
        left: Math.round((v.x * 0.5 + 0.5) * innerWidth),
        top: Math.round((-v.y * 0.5 + 0.5) * innerHeight),
      };
    };
    const htmlRect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    return {
      knob3D: project(machine.plungerKnob),
      button3D: project(machine.startButtonMesh),
      mute: htmlRect('#mute'),
      bar: htmlRect('#controls-bar'),
      restart: htmlRect('#restart'),
      power: htmlRect('#power'),
    };
  });

  // Expand the 3D points into generous grab zones (the knob hit sphere is
  // ~5.5cm, which is roughly 40-60px on screen at these viewports).
  const grab = (p, r) => ({ left: p.left - r, top: p.top - r, right: p.left + r, bottom: p.top + r });
  const knobZone = grab(info.knob3D, 60);
  const btnZone = grab(info.button3D, 45);

  const conflicts = [];
  for (const [name, rect] of Object.entries({ mute: info.mute, bar: info.bar, restart: info.restart, power: info.power })) {
    if (!rect) continue;
    if (rectsOverlap(rect, knobZone)) conflicts.push(`${name} overlaps PLUNGER`);
    if (rectsOverlap(rect, btnZone)) conflicts.push(`${name} overlaps START-BUTTON`);
  }

  console.log(`\n=== ${w}x${h} ===`);
  console.log(`knob3D=${info.knob3D.left},${info.knob3D.top}  button3D=${info.button3D.left},${info.button3D.top}`);
  console.log(`mute=${JSON.stringify(info.mute)}  bar=${JSON.stringify(info.bar)}  power=${JSON.stringify(info.power)}`);
  console.log(conflicts.length ? `CONFLICTS: ${conflicts.join('; ')}` : 'no conflicts');

  if (w === 1280) {
    await page.screenshot({ path: 'test/screen-1280.png' });
    console.log('screenshot saved: test/screen-1280.png');
  }
  await page.close();
}

await browser.close();
console.log('\ndone');
