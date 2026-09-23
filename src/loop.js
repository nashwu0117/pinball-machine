/**
 * Fixed-timestep simulation scheduler.
 *
 * Rendering runs at whatever rate `requestAnimationFrame` hands us, but the
 * physics world is only ever advanced in whole `PHYSICS.fixedStep` slices. This
 * module owns the accumulator, the catch-up cap and the wall-clock budget for
 * the physics portion of one frame:
 *
 *   accumulator += frameDelta                     // clamped incoming delta
 *   accumulator  = min(accumulator, fixedStep * maxSubSteps)  // excess dropped
 *   while (accumulator >= fixedStep && steps < maxSubSteps) {
 *     world.step(fixedStep)                       // one fixed slice, never a variable dt
 *     if (spent >= budgetMs) defer;               // the rest waits for the next frame
 *   }
 *
 * Three valves keep the machine responsive when there is a lot to do (many
 * balls on the board, or a slow device):
 *
 *  - **deferral** – slices that did not fit in the budget stay accumulated and
 *    are simulated on a later frame instead of blocking this one.
 *  - **catch-up cap** – at most `maxSubSteps` slices per frame, and the backlog
 *    itself is capped, so falling behind can never snowball ("spiral of death").
 *  - **reduced precision** – `world.solver.iterations` / `tolerance` drop to the
 *    reduced tier while the machine is crowded or the measured cost is close to
 *    the budget, then recover once things calm down.
 *
 * The unsimulated fraction of the newest slice is exposed as `alpha` so the
 * renderer can interpolate between the last two physics poses and stay smooth
 * even on a frame that could not catch all the way up.
 */

import { PHYSICS } from './config.js';

const hasPerformance = typeof performance !== 'undefined'
  && typeof performance.now === 'function';

/** Monotonic wall clock in milliseconds (browser and Node). */
const nowMs = () => (hasPerformance ? performance.now() : Date.now());

/** cannon-es `Body.SLEEPING` (kept numeric so this module stays dependency-free). */
const SLEEPING = 2;

export const QUALITY = {
  FULL: 'full',
  REDUCED: 'reduced',
};

/**
 * Build the solver-quality tiers from the config. Each tier is a stable object
 * so `_applied === tier` can skip redundant solver writes.
 * @param {object} cfg
 */
function buildTiers(cfg) {
  return {
    [QUALITY.FULL]: {
      iterations: cfg.solverIterations,
      tolerance: cfg.solverTolerance,
    },
    [QUALITY.REDUCED]: {
      iterations: cfg.reducedSolverIterations,
      tolerance: cfg.reducedSolverTolerance,
    },
  };
}

export class FixedTimestepRunner {
  /**
   * @param {Partial<typeof PHYSICS>} [options] overrides (tests / tuning)
   */
  constructor(options = {}) {
    const cfg = { ...PHYSICS, ...options };
    this.fixedStep = cfg.fixedStep;
    this.maxSubSteps = cfg.maxSubSteps;
    this.budgetMs = cfg.budgetMs;
    this.maxFrameDelta = Math.min(cfg.maxFrameDelta, cfg.fixedStep * cfg.maxSubSteps);
    this.crowdThreshold = cfg.crowdThreshold;
    this.slowCostMs = cfg.slowCostMs ?? cfg.budgetMs * 0.8;
    this.degradedHoldMs = cfg.degradedHoldMs;
    this.tiers = buildTiers(cfg);

    /** Largest backlog we are ever willing to simulate: one full frame of work. */
    this.maxAccumulator = this.fixedStep * this.maxSubSteps;

    /** Unsimulated time (s) waiting for the next frame. */
    this.accumulator = 0;
    /** Fraction (0..1) of the newest fixed slice still unsimulated. */
    this.alpha = 0;
    /** Current solver tier (`full` | `reduced`). */
    this.quality = QUALITY.FULL;
    /** Simulated game time (s) since the last reset. */
    this.simTime = 0;
    /** Time (s) dropped because the backlog hit `maxAccumulator`. */
    this.droppedTime = 0;
    /** Exponentially smoothed physics cost per frame (ms). */
    this.costEma = 0;

    this._holdMs = 0;
    this._budgetHit = false;
    this._dynamicBodies = 0;
    this._applied = null;

    this.report = this._emptyReport();
  }

  _emptyReport() {
    return {
      requested: 0,
      clamped: 0,
      renderDt: 0,
      simulatedDt: 0,
      steps: 0,
      budgetExceeded: false,
      catchUpCapped: false,
      dropped: 0,
      leftover: 0,
      alpha: 0,
      elapsedMs: 0,
      quality: QUALITY.FULL,
      dynamicBodies: 0,
    };
  }

