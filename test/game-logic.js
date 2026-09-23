/**
 * Unit tests for the core play loop rules (src/game.js), run in plain Node
 * against a fake machine -- no browser, no WebGL, no cannon-es world.
 *
 * `Game` only touches `machine.ballBody.position/velocity/angularVelocity`
 * (plain vector-like objects with a `.set`) and a handful of machine methods
 * (loadBall/launchBall/setReadout/led helpers). None of that requires a real
 * physics engine, so the state machine, scoring and anti-stuck/anti-tunnel
 * recovery rules can be exercised directly and reproducibly.
 *
 *   node test/game-logic.js
 */

import { Game, STATE } from '../src/game.js';
import {
  STARTING_BALLS, TARGETS, BALL, BOARD, POCKET, LANE, HOLE_MULTIPLIERS,
  BASE_SCORE_OPTIONS, SHOT_BATCH_OPTIONS,
} from '../src/config.js';
import { check, report } from './assert.js';

// --------------------------------------------------------------- fake machine

function vec3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
  };
}

function makeBallBody() {
  return {
    position: vec3(0, 2, LANE.loadZ),
    velocity: vec3(0, 0, 0),
    angularVelocity: vec3(0, 0, 0),
    quaternion: { set() {} },
    force: { set() {} },
    torque: { set() {} },
    wakeUp() {},
  };
}

/** Mirrors the pocketZones shape built by src/geometry.js PocketMethods. */
function makePocketZones() {
  const zCenter = BOARD.height - POCKET.depth / 2 - 1.0;
  return HOLE_MULTIPLIERS.map((multiplier, index) => ({
    value: index, lane: index, index,
    x: -12.0 + index * 3.0,
    z: zCenter,
    halfWidth: POCKET.width / 2,
    multiplier,
  }));
}

class FakeMachine {
  constructor() {
    this.world = { bodies: [] };
    this.ballBody = makeBallBody();
    this.ballActive = false;
    this.pocketZones = makePocketZones();
    this.pegs = [];
    this.bumperSpecs = [];
    this.deflectorSpecs = [];
    this.buttonPressed = false;
    this.ledBlink = null;
    this.laneLedMeshes = [];

    this.loadBallCalls = 0;
    this.launchBallCalls = 0;
  }
  clearLeds() { this.ledBlink = null; }
  clearLaneLeds() {}
  setReadout() {}
  setPocketHighlight() {}
  setLaneTarget() {}
  startLedBlink(values, interval = 0.075) { this.ledBlink = { values, interval, elapsed: 0 }; }
  stopLedBlink() { this.ledBlink = null; }
  loadBall() { this.ballActive = true; this.loadBallCalls += 1; }
  launchBall(pull) { this.launchBallCalls += 1; return pull; }
}

function freshGame() {
  const machine = new FakeMachine();
  const game = new Game(machine);
  return { game, machine };
}

/** Drive the state machine from READY all the way to AIMING with a known target. */
function armShot(game, targetIndex = 0) {
  game.pressStart();
  // Lock in a deterministic target/lane instead of relying on the live clock.
  game._lockSpin(TARGETS[targetIndex], targetIndex);
  return game.target;
}

// mouthZ / a position guaranteed to land inside pocket `index`.
const mouthZ = BOARD.height - POCKET.depth - 0.5;
function pocketPosition(index) {
  const zone = makePocketZones()[index];
  return { x: zone.x, y: 2.0, z: mouthZ + 1 };
}

// ------------------------------------------------------------ initial state

{
  const { game } = freshGame();
  check('fresh game starts in READY with STARTING_BALLS balls',
    game.state === STATE.READY && game.balls === STARTING_BALLS,
    `state=${game.state} balls=${game.balls}`);
  check('fresh game has zero score', game.score === 0, `score=${game.score}`);
}

// ------------------------------------------------------- start / spin / lock

{
  const { game, machine } = freshGame();
  const ok = game.pressStart();
  check('pressStart from READY succeeds', ok === true);
  check('pressStart moves READY -> SPINNING', game.state === STATE.SPINNING, `state=${game.state}`);
  check('pressStart starts the LED roulette', machine.ledBlink !== null);

  // Duplicate event: a second physical press (or a synthetic repeat) while the
  // roulette is already running must not restart it or fire twice.
  const again = game.pressStart();
  check('duplicate pressStart while SPINNING is rejected', again === false, `again=${again}`);
  check('state is unaffected by the duplicate press', game.state === STATE.SPINNING);

  const target = TARGETS[2];
  game._lockSpin(target, 2);
  check('stopSpin/_lockSpin moves SPINNING -> AIMING', game.state === STATE.AIMING, `state=${game.state}`);
  check('locked target is one of the valid LED targets', TARGETS.includes(game.target), `target=${game.target}`);

  const stopAgain = game.stopSpin();
  check('duplicate stopSpin while AIMING is rejected (already locked)', stopAgain === false);
}

