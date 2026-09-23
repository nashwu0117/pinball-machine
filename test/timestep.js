/**
 * Unit tests for the fixed-timestep scheduler (src/loop.js).
 *
 * These run in plain Node with a stand-in world, so the accumulator / catch-up
 * / budget / precision rules can be checked without a browser or a GPU.
 *
 *   node test/timestep.js
 */

import { FixedTimestepRunner, QUALITY } from '../src/loop.js';
import { PHYSICS } from '../src/config.js';
import { check, report } from './assert.js';

const STEP = PHYSICS.fixedStep;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Spin the CPU for `ms` to emulate solver work. */
function burn(ms) {
  if (!(ms > 0)) return;
  const until = performance.now() + ms;
  while (performance.now() < until) { /* busy wait */ }
}

/**
 * Minimal world that records how many fixed slices it was asked to simulate.
 * @param {{ costMs?: number, dynamics?: number }} [options]
 */
function fakeWorld({ costMs = 0, dynamics = 0 } = {}) {
  const world = {
    solver: { iterations: 0, tolerance: 0 },
    bodies: [],
    steps: 0,
    stepCostMs: costMs,
    step(dt) {
      this.steps += 1;
      this.lastDt = dt;
      burn(this.stepCostMs);
    },
  };
  for (let i = 0; i < dynamics; i += 1) {
    world.bodies.push({ mass: 1, sleepState: 0 });
  }
  return world;
}

// ------------------------------------------------------- fixed slices only

{
  const runner = new FixedTimestepRunner();
  const world = fakeWorld();
  const report60 = runner.advance(world, 1 / 60);

  check('a 60 Hz frame runs exactly four 240 Hz slices',
    report60.steps === 4 && near(report60.simulatedDt, 4 * STEP, 1e-9),
    `steps=${report60.steps} simulatedDt=${report60.simulatedDt}`);
  check('every slice uses the fixed timestep, never the frame delta',
    near(world.lastDt, STEP, 1e-12), `dt=${world.lastDt}`);
  check('leftover time stays below one slice',
    report60.leftover < STEP && report60.leftover >= 0,
    `leftover=${report60.leftover}`);
  check('alpha reports the unsimulated fraction of a slice',
    report60.alpha === report60.leftover / STEP && report60.alpha < 1,
    `alpha=${report60.alpha}`);
  check('the physics budget was not needed on a cheap frame',
    report60.budgetExceeded === false && report60.dropped === 0);
}

// ------------------------------------------------- catch-up cap + backlog

