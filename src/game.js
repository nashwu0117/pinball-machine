/**
 * Game rules and the play loop.
 *
 * State machine:
 *
 *   READY ──(開始)──> SPINNING ──(按鈕停止抽選)──> AIMING
 *     ^                                                │
 *     │                                     (plunger released)
 *     │                                                v
 *     └────(balls > 0)──── RESOLVING <──(ball scores)── IN_PLAY
 *                            │
 *                       (balls == 0)
 *                            v
 *                        GAME_OVER
 *
 * The loop the player actually experiences:
 *   press 開始 -> a target is rolled -> pull the plunger -> the ball is fired
 *   -> physics decides where it lands -> score -> next ball.
 */

import {
  STARTING_BALLS, TARGETS, PLUNGER, BALL, BOARD, POCKET, LANE,
  BASE_SCORE_OPTIONS, SHOT_BATCH_OPTIONS, HOLE_MULTIPLIERS,
} from './config.js';
import { FixedTimestepRunner } from './loop.js';
import { sanitizeBodies } from './physics.js';
import { audio } from './audio.js';

export const STATE = {
  READY: 'READY',
  SPINNING: 'SPINNING',
  AIMING: 'AIMING',
  IN_PLAY: 'IN_PLAY',
  RESOLVING: 'RESOLVING',
  GAME_OVER: 'GAME_OVER',
};

const SPIN_DURATION = 1.5;
/** How long to watch a ball before giving up and calling it a drain. */
const DRAIN_TIMEOUT = BALL.maxSurvivalTime;
/** How long the SUCCESS / MISS flash stays on screen. */
const RESOLVE_DURATION = 1.15;
const SCORE_STORAGE_KEY = 'night-market-pinball-high-score';

export class Game {
  /**
   * @param {import('./pinball.js').PinballMachine} machine
   */
  constructor(machine) {
    this.machine = machine;
    this.ui = null;
    // Owns the fixed-timestep accumulator, the per-frame physics time budget
    // and the adaptive solver precision. See src/loop.js.
    this.stepper = new FixedTimestepRunner();
    this.reset();
    this._wire();
  }

  /** Attach the UI after construction (the UI needs the game too). */
  attachUI(ui) {
    this.ui = ui;
    ui.bindGame(this);
    ui.render(this);
  }

  /** Full reset back to a fresh, unplayed machine. */
  reset() {
    // The high score belongs to the machine, not to an individual ticket.
    this.highScore = this.highScore ?? this._loadHighScore();
    this.balls = STARTING_BALLS;
    this.baseScore = 20;
    this.batchSize = STARTING_BALLS;
    this.target = null;
    this.targetLane = null;
    this.earned = 0;
    this.bestMultiplier = 0;
    this.shots = 0;
    this.hits = 0;
    this.score = 0;
    this.highestShot = 0;
    /** Bonus balls won by hitting the locked target lane (the real machine's
        actual reward -- see _scorePocket). Distinct from `score`, which is
        this project's own scoring abstraction and pays out on every pocket. */
    this.ballsWon = 0;
    this.targetHits = 0;
    this.history = [];
    this.multiplierStats = Object.fromEntries(HOLE_MULTIPLIERS.map((m) => [m, 0]));
    this.combo = 0;
    this.bestCombo = 0;

    this.spinElapsed = 0;
    this.spinInterval = 0.075;
    this._lastTick = -1;
    this.spinLane = 0;
    this.ballTimer = 0;
    this.resolveTimer = 0;
    this.stuckTime = 0;
    this.stillTimer = 0;
    this.lastTrackPos = null;
    this.continuousOverlapPos = null;
    this.continuousOverlapTimer = 0;
    this.recoveryTries = 0;
    this.shotCommitted = false;
    this.lastResult = null;
    this.pendingResult = null;

    this.state = STATE.READY;
    this.machine.ballActive = false;
    // Park and stop the reusable body while no shot is active. Otherwise a
    // scored/drained ball keeps receiving gravity and can emit hidden contact
    // effects between rounds or while the game-over card is visible.
    const body = this.machine.ballBody;
    body.position?.set(
      this.machine.barrelX ?? LANE.channelX,
      BALL.radius + 1.1,
      LANE.loadZ + 2.0,
    );
    body.velocity?.set(0, 0, 0);
    body.angularVelocity?.set(0, 0, 0);
    body.force?.set(0, 0, 0);
    body.torque?.set(0, 0, 0);
    body.wakeUp?.();
    // Drop any backlog from the previous round so a fresh game starts level.
    this.stepper.reset();
    this.machine.clearLeds();
    this.machine.clearLaneLeds?.();
    this.machine.setReadout(this.balls, null);
    this.ui?.render(this);
  }

