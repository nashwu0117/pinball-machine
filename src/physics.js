/**
 * cannon-es world setup.
 *
 * Everything interesting about the simulation lives in the contact materials.
 * The ball needs to feel heavy and lively (it should snap off a peg and keep
 * rolling) while still damping out inside the bottom pockets so it does not
 * spend ten seconds rattling around before the game can score it.
 */

import * as CANNON from 'cannon-es';
import { BALL, BOARD, PHYSICS } from './config.js';

export const MATERIALS = {};

/**
 * Create a fresh physics world. Called once per game; `reset()` reuses it.
 * @returns {CANNON.World}
 */
export function createWorld() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0), // gravity is applied along the tilted plane instead
    allowSleep: true,
  });

  world.broadphase = new CANNON.SAPBroadphase(world);
  // NaiveBroadphase is O(n^2); with ~200 pegs the SAP sweep is noticeably cheaper
  // and lets us keep a 240 Hz fixed step on a laptop.

  world.solver.iterations = PHYSICS.solverIterations;
  world.solver.tolerance = PHYSICS.solverTolerance;

  // Normalising every step is cheap here (only a handful of dynamic bodies) and
  // stops the ball's quaternion from drifting after thousands of contacts.
  world.quatNormalizeSkip = 0;
  world.quatNormalizeFast = false;

  world.addEventListener('postStep', () => {
    for (const body of world.bodies) {
      if (body.mass > 0 && body.velocity.lengthSquared() > BALL.maxSpeed * BALL.maxSpeed) {
        body.velocity.scale(BALL.maxSpeed / body.velocity.length(), body.velocity);
      }
    }
  });

  const floor = new CANNON.Material('floor');
  const wall = new CANNON.Material('wall');
  const peg = new CANNON.Material('peg');
  const ball = new CANNON.Material('ball');
  const bumper = new CANNON.Material('bumper');
  const catchMat = new CANNON.Material('catch');

  MATERIALS.floor = floor;
  MATERIALS.wall = wall;
  MATERIALS.peg = peg;
  MATERIALS.ball = ball;
  MATERIALS.bumper = bumper;
  MATERIALS.catch = catchMat;

  world.defaultContactMaterial.friction = 0.2;
  world.defaultContactMaterial.restitution = 0.1;

  const contacts = [
    // The ball rolling on the board. Low restitution keeps it from pinging off
    // the floor, moderate friction gives it topspin so it accelerates downhill.
    [ball, floor, { friction: BALL.friction, restitution: 0.08, contactEquationStiffness: 1e8, contactEquationRelaxation: 3 }],

    // Rails: springy enough to bounce the ball back into play, never dead.
    [ball, wall, { friction: 0.06, restitution: 0.36 }],

    // Pegs are the heart of the machine. High restitution + zero friction so
    // the exit angle depends on where it struck, not on surface drag.
    [ball, peg, { friction: 0.0, restitution: 0.62 }],

    // Pocket dividers absorb energy so a caught ball settles instead of
    // hopping back out over the divider.
    [ball, catchMat, { friction: 0.35, restitution: 0.05 }],

    // Live bumpers kick back hard.
    [ball, bumper, { friction: 0.0, restitution: 0.95 }],

    // Static bodies never touch each other, but providing the pairs keeps
    // cannon-es from falling back to defaultContactMaterial for edge cases.
    [wall, floor, { friction: 0.4, restitution: 0.0 }],
  ];

  for (const [a, b, opts] of contacts) {
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, opts));
  }

  return world;
}

/**
 * Build the gravity vector for a board tilted back by `tilt` radians.
 *
 * The playfield is rotated about the world X axis, so "down the slope" is a
 * combination of -Y (into the board) and +Z (toward the player).
 *
 * @param {number} tilt
 * @returns {CANNON.Vec3}
 */
export function tiltedGravity(tilt) {
  const g = BALL.mass ? 981 : 981;
  return new CANNON.Vec3(0, -g * Math.cos(tilt), g * Math.sin(tilt));
}

/**
 * The `step()` wrapper. We always use a fixed timestep with a bounded number of
 * substeps; this is what stops a fast ball from tunnelling through a peg when
 * the browser drops a frame (a 305 cm/s ball moves only 1.3 cm per substep).
 *
 * @param {CANNON.World} world
 * @param {number} frameDelta seconds since last frame
 */
export function stepWorld(world, frameDelta) {
  // Clamp the incoming delta: a tab that was backgrounded for 4 seconds must
  // not push the ball through the machine in one go.
  const dt = Math.min(frameDelta, 0.05);
  world.step(PHYSICS.fixedStep, dt, PHYSICS.maxSubSteps);
}

/**
 * Clamp a dynamic body's linear velocity.
 * @param {CANNON.Body} body
 * @param {number} max
 */
export function clampSpeed(body, max) {
  const v = body.velocity;
  const speedSq = v.lengthSquared();
  if (speedSq > max * max) {
    const scale = max / Math.sqrt(speedSq);
    v.scale(scale, v);
  }
}

export { CANNON };

/** Convenience re-export so modules do not each import three + cannon. */
export const V = {
  /** Convert a cannon Vec3 to a plain object (debugging). */
  dump: (v) => ({ x: v.x, y: v.y, z: v.z }),
};

export const BOARD_LIMITS = {
  /** Half-width of the playable floor. */
  halfWidth: BOARD.width / 2,
  /** Half-height (along z) of the playable floor. */
  halfHeight: BOARD.height / 2,
};
