/**
 * cannon-es world setup.
 *
 * Everything interesting about the simulation lives in the contact materials.
 * The ball needs to feel heavy and lively (it should snap off a peg and keep
 * rolling) while still damping out inside the bottom pockets so it does not
 * spend ten seconds rattling around before the game can score it.
 */

import * as CANNON from 'cannon-es';
import { BALL, GRAVITY, PHYSICS } from './config.js';

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
  return new CANNON.Vec3(0, -GRAVITY * Math.cos(tilt), GRAVITY * Math.sin(tilt));
}

/**
 * Reset any dynamic body that has drifted into NaN/Inf before the solver sees
 * it. Cheap (the world is mostly static bodies) and it keeps one bad contact
 * from poisoning the whole simulation.
 *
 * @param {CANNON.World} world
 */
export function sanitizeBodies(world) {
  for (const body of world.bodies) {
    if (body.mass <= 0) continue;
    if (
      !isFinite(body.position.x) || !isFinite(body.position.y) || !isFinite(body.position.z) ||
      !isFinite(body.velocity.x) || !isFinite(body.velocity.y) || !isFinite(body.velocity.z)
    ) {
      body.position.set(0, 2, 0);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
    }
  }
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
    // Guard against NaN/Inf in speed calculation
    const speed = Math.sqrt(Math.max(0, speedSq));
    const scale = max / speed;
    v.scale(scale, v);
  }
}

export { CANNON };