  // ------------------------------------------------------------------ wiring

  _wire() {
    const m = this.machine;
    m.onPegHit = (speed) => {
      audio.peg(Math.min(1, speed / 260));
      // Shake proportional to impact speed, capped so it stays a subtle rumble.
      this.ui?.shake(Math.min(0.16, (speed / 260) * 0.16));
    };
    m.onBumperHit = (index, speed) => {
      m.flashBumper(index);
      audio.bumper();
      this.ui?.shake(Math.min(0.28, (speed / 300) * 0.28));
      if (this.state === STATE.IN_PLAY) {
        this.score += 10;
        this.ui?.renderScore(this);
      }
    };
  }

  // ------------------------------------------------------------------ actions

  setBaseScore(value) {
    const next = Number(value);
    if (!BASE_SCORE_OPTIONS.includes(next) || ![STATE.READY, STATE.GAME_OVER].includes(this.state)) return false;
    this.baseScore = next;
    this.ui?.render(this);
    return true;
  }

  setBatchSize(value) {
    const next = Number(value);
    if (!SHOT_BATCH_OPTIONS.includes(next) || ![STATE.READY, STATE.GAME_OVER].includes(this.state)) return false;
    this.batchSize = next;
    this.balls = next;
    this.ui?.render(this);
    return true;
  }

  /** Player pressed 開始. */
  pressStart() {
    if (this.state === STATE.GAME_OVER) {
      this.reset();
    }
    if (this.state !== STATE.READY) return false;
    if (this.balls <= 0) return false;

    this.state = STATE.SPINNING;
    this.target = null;
    this.spinElapsed = 0;
    this.spinInterval = 0.075;
    this._lastTick = -1;
    this.machine.buttonPressed = true;
    this.machine.clearLeds();
    this.machine.clearLaneLeds?.();
    this.machine.startLedBlink(TARGETS, this.spinInterval);
    audio.start();
    this.ui?.render(this);
    return true;
  }

  /** Stop the live roulette when the player presses the red/white start key. */
  stopSpin() {
    if (this.state !== STATE.SPINNING) return false;
    const values = this.machine.ledBlink?.values ?? TARGETS;
    const interval = this.machine.ledBlink?.interval ?? this.spinInterval;
    const elapsed = this.machine.ledBlink?.elapsed ?? this.spinElapsed;
    const valueIndex = Math.floor(elapsed / interval) % values.length;
    this._lockSpin(values[valueIndex], this.spinLane);
    return true;
  }

  /**
   * Run the LED roulette. The blink interval grows over time so the roulette
   * visibly decelerates before it locks, exactly like the real machine.
   */
  _updateSpin(dt) {
    this.spinElapsed += dt;
    const phase = Math.min(1, this.spinElapsed / SPIN_DURATION);
    this.spinInterval = 0.075 + Math.pow(phase, 2.2) * 0.42;
    this.machine.ledBlink.interval = this.spinInterval;

    const tick = Math.floor(this.spinElapsed / this.spinInterval);
    if (tick !== this._lastTick) {
      this._lastTick = tick;
      this.spinLane = tick % this.machine.pocketZones.length;
      this.machine.setLaneTarget?.(this.spinLane);
      audio.tick();
    }

    // The roulette intentionally stays live until the player presses the
    // physical start key; there is no automatic lock anymore.
  }

  _lockSpin(target, lane) {
    this.target = target;
    this.targetLane = lane;
    this.machine.stopLedBlink(this.target);
    this.machine.setLaneTarget?.(this.targetLane);
    this.machine.buttonPressed = false;
    audio.lock();

    this.state = STATE.AIMING;
    this.machine.loadBall();
    audio.load();
    this.machine.setReadout(this.balls, this.target);
    this.ui?.render(this);
  }

