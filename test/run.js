/**
 * Headless functional + physics test harness.
 *
 * Drives the real game through its own public API inside a real browser with
 * real WebGL and real rigid-body physics, then asserts on the results.
 *
 *   node test/run.js
 *
 * Env:
 *   PINBALL_URL  page to test (default http://localhost:8181/index.html)
 *   CHROME_PATH  chrome / chrome-headless-shell binary
 */

import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { playManyShots, chaosTest, measureFrames, inspectMachine } from './probe.js';
import { check, report } from './assert.js';
import { reportLoop } from './loopreport.js';

const URL = process.env.PINBALL_URL || 'http://localhost:8181/index.html';
const EXECUTABLE = [
  process.env.CHROME_PATH,
  '/tmp/chs/chrome-headless-shell-linux64/chrome-headless-shell',
  '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell',
  '/home/nash/.cache/hyperframes/chrome/chrome-headless-shell/linux-152.0.7977.30/chrome-headless-shell-linux64/chrome-headless-shell',
].filter(Boolean).find((path) => existsSync(path));

if (!EXECUTABLE) {
  console.error('No Chrome binary found. Set CHROME_PATH.');
  process.exit(2);
}

export const TARGET_VALUES = [2, 4, 6, 8, 10];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,800',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 800));

  check('boots without page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  // ---------------------------------------------------------------- structure
  const geom = await inspectMachine(page);
  check('machine builds meshes', geom.meshes > 50, `${geom.meshes} meshes`);
  check('machine builds physics bodies', geom.bodies > 100, `${geom.bodies} bodies`);
  check('pin field matches the compact real machine', geom.pegs >= 65, `${geom.pegs} pegs`);
  check('pins render via InstancedMesh', geom.instanced >= 2, `${geom.instanced} instanced meshes`);
  check('9 multiplier holes exist', geom.pockets === 9, `${geom.pockets}`);
  check('5 multiplier LEDs exist', geom.leds === 5, `${geom.leds}`);
  check('9 hole lamps exist', geom.laneLeds === 9, `${geom.laneLeds}`);

  // ----------------------------------------------------------- target roulette
  const startState = await page.evaluate(() => {
    const { game } = window.__pinball;
    const ok = game.pressStart();
    return { ok, state: game.state, balls: game.balls };
  });
  check('pressStart starts the roulette',
    startState.ok && startState.state === 'SPINNING', JSON.stringify(startState));

  await page.evaluate(async () => {
    window.__pinballTestDrive = true;
    const { game } = window.__pinball;
    const dt = 1 / 60;
    for (let i = 0; i < Math.ceil(8 / dt); i++) {
      if (game.state === 'AIMING') break;
      game.update(dt);
      if (i === 120 && game.state === 'SPINNING') game.stopSpin();
      if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  });
  const aiming = await page.evaluate(() => {
    const { game, machine } = window.__pinball;
    return {
      target: game.target,
      targetLane: game.targetLane,
      lit: machine.ledMeshes.get(game.target)?.material.emissiveIntensity > 0,
      othersDark: [...machine.ledMeshes.entries()]
        .filter(([v]) => v !== game.target)
        .every(([, m]) => m.material.emissiveIntensity === 0),
      ballActive: machine.ballActive,
      laneLit: machine.laneLedMeshes?.[game.targetLane]?.material.emissiveIntensity > 0,
    };
  });
  check('target is one of 2/4/6/8/10',
    TARGET_VALUES.includes(aiming.target), `target=${aiming.target}`);
  check('matching LED lights, others stay dark', aiming.lit && aiming.othersDark);
  check('one playfield lane lamp is selected', aiming.targetLane >= 0 && aiming.laneLit,
    `lane=${aiming.targetLane}`);
  check('ball is loaded and ready', aiming.ballActive === true);

  // A barely moved handle must not consume or lose the ball. It should roll
  // back to the same plunger and leave the machine ready for another pull.
  const weakReturn = await page.evaluate(async () => {
    const { game, machine } = window.__pinball;
    const before = { balls: game.balls, shots: game.shots };
    game.releasePlunger(0);
    const dt = 1 / 60;
    for (let i = 0; i < 8 * 60 && game.state !== 'AIMING'; i++) {
      game.update(dt);
      if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return {
      state: game.state,
      balls: game.balls,
      shots: game.shots,
      before,
      z: machine.ballBody.position.z,
    };
  });
  check('weak launch returns the same ball to the plunger',
    weakReturn.state === 'AIMING'
      && weakReturn.balls === weakReturn.before.balls
      && weakReturn.shots === weakReturn.before.shots
      && weakReturn.z > 53,
    JSON.stringify(weakReturn));

  // ------------------------------------------------------------------ the loop
  const sim = await playManyShots(page);
  for (const [i, r] of sim.outcomes.entries()) {
    const label = r.result === 'score'
      ? (r.hitTarget ? `HIT target! +${r.reward} balls, ×${r.value} lane ${r.lane + 1}`
        : `×${r.value} lane ${r.lane + 1}`)
      : r.result === 'drain' ? 'drain' : r.result ?? '?';
    console.log(`      shot ${i + 1}: target=${r.target} balls ${r.before}->${r.after} ${label}`);
  }
  reportLoop(sim);

  // -------------------------------------------------------- game over + reset
  // Wins may have earned extra balls (target-lane hits pay out 2/4/6/8/10
  // bonus balls -- see _scorePocket), so this can run more than STARTING_BALLS
  // shots. The expected payout is still well under the per-shot cost on
  // average, so a generous cap is a safety net, not the normal case.
  // Weak launches now correctly return the same ball.
  for (let i = 0; i < 150; i++) {
    const st = await page.evaluate(() => ({ state: window.__pinball.game.state, balls: window.__pinball.game.balls }));
    if (st.state === 'GAME_OVER' || st.balls <= 0) break;
    await page.evaluate(async () => {
      const { game } = window.__pinball;
      const dt = 1 / 60;
      async function advanceUntil(pred, maxSeconds) {
        const steps = Math.ceil(maxSeconds / dt);
        for (let s = 0; s < steps; s++) {
          if (pred()) return true;
          game.update(dt);
          if (s % 12 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        return pred();
      }
      if (game.state !== 'AIMING') {
        if (game.state === 'READY') game.pressStart();
        await advanceUntil(() => game.state === 'SPINNING', 2);
        for (let s = 0; s < 150 && game.state === 'SPINNING'; s++) {
          game.update(dt);
          if (s % 12 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        if (game.state === 'SPINNING') game.stopSpin();
        await advanceUntil(() => game.state === 'AIMING', 2);
      }
      // A win just means more draining to do, so loop again.
      game.releasePlunger(9.0);
      await advanceUntil(() => game.state !== 'IN_PLAY' && game.state !== 'RESOLVING', 25);
    });
  }
  const over = await page.evaluate(() => {
    const { game } = window.__pinball;
    return { state: game.state, balls: game.balls };
  });
  check('game ends when balls run out',
    over.state === 'GAME_OVER' && over.balls <= 0, JSON.stringify(over));

  // Step the roulette manually: after long headless runs rAF can stall, so do
  // not depend on the render loop here.
  await page.evaluate(async () => {
    window.__pinballTestDrive = true;
    const { game } = window.__pinball;
    game.reset();
    game.pressStart();
    const dt = 1 / 60;
    for (let i = 0; i < Math.ceil(6 / dt); i++) {
      if (game.state === 'AIMING') break;
      game.update(dt);
      if (i === 120 && game.state === 'SPINNING') game.stopSpin();
      if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  });
  const afterRestart = await page.evaluate(() => {
    const { game, machine } = window.__pinball;
    return { target: game.target, ballActive: machine.ballActive, balls: game.balls };
  });
  check('reset restores 10 balls and a loaded round',
    afterRestart.ballActive && afterRestart.balls === 10, JSON.stringify(afterRestart));

  // ------------------------------------------------------------- chaos check
  let chaos = { crossings: [], uniq: 0 };
  try {
    chaos = await chaosTest(page);
  } catch (e) {
    console.log(`      chaos test aborted: ${e.message}`);
  }
  check('identical launches give varied outcomes', chaos.uniq >= 3,
    `10 identical full-power shots crossed at ${chaos.uniq} distinct x positions: `
    + (chaos.abortError ? `ABORT:${chaos.abortError} ` : '')
    + chaos.crossings.slice(0, 12).join(', '));

  // ------------------------------------------------------------------ render
  try {
    const perf = await measureFrames(page);
    console.log(`      frame time median ${perf.median.toFixed(1)}ms, p95 ${perf.p95.toFixed(1)}ms `
      + '(software WebGL -- real GPUs are much faster)');
  } catch (e) {
    console.log(`      frame timing skipped: ${e.message}`);
  }

  check('no runtime errors during play', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  process.exit(report());
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
