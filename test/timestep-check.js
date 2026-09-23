/**
 * Browser integration test for the fixed-timestep / time-budget loop.
 *
 * Loads the offline single-file build (game.html) via file:// so it needs no
 * server and no network:
 *
 *   node test/timestep-check.js
 *
 * Verifies, against the real cannon-es world:
 *  - a stall is clamped to one frame of catch-up and never chases forever,
 *  - a steady 60 Hz feed takes exactly four 240 Hz slices with no drop,
 *  - the backlog never exceeds one frame of work,
 *  - crowded / expensive worlds fall back to reduced solver precision,
 *  - the ball mesh interpolates between the last two fixed slices,
 *  - a full shot still resolves after the refactor,
 *  - rendering and keyboard input keep responding even when the physics
 *    budget is deliberately exhausted.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { PHYSICS } from '../src/config.js';
import { check, report } from './assert.js';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/tmp/chs/chrome-headless-shell-linux64/chrome-headless-shell',
  '/home/nash/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell',
].filter(Boolean);
const EXECUTABLE = CANDIDATES.find((p) => existsSync(p));
const URL = process.env.PINBALL_URL || pathToFileURL(resolve('game.html')).href;

async function main() {
  if (!EXECUTABLE) {
    console.error('No chrome binary found. Set CHROME_PATH.');
    process.exit(2);
  }

  const browser = await puppeteer.launch({
    executablePath: EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__pinball !== undefined', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { window.__pinballTestDrive = true; });

  // Wall-clock speed is not a property of the scheduler, so the deterministic
  // checks below run with the budget disabled. The budget itself is exercised
  // explicitly by the "starved budget" section at the end.
  const tuning = await page.evaluate(() => {
    const s = window.__pinball.stepper;
    return { budgetMs: s.budgetMs, slowCostMs: s.slowCostMs };
  });
  const unbounded = () => page.evaluate(() => {
    const s = window.__pinball.stepper;
    s.budgetMs = Infinity;
    s.slowCostMs = Infinity;
    s.reset();
  });
  await unbounded();

  // ------------------------------------------- stall clamped to one frame
  const stall = await page.evaluate(() => {
    const { game } = window.__pinball;
    game.stepper.reset();
    const before = game.stepper.simTime;
    const r = game.update(5); // pretend the tab was hidden for five seconds
    const s = game.stepper;
    return {
      r,
      fixedStep: s.fixedStep,
      maxSubSteps: s.maxSubSteps,
      maxFrameDelta: s.maxFrameDelta,
      maxAccumulator: s.maxAccumulator,
      simTimeDelta: s.simTime - before,
      accumulator: s.accumulator,
    };
  });
  check('a 5 s stall is clamped before it reaches the accumulator',
    stall.r.requested === 5 && stall.r.clamped <= stall.maxFrameDelta + 1e-9,
    `requested=${stall.r.requested} clamped=${stall.r.clamped}`);
  check('catch-up is capped at maxSubSteps',
    stall.r.steps > 0 && stall.r.steps <= stall.maxSubSteps,
    `steps=${stall.r.steps} cap=${stall.maxSubSteps}`);
  check('the backlog never exceeds one frame of work',
    stall.accumulator <= stall.maxAccumulator + 1e-9,
    `accumulator=${stall.accumulator} cap=${stall.maxAccumulator}`);
  check('simulated time matches the slices actually taken',
    Math.abs(stall.simTimeDelta - stall.r.steps * stall.fixedStep) < 1e-9,
    `simTimeDelta=${stall.simTimeDelta} steps=${stall.r.steps}`);
  check('the clamped stall does not require dropping time yet',
    stall.r.dropped === 0, `dropped=${stall.r.dropped}`);
// ------------------------------------------------- steady 60 Hz feeding
  const steady = await page.evaluate(() => {
    const { game, machine } = window.__pinball;
    game.stepper.reset();
    let dropped = 0;
    let maxSteps = 0;
    let everyFrameIsFour = true;
    for (let i = 0; i < 24; i += 1) {
      const r = game.update(1 / 60);
      if (r.steps !== 4) everyFrameIsFour = false;
      maxSteps = Math.max(maxSteps, r.steps);
      dropped += r.dropped;
    }
    return {
      everyFrameIsFour,
      maxSteps,
      dropped,
      accumulator: game.stepper.accumulator,
      fixedStep: game.stepper.fixedStep,
      quality: game.stepper.quality,
      iterations: machine.world.solver.iterations,
    };
  });
  check('a steady 60 Hz feed takes exactly four slices every frame',
    steady.everyFrameIsFour, `maxSteps=${steady.maxSteps}`);
  check('no simulated time is dropped while keeping up',
    steady.dropped === 0, `dropped=${steady.dropped}`);
  check('the backlog stays below one slice in steady state',
    steady.accumulator < steady.fixedStep, `accumulator=${steady.accumulator}`);
  check('steady state keeps full solver precision',
    steady.quality === 'full' && steady.iterations === PHYSICS.solverIterations,
    `quality=${steady.quality} iterations=${steady.iterations}`);

  // ------------------------------------------------ render interpolation
  const interp = await page.evaluate(() => {
    const { machine } = window.__pinball;
    const b = machine.ballBody;
    b.previousPosition.set(b.position.x + 5, b.position.y + 1, b.position.z - 2);
    machine.syncBall(0);
    const atZero = { ...machine._ballPose };
    machine.syncBall(1);
    const atOne = { ...machine._ballPose };
    return {
      atZero,
      atOne,
      prev: { ...b.previousPosition },
      now: { x: b.position.x, y: b.position.y, z: b.position.z },
      finite: Number.isFinite(machine.ballMesh.position.x)
        && Number.isFinite(machine.ballMesh.quaternion.w),
    };
  });
  check('alpha=0 renders the pre-slice pose',
    Math.abs(interp.atZero.x - interp.prev.x) < 1e-9
      && Math.abs(interp.atZero.y - interp.prev.y) < 1e-9
      && Math.abs(interp.atZero.z - interp.prev.z) < 1e-9,
    JSON.stringify(interp.atZero));
  check('alpha=1 renders the latest simulated pose',
    Math.abs(interp.atOne.x - interp.now.x) < 1e-9
      && Math.abs(interp.atOne.y - interp.now.y) < 1e-9
      && Math.abs(interp.atOne.z - interp.now.z) < 1e-9,
    JSON.stringify(interp.atOne));
  check('the interpolated mesh transform stays finite', interp.finite);
  // -------------------------------------------- crowd -> reduced precision
  await unbounded();
  const crowd = await page.evaluate((crowdThreshold) => {
    const { game, machine, CANNON } = window.__pinball;
    const spawned = [];
    for (let i = 0; i < crowdThreshold; i += 1) {
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.2) });
      body.position.set(0, -400 - i * 4, 0); // far outside the playfield
      machine.world.addBody(body);
      spawned.push(body);
    }
    const r = game.update(1 / 60);
    const reduced = {
      quality: game.stepper.quality,
      iterations: machine.world.solver.iterations,
      tolerance: machine.world.solver.tolerance,
      dynamic: r.dynamicBodies,
    };
    for (const body of spawned) machine.world.removeBody(body);
    game.update(1 / 60);
    return {
      reduced,
      recovered: { quality: game.stepper.quality, iterations: machine.world.solver.iterations },
    };
  }, PHYSICS.crowdThreshold);
  check('a crowded live world drops to reduced solver precision',
    crowd.reduced.quality === 'reduced'
      && crowd.reduced.iterations === PHYSICS.reducedSolverIterations
      && crowd.reduced.dynamic >= PHYSICS.crowdThreshold,
    JSON.stringify(crowd.reduced));
  check('precision recovers once the extra bodies are gone',
    crowd.recovered.quality === 'full'
      && crowd.recovered.iterations === PHYSICS.solverIterations,
    JSON.stringify(crowd.recovered));

  // --------------------------------------------- full gameplay regression
  await unbounded();
  const play = await page.evaluate(async () => {
    const { game, machine } = window.__pinball;
    game.reset();
    const dt = 1 / 60;
    game.pressStart();
    for (let i = 0; i < 600 && game.state !== 'AIMING'; i += 1) {
      game.update(dt);
      if (i === 120 && game.state === 'SPINNING') game.stopSpin();
      if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const before = game.balls;
    game.releasePlunger(9);
    let maxSteps = 0;
    let dropped = 0;
    for (let i = 0; i < 1400 && (game.state === 'IN_PLAY' || game.state === 'RESOLVING'); i += 1) {
      const r = game.update(dt);
      maxSteps = Math.max(maxSteps, r.steps);
      dropped += r.dropped;
      if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return {
      state: game.state,
      before,
      after: game.balls,
      result: game.lastResult?.type ?? null,
      shots: game.shots,
      maxSteps,
      dropped,
    };
  });
  check('a full shot still resolves after the loop refactor',
    play.shots === 1 && play.after < play.before && play.result !== null,
    JSON.stringify(play));
  check('gameplay never exceeds the catch-up cap per frame',
    play.maxSteps <= PHYSICS.maxSubSteps, `maxSteps=${play.maxSteps}`);
  check('gameplay advances simulated time without dropping any',
    play.dropped === 0, `dropped=${play.dropped}`);
// ------------------------ responsiveness with a deliberately starved budget
  const live = await page.evaluate(async (original) => {
    const { stepper, renderer, audio } = window.__pinball;
    // Hand the loop back to requestAnimationFrame and make it impossible for
    // physics to ever finish a frame. Rendering and input must still work.
    window.__pinballTestDrive = false;
    stepper.budgetMs = 0;
    stepper.slowCostMs = Infinity;
    // This check measures loop responsiveness (physics must never starve rAF
    // work), not the software rasterizer: a SwiftShader frame at full
    // resolution costs 2-3s, which would blow any stall threshold even with a
    // perfect loop. Shrink the render cost so a long gap can only come from
    // the loop itself.
    const prevPixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(0.1);

    const mutedBefore = audio.muted;
    const frameStart = renderer.info.render.frame;
    let rafCount = 0;
    let maxGap = 0;
    const started = performance.now();
    let last = started;
    await new Promise((done) => {
      function tick() {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        rafCount += 1;
        if (now - started > 2000) done();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });

    // A keyboard shortcut must still be serviced while physics is starved.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));

    const result = {
      rafCount,
      maxGap,
      rendered: renderer.info.render.frame - frameStart,
      inputHandled: audio.muted !== mutedBefore,
      steps: stepper.report.steps,
      budgetExceeded: stepper.report.budgetExceeded,
      leftover: stepper.report.leftover,
      maxAccumulator: stepper.maxAccumulator,
      quality: stepper.quality,
    };

    stepper.budgetMs = original.budgetMs;
    stepper.slowCostMs = original.slowCostMs;
    renderer.setPixelRatio(prevPixelRatio);
    window.__pinballTestDrive = true;
    return result;
  }, tuning);
  check('rendering keeps running while the physics budget is exhausted',
    live.rafCount >= 2 && live.rendered > 0,
    `raf=${live.rafCount} rendered=${live.rendered}`);
  check('no multi-second stall while physics is starved',
    live.maxGap < 2500, `maxGap=${live.maxGap.toFixed(0)}ms`);
  check('keyboard input is still handled while physics is starved',
    live.inputHandled === true);
  check('a starved budget still advances at least one slice per frame',
    live.steps >= 1, `steps=${live.steps}`);
  check('a starved budget defers the rest and stays bounded',
    live.budgetExceeded === true && live.leftover > 0
      && live.leftover <= live.maxAccumulator + 1e-9,
    `leftover=${live.leftover} cap=${live.maxAccumulator}`);
  check('a starved budget reduces precision instead of stalling',
    live.quality === 'reduced', `quality=${live.quality}`);

  check('no runtime errors during the loop checks',
    errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  process.exit(report());
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