  /** Forget any backlog and return to full precision (new game / new round). */
  reset() {
    this.accumulator = 0;
    this.alpha = 0;
    this.quality = QUALITY.FULL;
    this.simTime = 0;
    this.droppedTime = 0;
    this.costEma = 0;
    this._holdMs = 0;
    this._budgetHit = false;
    this._applied = null;
  }

  /**
   * Advance the world by at most one frame worth of fixed slices.
   *
   * @param {import('cannon-es').World} world
   * @param {number} frameDelta seconds since the previous frame
   * @returns {object} telemetry for the caller
   */
  advance(world, frameDelta) {
    const requested = Number.isFinite(frameDelta) && frameDelta > 0 ? frameDelta : 0;
    // A backgrounded tab can hand us a multi-second delta. Keep only one frame
    // of catch-up work; the rest is dropped by the backlog clamp below.
    const clamped = Math.min(requested, this.maxFrameDelta);

    this.accumulator += clamped;

    let dropped = 0;
    if (this.accumulator > this.maxAccumulator) {
      dropped = this.accumulator - this.maxAccumulator;
      this.accumulator = this.maxAccumulator;
      this.droppedTime += dropped;
    }

    this._selectQuality(world, clamped);
    this._applyTier(world);

    const started = nowMs();
    let steps = 0;
    let budgetExceeded = false;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
      world.step(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps += 1;
      // Stop as soon as the frame budget is spent; the leftover stays in the
      // accumulator and is picked up next frame instead of blocking the render.
      if (steps < this.maxSubSteps && nowMs() - started >= this.budgetMs) {
        budgetExceeded = true;
        break;
      }
    }
    const elapsedMs = nowMs() - started;

    // Pending time means we are behind (catch-up cap or the frame budget).
    const catchUpCapped = this.accumulator >= this.fixedStep;
    this.alpha = Math.min(1, Math.max(0, this.accumulator / this.fixedStep));
    this.simTime += steps * this.fixedStep;

    this._budgetHit = budgetExceeded || catchUpCapped;
    this._trackCost(elapsedMs, steps);

    this.report = {
      requested,
      clamped,
      /** Wall-clock delta that presentation code may use. */
      renderDt: clamped,
      /** Simulated time actually covered by this call. */
      simulatedDt: steps * this.fixedStep,
      steps,
      budgetExceeded,
      catchUpCapped,
      dropped,
      leftover: this.accumulator,
      alpha: this.alpha,
      elapsedMs,
      quality: this.quality,
      dynamicBodies: this._dynamicBodies,
    };
    return this.report;
  }

  /**
   * Pick the solver precision for the slices we are about to run. Degrading is
   * immediate; recovery waits out `degradedHoldMs` so the tier cannot oscillate.
   */
  _selectQuality(world, clamped) {
    const dynamics = this._countDynamic(world);
    this._dynamicBodies = dynamics;

    this._holdMs = Math.max(0, this._holdMs - clamped * 1000);
    if (this._budgetHit) this._holdMs = this.degradedHoldMs;
    this._budgetHit = false;

    const crowded = dynamics >= this.crowdThreshold;
    const slow = this.costEma > this.slowCostMs;
    this.quality = (crowded || slow || this._holdMs > 0) ? QUALITY.REDUCED : QUALITY.FULL;
  }

  /** Write the current tier into the solver, but only when it actually changed. */
  _applyTier(world) {
    const tier = this.tiers[this.quality];
    if (!tier || !world || !world.solver || this._applied === tier) return;
    world.solver.iterations = tier.iterations;
    world.solver.tolerance = tier.tolerance;
    this._applied = tier;
  }

  /** How many awake dynamic bodies the world currently owns. */
  _countDynamic(world) {
    const bodies = world && world.bodies;
    if (!bodies) return 0;
    let count = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      if (body.mass > 0 && body.sleepState !== SLEEPING) count += 1;
    }
    return count;
  }

  /**
   * Smooth the per-frame physics cost so one slow frame is not enough to
   * degrade. The 0.3 decay lets a recovered board climb back under
   * `slowCostMs` within a dozen frames (~200ms); a slower filter would keep
   * the reduced tier latched long after the cost is gone.
   */
  _trackCost(elapsedMs, steps) {
    if (steps === 0) return;
    this.costEma = this.costEma === 0
      ? elapsedMs
      : this.costEma * 0.7 + elapsedMs * 0.3;
  }
}