  /**
   * Player released the plunger.
   * @param {number} pull outward pull distance in cm (0..PLUNGER.maxPull)
   * @returns {boolean} whether a ball was actually fired
   */
  releasePlunger(pull) {
    if (this.state !== STATE.AIMING) return false;
    if (this.balls <= 0) return false;

    this.state = STATE.IN_PLAY;
    this.ballTimer = 0;
    this.stuckTime = 0;
    this.stillTimer = 0;
    this.lastTrackPos = null;
    this.continuousOverlapPos = null;
    this.continuousOverlapTimer = 0;
    this.recoveryTries = 0;
    this.shotCommitted = false;
    this.pendingResult = null;
    this.lastResult = null;

    this.machine.launchBall(pull);
    audio.launch(Math.min(1, pull / PLUNGER.maxPull));
    this.ui?.shake(0.32);
    this.machine.setReadout(this.balls, this.target);
    this.ui?.render(this);
    return true;
  }

  // -------------------------------------------------------------- per-frame

  /**
   * One rendered frame.
   *
   * The physics world is advanced by `game.stepper`, which never spends more
   * than its wall-clock budget and never chases more than `maxSubSteps` fixed
   * slices. Whatever did not fit is deferred, so this method always returns
   * promptly and the caller can render + service input.
   *
   * @param {number} frameDelta seconds since the previous frame
   * @returns {object} the scheduler telemetry for this frame (see src/loop.js)
   */
  update(frameDelta) {
    // Never hand the solver NaN/Inf state (see physics.js).
    sanitizeBodies(this.machine.world);

    const step = this.stepper.advance(this.machine.world, frameDelta);

    // Presentation (LED roulette, flash timers, visual easing) runs on the
    // wall clock; ball tracking runs on simulated time so a deferred frame
    // cannot age the shot or fake a timeout.
    const renderDt = step.renderDt;
    const physicsDt = step.simulatedDt;

    if (this.state === STATE.SPINNING) {
      this._updateSpin(renderDt);
    }

    this.machine.update(renderDt, this.stepper.alpha);

    if (this.state === STATE.IN_PLAY) {
      this._trackBall(physicsDt);
    } else if (this.state === STATE.RESOLVING) {
      this._tickResolve(renderDt);
    }

    return step;
  }

  /**
   * Watch the ball while it is on the board: detect a pocket entry, or decide
   * that the ball is wedged and must be recovered.
   */
  _trackBall(dt) {
    const ball = this.machine.ballBody;
    this.ballTimer += dt;

    // --- invalidate guards: if position/velocity became NaN/Inf, reset immediately ---
    if (
      !isFinite(ball.position.x) || !isFinite(ball.position.y) || !isFinite(ball.position.z) ||
      !isFinite(ball.velocity.x) || !isFinite(ball.velocity.y) || !isFinite(ball.velocity.z)
    ) {
      ball.position.set(0, 2, BOARD.height / 2);
      ball.velocity.set(0, 0, 0);
      ball.angularVelocity.set(0, 0, 0);
      this.ballTimer = 0;
      this.recoveryTries = 0;
      this.lastTrackPos = null;
      this.stillTimer = 0;
      this._finishShot();
      return;
    }

    const speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);

    // --- stuck detection: ball nearly stationary for too long ---
    if (speed < BALL.stuckSpeed) {
      this.stuckTime += dt;
      if (this.stuckTime > BALL.stuckTimeout) {
        this.stuckTime = 0;
        this.lastTrackPos = null;
        this.stillTimer = 0;
        this.recoveryTries += 1;
        ball.wakeUp();
        const spot = this._findOpenSpot(ball.position);
        ball.position.set(spot.x, Math.min(ball.position.y, 2.5), spot.z);
        ball.velocity.set((Math.random() * 2 - 1) * 40, 6, 20 + Math.random() * 22);
        ball.angularVelocity.set(0, 0, 0);
        if (this.recoveryTries > 5) {
          this.recoveryTries = 0;
          this._finishShot();
          return;
        }
      }
    } else {
      this.stuckTime = 0;
    }