// ------------------------------------------------------ plunger / duplicate fire

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  const ballsBeforeFire = game.balls;

  const fired = game.releasePlunger(5);
  check('releasePlunger from AIMING fires the ball', fired === true);
  check('firing moves AIMING -> IN_PLAY', game.state === STATE.IN_PLAY, `state=${game.state}`);
  check('machine.launchBall was invoked exactly once', machine.launchBallCalls === 1, `calls=${machine.launchBallCalls}`);
  check('balls are not spent merely by firing (only a committed shot spends one)',
    game.balls === ballsBeforeFire, `before=${ballsBeforeFire} after=${game.balls}`);

  // The classic double-fire bug: two pointerup/keyup events (or a click and a
  // held-Enter) racing for the same shot must only ever launch one ball.
  const firedAgain = game.releasePlunger(5);
  check('duplicate releasePlunger while IN_PLAY is rejected', firedAgain === false);
  check('machine.launchBall was NOT invoked a second time', machine.launchBallCalls === 1, `calls=${machine.launchBallCalls}`);
}

{
  const { game } = freshGame();
  check('releasePlunger outside AIMING is rejected', game.releasePlunger(5) === false, `state=${game.state}`);
  check('stopSpin outside SPINNING is rejected', game.stopSpin() === false, `state=${game.state}`);
}

// -------------------------------------------------------------- ball commit

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(5);
  const ballsBefore = game.balls;

  const ball = machine.ballBody;
  ball.position.set(LANE.dividerX + 3, 2, 30); // still in the launch channel
  game._trackBall(0.016);
  check('ball still in the launch channel does not spend a ball yet',
    game.balls === ballsBefore && !game.shotCommitted, `balls=${game.balls} committed=${game.shotCommitted}`);

  ball.position.set(LANE.dividerX - 2, 2, 30); // crossed into the playfield
  game._trackBall(0.016);
  check('crossing the lane divider commits the shot and spends exactly one ball',
    game.shotCommitted && game.balls === ballsBefore - 1,
    `committed=${game.shotCommitted} balls=${game.balls}`);

  // Re-tracking further frames must never double-charge the same shot.
  game._trackBall(0.016);
  game._trackBall(0.016);
  check('further frames on the same shot do not spend a second ball',
    game.balls === ballsBefore - 1, `balls=${game.balls}`);
}

// ------------------------------------------------------ weak launch (no-op)

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(0.3);
  const ballsBefore = game.balls;

  const ball = machine.ballBody;
  // Never made it past the divider, and has all but stopped rolling: this is
  // the "rolled back down the barrel" case, not a spent shot.
  ball.position.set(LANE.dividerX + 1, 2, LANE.loadZ - 1);
  ball.velocity.set(0, 0, 1);
  game._trackBall(1.2); // > the 1.0s grace period before a weak launch resolves

  check('a launch too weak to clear the barrel returns to AIMING without spending a ball',
    game.state === STATE.AIMING && game.balls === ballsBefore,
    `state=${game.state} balls=${game.balls}`);
  check('the same ball is reloaded for another try', machine.loadBallCalls >= 2, `loads=${machine.loadBallCalls}`);
}

// -------------------------------------------------------------------- scoring

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(8);
  const ball = machine.ballBody;

  const pocketIndex = 4; // centre pocket, multiplier x10 per HOLE_MULTIPLIERS
  const pos = pocketPosition(pocketIndex);
  ball.position.set(pos.x, pos.y, pos.z);
  ball.velocity.set(0, 0, 5);
  game._trackBall(0.016);

  const expectedMultiplier = HOLE_MULTIPLIERS[pocketIndex];
  check('ball landing in a pocket commits the shot',
    game.shotCommitted && game.balls === STARTING_BALLS - 1, `balls=${game.balls}`);
  check('score = baseScore * hole multiplier',
    game.score === game.baseScore * expectedMultiplier,
    `score=${game.score} expected=${game.baseScore * expectedMultiplier}`);
  check('hits counter increments on a scoring shot', game.hits === 1, `hits=${game.hits}`);
  check('pocket resolves into RESOLVING with a score result',
    game.state === STATE.RESOLVING && game.pendingResult?.type === 'score',
    `state=${game.state} result=${JSON.stringify(game.pendingResult)}`);
}