{
  const runner = new FixedTimestepRunner();
  const world = fakeWorld();
  const huge = runner.advance(world, 30);

  check('a multi-second frame is clamped before it reaches the accumulator',
    huge.clamped <= runner.maxFrameDelta + 1e-12 && huge.requested === 30,
    `clamped=${huge.clamped}`);
  check('catch-up never exceeds maxSubSteps',
    huge.steps <= PHYSICS.maxSubSteps, `steps=${huge.steps}`);
  check('backlog is capped at one frame of work',
    runner.accumulator <= runner.maxAccumulator + 1e-12,
    `accumulator=${runner.accumulator}`);
  check('clamped frame is fully simulated (nothing dropped yet)',
    huge.dropped === 0 && runner.accumulator < STEP);
{
  // A starved budget defers work every frame; the accumulator must still never
  // grow without bound, and the excess must be explicitly dropped.
  const runner = new FixedTimestepRunner({ budgetMs: 0 });
  const world = fakeWorld();
  const frames = 40;
  let maxSteps = 0;
  let maxAccumulator = 0;
  for (let i = 0; i < frames; i += 1) {
    const r = runner.advance(world, 1 / 60);
    maxSteps = Math.max(maxSteps, r.steps);
    maxAccumulator = Math.max(maxAccumulator, runner.accumulator);
  }

  check('a spent budget defers instead of running every slice',
    maxSteps < 4 && world.steps === frames,
    `maxSteps=${maxSteps} totalSteps=${world.steps}`);
  check('a spent budget is reported as exceeded',
    runner.report.budgetExceeded === true && runner.report.leftover > 0,
    `leftover=${runner.report.leftover}`);
  check('deferred frames still take at least one slice',
    maxSteps === 1, `maxSteps=${maxSteps}`);
  check('the backlog never exceeds one frame of work',
    maxAccumulator <= runner.maxAccumulator + 1e-12,
    `maxAccumulator=${maxAccumulator}`);
  check('excess time is dropped rather than replayed',
    runner.droppedTime > 0, `droppedTime=${runner.droppedTime}`);
  check('simulated + dropped time never exceeds what was requested',
    runner.simTime + runner.droppedTime <= frames / 60 + 1e-9,
    `simTime=${runner.simTime} dropped=${runner.droppedTime}`);
  check('no infinite catch-up: slices stay capped while behind',
    world.steps <= frames * PHYSICS.maxSubSteps, `steps=${world.steps}`);
}

// ----------------------------------------------------------- wall budget

{
  const runner = new FixedTimestepRunner({ budgetMs: 0.001 });
  const world = fakeWorld({ costMs: 0.5 });
  const r = runner.advance(world, 1 / 60);
  check('the wall-clock budget stops stepping mid-frame',
    r.budgetExceeded === true && r.steps < 4,
    `steps=${r.steps} elapsed=${r.elapsedMs.toFixed(2)}ms`);
  check('deferred time is preserved for the next frame',
    r.leftover > 0 && runner.accumulator === r.leftover,
    `leftover=${r.leftover}`);
  check('elapsed physics time is reported for scheduling',
    r.elapsedMs >= 0.5, `elapsed=${r.elapsedMs.toFixed(2)}ms`);
}

{
  const runner = new FixedTimestepRunner({ budgetMs: Infinity });
  const world = fakeWorld();
  const r = runner.advance(world, 1 / 60);
  check('an infinite budget disables wall-clock throttling',
    r.budgetExceeded === false && r.steps === 4, `steps=${r.steps}`);
}
// ------------------------------------------------------- adaptive precision

{
  const runner = new FixedTimestepRunner();
  const world = fakeWorld();
  runner.advance(world, 1 / 60);
  check('a lone ball runs at full solver precision',
    runner.quality === QUALITY.FULL
      && world.solver.iterations === PHYSICS.solverIterations,
    `quality=${runner.quality} iterations=${world.solver.iterations}`);

  // Crowd the world with extra dynamic bodies (multi-ball play).
  for (let i = 0; i < PHYSICS.crowdThreshold; i += 1) {
    world.bodies.push({ mass: 1, sleepState: 0 });
  }
  runner.advance(world, 1 / 60);
  check('a crowded board drops to reduced precision',
    runner.quality === QUALITY.REDUCED
      && world.solver.iterations === PHYSICS.reducedSolverIterations
      && world.solver.tolerance === PHYSICS.reducedSolverTolerance,
    `quality=${runner.quality} iterations=${world.solver.iterations}`);

  world.bodies.length = 0;
  runner.advance(world, 1 / 60);
  check('precision recovers once the board clears',
    runner.quality === QUALITY.FULL
      && world.solver.iterations === PHYSICS.solverIterations,
    `quality=${runner.quality} iterations=${world.solver.iterations}`);
}

{
  // Expensive slices must degrade precision *before* the frame budget is hit.
  const runner = new FixedTimestepRunner({ budgetMs: Infinity, slowCostMs: 2 });
  const world = fakeWorld({ costMs: 1 });
  for (let i = 0; i < 6; i += 1) runner.advance(world, 1 / 60);
  check('a consistently expensive step reduces precision early',
    runner.quality === QUALITY.REDUCED,
    `quality=${runner.quality} costEma=${runner.costEma.toFixed(2)}ms`);

  world.stepCostMs = 0;
  for (let i = 0; i < 12; i += 1) runner.advance(world, 1 / 60);
  check('precision returns to full when the cost drops',
    runner.quality === QUALITY.FULL,
    `quality=${runner.quality} costEma=${runner.costEma.toFixed(3)}ms`);
}

{
  // Sleepers may not count towards the crowd, or an idle board would degrade.
  const runner = new FixedTimestepRunner();
  const world = fakeWorld({ dynamics: 20 });
  for (const b of world.bodies) b.sleepState = 2;
  runner.advance(world, 1 / 60);
  check('sleeping bodies do not count as a crowd',
    runner.quality === QUALITY.FULL && runner.report.dynamicBodies === 0,
    `quality=${runner.quality} dynamic=${runner.report.dynamicBodies}`);
}

// ------------------------------------------------------------------ reset

{
  const runner = new FixedTimestepRunner({ budgetMs: 0 });
  const world = fakeWorld();
  for (let i = 0; i < 5; i += 1) runner.advance(world, 1 / 60);
  runner.reset();
  check('reset clears the backlog, alpha and precision',
    runner.accumulator === 0 && runner.alpha === 0
      && runner.quality === QUALITY.FULL && runner.simTime === 0,
    `accumulator=${runner.accumulator} quality=${runner.quality}`);
}

process.exit(report());
}