    const p = ball.position;

    // A ball is not spent merely because the plunger moved. Charge the ball
    // only after it has genuinely left the right-hand launch channel and
    // entered the playfield. This lets weak launches roll back for another try.
    if (!this.shotCommitted && p.x < LANE.dividerX - BALL.radius * 0.4) {
      this._commitShot();
    }

    // --- pocket detection --------------------------------------------------
    // A ball counts as pocketed when it is inside a slot's x range and has
    // dropped below the slot mouth. Reading the actual position (instead of a
    // trigger volume) means a ball that merely skims the lip over a divider
    // does not score.
    const mouthZ = BOARD.height - POCKET.depth - 0.5;
    if (p.z > mouthZ && p.y < 3.4) {
      for (const zone of this.machine.pocketZones) {
        if (Math.abs(p.x - zone.x) <= zone.halfWidth - BALL.radius * 0.2) {
          this._scorePocket(zone.index);
          return;
        }
      }
    }

    // --- weak launch that never left the barrel --------------------------------
    // Too little power to climb the lane: the ball rolls back to the plunger
    // and remains available. Do not consume it or turn it into a drain.
    if (!this.shotCommitted && this.ballTimer > 1.0
      && speed < 10 && p.x > LANE.dividerX && p.z > LANE.loadZ - 2) {
      this._returnBallToPlunger();
      return;
    }

    // --- ball teetering on the pocket divider tips ------------------------------
    // Elevated and deep in the mouth zone means balanced on a divider tip or
    // an arch. Relocate to open track instead of grinding in the crack.
    if (this.ballTimer > 2.5 && p.z > BOARD.height - POCKET.depth - 1.5 && p.y > 2.8) {
      const spot = this._findOpenSpot(p);
      ball.wakeUp();
      ball.position.set(spot.x, Math.min(p.y, 2.5), spot.z);
      ball.velocity.set((Math.random() * 2 - 1) * 20, 0, 25 + Math.random() * 15);
      ball.angularVelocity.set(0, 0, 0);
      this.lastTrackPos = null;
      this.stillTimer = 0;
      this.recoveryTries += 1;
      if (this.recoveryTries > 5) {
        this.recoveryTries = 0;
        this._finishShot();
        return;
      }
    }

    // --- wedged-ball recovery ----------------------------------------------
    // Anchor-based: a ball rattling inside a funnel can read high speed while
    // going nowhere, so displacement over time is the only honest signal.
    if (this.ballTimer > 2.5) {
      if (!this.lastTrackPos) {
        this.lastTrackPos = { x: p.x, y: p.y, z: p.z };
        this.stillTimer = 0;
      } else {
        const moved = Math.hypot(p.x - this.lastTrackPos.x, p.y - this.lastTrackPos.y, p.z - this.lastTrackPos.z);
        if (moved < 3.0) {
          this.stillTimer += dt;
        } else {
          this.stillTimer = 0;
          this.lastTrackPos = { x: p.x, y: p.y, z: p.z };
        }
      }
    }

    if (this.stillTimer > 3.0) {
      this.stillTimer = 0;
      this.lastTrackPos = null;
      this.recoveryTries += 1;
      const spot = this._findOpenSpot(p);
      ball.wakeUp();
      ball.position.set(spot.x, p.y + 1.5, spot.z);
      ball.velocity.set((Math.random() * 2 - 1) * 40, 6, 20 + Math.random() * 22);
      ball.angularVelocity.set(0, 0, 0);
      if (this.recoveryTries > 5) {
        this.recoveryTries = 0;
        this._finishShot();
        return;
      }
    }

    // --- extreme out-of-bounds guard ---
    // If the ball has gone far beyond the playfield walls, force-finish the shot.
    const { x, z } = p;
    if (Math.abs(x) > BOARD.width / 2 + BALL.outOfBoundsExtra
        || z > BOARD.height + BALL.outOfBoundsExtra
        || z < -BALL.outOfBoundsExtra) {
      this._finishShot();
    }

