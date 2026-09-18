/**
 * Trace the path of a launched ball through the playfield.
 *
 * Prints a coarse ASCII map of where a set of shots actually travelled, which
 * makes geometry problems (a rail that funnels everything into one slot, a dead
 * corner, a chimney) immediately obvious without a GUI.
 */

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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });

const trace = await page.evaluate(async () => {
  const { machine } = window.__pinball;
  const shots = [];

  for (let s = 0; s < 8; s++) {
    machine.loadBall();
    machine.launchBall(9.0);
    const path = [];
    for (let step = 0; step < 26 * 60; step++) {
      const p = machine.ballBody.position;
      if (step % 12 === 0) path.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
      machine.world.step(1 / 240, 1 / 60, 24);
      machine.syncBall();
      // Stop once the ball is settled in a pocket.
      if (p.z > 62 && p.y < 3 && machine.ballBody.velocity.length() < 6) break;
      if (step % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    shots.push({ path, final: path[path.length - 1] });
  }
  return shots;
});

// --- ASCII map: x across, z down. Each shot gets its own character.
const X_MIN = -28, X_MAX = 28, W = 56;
const Z_MIN = 0, Z_MAX = 74, H = 30;
const grid = Array.from({ length: H }, () => Array(W).fill(' '));
const marks = '123456789ABCDEFG';

trace.forEach((shot, i) => {
  for (const [x, y, z] of shot.path) {
    const cx = Math.round(((x - X_MIN) / (X_MAX - X_MIN)) * (W - 1));
    const cz = Math.round(((z - Z_MIN) / (Z_MAX - Z_MIN)) * (H - 1));
    if (cx >= 0 && cx < W && cz >= 0 && cz < H) {
      if (grid[cz][cx] === ' ' || grid[cz][cx] === marks[i]) grid[cz][cx] = marks[i];
    }
  }
});

console.log('\nBall paths (x across, z downward; each shot = one character)\n');
console.log('        ' + '-'.repeat(W));
for (let r = 0; r < H; r++) {
  const z = Math.round(Z_MIN + (r / (H - 1)) * (Z_MAX - Z_MIN));
  console.log(`z=${String(z).padStart(2)} | ${grid[r].join('')}`);
}
console.log('        ' + '-'.repeat(W));

console.log('\nfinal resting positions:');
trace.forEach((shot, i) => {
  const [x, y, z] = shot.final;
  let pocket = 'drain/none';
  for (const p of [-22, -11, 0, 11, 22]) {
    if (Math.abs(x - p) < 4.5) pocket = `pocket ${[2, 4, 6, 8, 10][[-22, -11, 0, 11, 22].indexOf(p)]}`;
  }
  console.log(`  shot ${marks[i]}: x=${x} y=${y} z=${z}  -> ${pocket}`);
});

await browser.close();