{
  // Every hole multiplier scores baseScore * that hole's own multiplier -- a
  // regression here would silently pay out the wrong number of points.
  for (let i = 0; i < HOLE_MULTIPLIERS.length; i += 1) {
    const { game, machine } = freshGame();
    armShot(game, 0);
    game.releasePlunger(8);
    const ball = machine.ballBody;
    const pos = pocketPosition(i);
    ball.position.set(pos.x, pos.y, pos.z);
    game._trackBall(0.016);
    const expected = game.baseScore * HOLE_MULTIPLIERS[i];
    check(`pocket ${i} (x${HOLE_MULTIPLIERS[i]}) pays out ${expected} points`,
      game.score === expected, `score=${game.score}`);
  }
}

// ------------------------------------------------- target-lane ball reward

{
  // The whole point of the LED roulette: landing in the lane it locked must
  // pay out bonus balls (one of TARGETS), on top of the multiplier score.
  // Before this fix `targetLane` was computed and lit but never consulted by
  // _scorePocket, so the roulette was purely cosmetic.
  const targetIndex = 2; // TARGETS[2] = 6
  const { game, machine } = freshGame();
  const lockedTarget = armShot(game, targetIndex);
  game.releasePlunger(8);
  const ballsBeforeHit = game.balls; // not yet committed -- releasePlunger alone does not spend a ball
  const ball = machine.ballBody;

  const pos = pocketPosition(targetIndex); // land in the exact locked lane
  ball.position.set(pos.x, pos.y, pos.z);
  ball.velocity.set(0, 0, 5);
  game._trackBall(0.016);

  check('landing in the locked target lane is recognised as a hit',
    game.pendingResult?.hitTarget === true, `pendingResult=${JSON.stringify(game.pendingResult)}`);
  check('hitting the target lane awards the locked reward in balls',
    game.balls === ballsBeforeHit - 1 + lockedTarget,
    `before=${ballsBeforeHit} lockedTarget=${lockedTarget} after=${game.balls}`);
  check('ballsWon tracks the reward', game.ballsWon === lockedTarget, `ballsWon=${game.ballsWon}`);
  check('targetHits increments on a target-lane hit', game.targetHits === 1, `targetHits=${game.targetHits}`);
  check('score is still paid independently of the target hit',
    game.score === game.baseScore * HOLE_MULTIPLIERS[targetIndex], `score=${game.score}`);
}

{
  // Landing in any lane OTHER than the locked one must not pay a ball reward
  // -- only the score layer applies, exactly like every other pocket.
  const targetIndex = 2; // TARGETS[2] = 6, locked lane = 2
  const missLane = 5; // a different physical pocket
  const { game, machine } = freshGame();
  armShot(game, targetIndex);
  game.releasePlunger(8);
  const ballsBeforeHit = game.balls;
  const ball = machine.ballBody;

  const pos = pocketPosition(missLane);
  ball.position.set(pos.x, pos.y, pos.z);
  ball.velocity.set(0, 0, 5);
  game._trackBall(0.016);

  check('landing outside the locked lane is not a target hit',
    game.pendingResult?.hitTarget === false, `pendingResult=${JSON.stringify(game.pendingResult)}`);
  check('a non-target pocket costs exactly the committed ball, no bonus',
    game.balls === ballsBeforeHit - 1, `before=${ballsBeforeHit} after=${game.balls}`);
  check('ballsWon stays zero without a target hit', game.ballsWon === 0, `ballsWon=${game.ballsWon}`);
  check('score is still paid for the non-target pocket',
    game.score === game.baseScore * HOLE_MULTIPLIERS[missLane], `score=${game.score}`);
}

// --------------------------------------------------------------- drain / timeout

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(8);
  const ball = machine.ballBody;
  ball.position.set(0, 2, 30);
  ball.velocity.set(0, 0, 20); // fast enough to skip every recovery guard

  let iterations = 0;
  while (game.state === STATE.IN_PLAY && iterations < 2000) {
    game._trackBall(0.05);
    iterations += 1;
  }

  check('a ball that never scores is force-finished by the overall timeout',
    game.state === STATE.RESOLVING && game.pendingResult?.type === 'drain',
    `state=${game.state} result=${JSON.stringify(game.pendingResult)} iters=${iterations}`);
}