    // --- continuous overlap guard ---
    // If the ball has remained in a confined area for too long, relocate it.
    if (!this.continuousOverlapPos) {
      this.continuousOverlapPos = { x: p.x, z: p.z };
      this.continuousOverlapTimer = 0;
    }
    const moved = Math.hypot(p.x - this.continuousOverlapPos.x, p.z - this.continuousOverlapPos.z);
    if (moved < 5.0) {
      this.continuousOverlapTimer += dt;
      if (this.continuousOverlapTimer > BALL.continuousOverlapTime) {
        this.continuousOverlapTimer = 0;
        this.continuousOverlapPos = null;
        this.recoveryTries += 1;
        ball.wakeUp();
        const spot = this._findOpenSpot(p);
        ball.position.set(spot.x, Math.min(p.y, 2.5), spot.z);
        ball.velocity.set((Math.random() * 2 - 1) * 40, 6, 20 + Math.random() * 22);
        ball.angularVelocity.set(0, 0, 0);
        if (this.recoveryTries > 5) {
          this.recoveryTries = 0;
          this._finishShot();
          return;
        }
      }
    } else {
      this.continuousOverlapPos = { x: p.x, z: p.z };
      this.continuousOverlapTimer = 0;
    }

    // --- overall timeout ---------------------------------------------------
    // Hard cap: if the ball has been on board too long without scoring or
    // committing, force-finish the shot to free the thread.
    if (this.ballTimer > DRAIN_TIMEOUT) {
      this._finishShot();
    }
  }

  /**
   * The ball landed in a scoring slot.
   *
   * Two independent rules stack here (see docs/game-spec.md §4):
   *  - 〔設計〕every pocket pays `baseScore * that hole's multiplier` -- this
   *    project's own scoring abstraction, always active.
   *  - 〔實機〕only landing in the lane the LED roulette locked (`targetLane`)
   *    is the real machine's actual win condition, and it pays out bonus
   *    balls (`target`, one of 2/4/6/8/10), not points.
   *
   * @param {number} lane zero-based scoring-lane index
   */
  _scorePocket(lane) {
    // A pocket can only resolve the currently active shot. This protects the
    // state machine from duplicate sensor/collision notifications in the same
    // frame and keeps a stale event from awarding balls twice.
    if (this.state !== STATE.IN_PLAY || !this.machine.ballActive) return false;

    // Defensive fallback: a scoring ball necessarily reached the playfield,
    // even if an unusually large physics step skipped the exit check above.
    this._commitShot();
    const multiplier = HOLE_MULTIPLIERS[lane] ?? 1;
    const points = this.baseScore * multiplier;
    const hitTarget = this.targetLane != null && lane === this.targetLane;
    const reward = hitTarget ? (this.target ?? 0) : 0;
    this.machine.ballActive = false;
    audio.pocket();
    this.score += points;
    this.hits += 1;
    this.earned += points;
    if (reward > 0) {
      this.balls += reward;
      this.ballsWon += reward;
      this.targetHits += 1;
    }
    this.bestMultiplier = Math.max(this.bestMultiplier, multiplier);
    this.highestShot = Math.max(this.highestShot, points);
    this.multiplierStats[multiplier] = (this.multiplierStats[multiplier] ?? 0) + 1;
    this.history.unshift({
      shot: this.shots, multiplier, base: this.baseScore, points, lane, hitTarget, reward,
    });
    this.history = this.history.slice(0, 12);
    this.pendingResult = {
      type: 'score', value: multiplier, lane, points, combo: 0, hitTarget, reward,
    };
    if (hitTarget) audio.win();
    else if (multiplier >= 5) audio.win();
    this.ui?.shake(hitTarget || multiplier >= 10 ? 0.7 : 0.35);

    this.lastResult = this.pendingResult;
    this.state = STATE.RESOLVING;
    this.resolveTimer = 0;
    this.machine.setReadout(this.balls, this.target);
    this.ui?.render(this);
    return true;
  }

  /** Advance the SUCCESS / MISS flash, then start the next ball. */
  _tickResolve(dt) {
    this.resolveTimer += dt;
    if (this.resolveTimer < RESOLVE_DURATION) return;

    this.machine.setPocketHighlight(this.targetLane, false);
    this.pendingResult = null;

    if (this.balls <= 0) {
      this._gameOver();
    } else {
      this.state = STATE.READY;
      this.machine.clearLeds();
      this.machine.clearLaneLeds?.();
      this.machine.setReadout(this.balls, null);
      this.ui?.render(this);
      // A new ball is already available, so the target lamps begin cycling
      // immediately. The same button press now stops this next roulette.
      this.pressStart();
    }
  }

  _findOpenSpot(p) {
    const m = this.machine;
    const clear = (x, z) => {
      if (x < -15.2 || x > 13.1 || z < 3 || z > BOARD.height - POCKET.depth - 1) return false;
      if (Math.abs(x - LANE.dividerX) < 1.25 && z > 7) return false;
      for (const pocket of m.pocketZones) {
        if (z > BOARD.height - POCKET.depth - 2
          && Math.abs(x - pocket.x) < pocket.halfWidth + 0.75) return false;
      }
      for (const peg of m.pegs) {
        const dx = x - peg.x;
        const dz = z - peg.z;
        if (dx * dx + dz * dz < 2.1 * 2.1) return false;
      }
      for (const b of m.bumperSpecs ?? []) {
        if (Math.hypot(x - b.x, z - b.z) < b.radius + 1.8) return false;
      }
      for (const d of m.deflectorSpecs ?? []) {
        const dx = Math.sin(d.angle) * d.l / 2;
        const dz = Math.cos(d.angle) * d.l / 2;
        const segX = x - d.x;
        const segZ = z - d.z;
        const t = Math.max(-1, Math.min(1, (segX * dx + segZ * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(segX - dx * t, segZ - dz * t) < 1.9) return false;
      }
      return true;
    };
    for (const [ox, oz] of [[0, 3.5], [-3, 2], [3, 2], [0, -3.5], [-3, -2], [3, -2], [-5, 0], [5, 0]]) {
      if (clear(p.x + ox, p.z + oz)) return { x: p.x + ox, z: p.z + oz };
    }
    return { x: p.x, z: p.z };
  }

  /** Consume the ball once it has truly crossed from the barrel into play. */
  _commitShot() {
    if (this.shotCommitted) return;
    this.shotCommitted = true;
    this.balls = Math.max(0, this.balls - 1);
    this.shots += 1;
    this.machine.setReadout(this.balls, this.target);
    this.ui?.render(this);
  }

  /** A weak launch rolled back: reload the same ball without charging a shot. */
  _returnBallToPlunger() {
    this.state = STATE.AIMING;
    this.ballTimer = 0;
    this.stuckTime = 0;
    this.stillTimer = 0;
    this.lastTrackPos = null;
    this.continuousOverlapPos = null;
    this.continuousOverlapTimer = 0;
    this.recoveryTries = 0;
    this.shotCommitted = false;
    this.pendingResult = null;
    this.machine.loadBall();
    this.machine.setReadout(this.balls, this.target);
    this.ui?.render(this);
    this.ui?.flashResult({ type: 'retry', value: null });
  }

  /** The ball left play without scoring (wedged too long, or timed out). */
  _finishShot() {
    if (!this.shotCommitted) {
      this._returnBallToPlunger();
      return;
    }
    this.combo = 0;
    this.pendingResult = { type: 'drain', value: null, points: 0, combo: 0 };
    this.lastResult = this.pendingResult;
    audio.drain();
    this.state = STATE.RESOLVING;
    this.resolveTimer = 0;
    this.machine.ballActive = false;
    this.ui?.render(this);
  }

  _gameOver() {
    this.state = STATE.GAME_OVER;
    this.machine.ballActive = false;
    this.machine.clearLeds();
    this.machine.clearLaneLeds?.();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      this._saveHighScore();
    }
    audio.gameOver();
    this.ui?.render(this);
  }

  _loadHighScore() {
    try {
      const value = Number.parseInt(localStorage.getItem(SCORE_STORAGE_KEY) ?? '0', 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  _saveHighScore() {
    try {
      localStorage.setItem(SCORE_STORAGE_KEY, String(this.highScore));
    } catch {
      // Persistence is optional in private or embedded browser contexts.
    }
  }
}