// --------------------------------------------------------- stuck ball recovery

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(8);
  const ball = machine.ballBody;
  ball.position.set(0, 2, 20);
  ball.velocity.set(0, 0, 0); // dead stop: the classic "wedged between pegs" case

  let iterations = 0;
  // Each cycle: the ball sits still past BALL.stuckTimeout, gets relaunched by
  // the recovery guard, then (standing in for physics re-settling it) goes
  // back to rest so the guard can trigger again. After BALL.recoveryTries
  // is exhausted the shot must be force-finished -- a wedged ball can never
  // be allowed to hang the round forever.
  while (game.state === STATE.IN_PLAY && iterations < 500) {
    // Isolate the stuck-speed branch: keep ballTimer from tripping the
    // unrelated overall-timeout / teetering guards during this test.
    game.ballTimer = 0;
    game._trackBall(0.25);
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
    if (speed > BALL.stuckSpeed) ball.velocity.set(0, 0, 0);
    iterations += 1;
  }

  check('a permanently wedged ball is eventually force-finished, never hangs the round',
    game.state === STATE.RESOLVING, `state=${game.state} iters=${iterations} tries=${game.recoveryTries}`);
}

// ------------------------------------------------------------- NaN/Inf guard

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(8);
  const ball = machine.ballBody;
  ball.position.set(0, 2, 30);
  ball.velocity.set(0, 0, 20);
  game._trackBall(0.016); // commits the shot
  check('shot is committed before the corrupted-state frame', game.shotCommitted === true);

  ball.position.set(NaN, 2, 20);
  game._trackBall(0.016);
  check('a NaN ball position is recovered instead of crashing the round',
    isFinite(ball.position.x), `x=${ball.position.x}`);
  check('a corrupted committed shot resolves as a drain, not silently vanishing',
    game.state === STATE.RESOLVING && game.pendingResult?.type === 'drain',
    `state=${game.state} result=${JSON.stringify(game.pendingResult)}`);
}

// -------------------------------------------------------------- out of bounds

{
  const { game, machine } = freshGame();
  armShot(game, 0);
  game.releasePlunger(8);
  const ball = machine.ballBody;
  ball.position.set(0, 2, 30);
  ball.velocity.set(0, 0, 20);
  game._trackBall(0.016); // commits the shot

  ball.position.set(BOARD.width / 2 + BALL.outOfBoundsExtra + 5, 2, 30);
  game._trackBall(0.016);
  check('a ball that escapes the playfield walls is force-finished',
    game.state === STATE.RESOLVING, `state=${game.state} x=${ball.position.x}`);
}

// -------------------------------------------------------------- round / game over

{
  const { game, machine } = freshGame();
  game.setBatchSize(SHOT_BATCH_OPTIONS[0]); // smallest batch so the round ends quickly
  const totalBalls = game.balls;
  check('setBatchSize while READY is accepted', game.balls === SHOT_BATCH_OPTIONS[0], `balls=${game.balls}`);

  for (let shot = 0; shot < totalBalls; shot += 1) {
    armShot(game, 0);
    game.releasePlunger(8);
    const ball = machine.ballBody;
    ball.position.set(0, 2, 30);
    ball.velocity.set(0, 0, 20);
    game._trackBall(0.016); // commit + drain path keeps this deterministic
    // Force the resolve flash to elapse without a real clock.
    game._tickResolve(10);
  }

  check('the round ends in GAME_OVER once every ball has been used',
    game.state === STATE.GAME_OVER, `state=${game.state} balls=${game.balls}`);

  check('setBaseScore is rejected mid-round (only READY/GAME_OVER may change it)',
    (() => {
      const { game: g2 } = freshGame();
      g2.pressStart();
      return g2.setBaseScore(BASE_SCORE_OPTIONS[0]) === false && g2.baseScore !== BASE_SCORE_OPTIONS[0];
    })());

  const restarted = game.pressStart();
  check('pressStart from GAME_OVER resets the machine and starts a new round',
    restarted === true && game.state === STATE.SPINNING && game.balls === STARTING_BALLS,
    `restarted=${restarted} state=${game.state} balls=${game.balls}`);
}

process.exit(report());
