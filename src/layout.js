/**
 * Playfield furniture layout.
 *
 * The night-market machines this game is modelled on are *packed* with tiny
 * brass pins, and the pins are never laid out on a clean grid. They cluster
 * where the operator hammered them in, leaving wide chimneys and tight thickets
 * side by side. That irregularity is what produces the
 * "peg -> left -> peg -> right -> peg -> drop" motion the game needs.
 *
 * To get that look without hand-placing 200 pins we generate them from a
 * deterministic seeded PRNG (so the machine looks identical on every reload,
 * like a real physical board) and then apply a few hand-written clusters that
 * deliberately create the choke points of the machine.
 *
 * Coordinates are playfield-local:
 *   x: -BOARD.width/2 .. +BOARD.width/2   (left .. right, player's view)
 *   z:  0 .. BOARD.height                 (top/back .. bottom/front)
 *   y:  height above the board floor
 */

import { BOARD, POCKETS, POCKET, LANE } from './config.js';

/** Mulberry32 -- tiny deterministic PRNG. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The boundaries of the open playfield (right of maxX is the launch channel). */
export const FIELD = {
  minX: -BOARD.width / 2 + BOARD.wallThickness + 1.0,
  maxX: LANE.dividerX - 1.0,
  minZ: 4.0,
  /** z where the scoring pocket mouths begin. */
  pocketMouthZ: BOARD.height - POCKET.depth - 1.2,
};

/**
 * @typedef {{x:number, z:number, radius:number}} Pin
 */

/** Clearance helpers: keep pins away from walls that would form V-traps. */
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const WALL_SEGS = [
  ...buildDeflectors().map((d) => {
    const dx = Math.sin(d.angle) * d.l / 2;
    const dz = Math.cos(d.angle) * d.l / 2;
    return [d.x - dx, d.z - dz, d.x + dx, d.z + dz];
  }),
  [18.0, 8.0, 14.4, 2.5],
  [11.0 - Math.sin(-0.5) * 3.2, 50.2 - Math.cos(-0.5) * 3.2,
   11.0 + Math.sin(-0.5) * 3.2, 50.2 + Math.cos(-0.5) * 3.2],
];

function nearWall(x, z) {
  for (const [ax, az, bx, bz] of WALL_SEGS) {
    if (distToSeg(x, z, ax, az, bx, bz) < 2.6) return true;
  }
  for (const b of buildBumpers()) {
    if (Math.hypot(x - b.x, z - b.z) < b.radius + 2.2) return true;
  }
  if (Math.hypot(x - LANE.dividerX, z - 12.0) < 2.8) return true;
  if (x > LANE.dividerX - 1.2 && z > 8) return true;
  return false;
}

/**
 * Build the full peg list for the board.
 * @returns {Pin[]}
 */
export function buildPegs() {
  /** @type {Pin[]} */
  const pins = [];
  const random = mulberry32(0x5eed1a7);

  const spanZ = FIELD.pocketMouthZ - FIELD.minZ;

  // The B.B.MAN board uses a tight, shallow brick pattern of small chrome pins
  // rather than the oversized pachinko forest used by the previous mock-up.
  const PITCH_X = 2.45;
  const PITCH_Z = 2.65;
  let r = 0;
  for (let z = FIELD.minZ + 0.5; z <= FIELD.pocketMouthZ - 1.5; z += PITCH_Z, r++) {
    const t = (z - FIELD.minZ) / spanZ;
    const brick = (r % 2) * (PITCH_X / 2);
    // Printed characters occupy open patches on the real artwork.
    const skip = 0.34 + 0.08 * Math.sin(t * Math.PI);

    for (let x = FIELD.minX + 1.1 + brick; x <= FIELD.maxX; x += PITCH_X) {
      const jx = x + (random() - 0.5) * 0.34;
      const jz = z + (random() - 0.5) * 0.34;

      if (random() < skip) continue;
      if (jx < FIELD.minX || jx > FIELD.maxX) continue;
      if (jz > FIELD.pocketMouthZ - 0.8) continue;

      if (nearWall(jx, jz)) continue;

      pins.push({ x: jx, z: jz, radius: 0.34 });
    }
  }

  // Hand-placed pins recreate the denser shoulders around the top guides and
  // the row immediately above the scoring lanes.
  const thicket = [
    [-11.5, 8.0], [-8.0, 6.8], [-4.5, 8.2], [-1.0, 6.9], [2.5, 8.1], [6.0, 6.8], [9.6, 8.4],
    [-12.0, 39.5], [-9.5, 40.6], [-7.0, 39.5], [-4.5, 40.6], [-2.0, 39.5],
    [0.5, 40.6], [3.0, 39.5], [5.5, 40.6], [8.0, 39.5], [10.5, 40.6],
  ];
  for (const [x, z] of thicket) {
    if (nearWall(x, z)) continue;
    pins.push({ x, z, radius: 0.34 });
  }

  // Side-wall pins stop the ball from simply riding a rail to one end lane.
  for (let i = 0; i < 4; i++) {
    const z = 12 + i * 7;
    const gl = FIELD.minX + 0.8;
    const gr = FIELD.maxX - 0.8;
    if (!nearWall(gl, z)) pins.push({ x: gl, z: z + (random() - 0.5), radius: 0.32 });
    if (!nearWall(gr, z + 2)) pins.push({ x: gr, z: z + 2 + (random() - 0.5), radius: 0.32 });
  }

  // --- 3. De-duplicate ----------------------------------------------------------
  // Keep every gap wider than the ball so no pair can funnel-trap it.
  const kept = [];
  const MIN_GAP = 1.95;
  for (const p of pins) {
    let ok = true;
    for (const q of kept) {
      const dx = p.x - q.x;
      const dz = p.z - q.z;
      if (dx * dx + dz * dz < MIN_GAP * MIN_GAP) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(p);
  }
  kept.sort((a, b) => a.z - b.z);
  return kept;
}

/**
 * Static bumper posts -- the few larger springy posts that fling the ball.
 * `kick` is the extra impulse (cm/s) added when the ball hits one.
 * @returns {{x:number, z:number, radius:number, kick:number}[]}
 */
export function buildBumpers() {
  return [
    { x: -10.8, z: 12.0, radius: 0.72, kick: 24 },
    { x: -4.0, z: 10.2, radius: 0.72, kick: 24 },
    { x: 3.2, z: 12.2, radius: 0.72, kick: 24 },
    { x: 9.2, z: 15.0, radius: 0.72, kick: 24 },
    { x: -8.0, z: 25.5, radius: 0.72, kick: 26 },
    { x: 0.2, z: 22.8, radius: 0.72, kick: 26 },
    { x: 7.8, z: 27.0, radius: 0.72, kick: 26 },
  ];
}

/**
 * Angular deflector plates (static boxes). These are the `導流結構` of the
 * machine: short walls that peel balls off the rails, plus V shapes that split
 * a fast ball into one of two very different futures.
 *
 * @returns {{x:number, z:number, w:number, l:number, angle:number}[]}
 */
export function buildDeflectors() {
  const h = BOARD.wallHeight * 0.95;
  return [
    // Curved plastic shoulders are approximated by short guides; the rest of
    // the real board is pins and open printed artwork.
    { x: -11.2, z: 6.2, w: 0.55, l: 7.0, angle: -0.72 },
    { x: 10.3, z: 7.0, w: 0.55, l: 7.0, angle: 0.72 },
    { x: -12.4, z: 33.0, w: 0.5, l: 5.2, angle: -0.38 },
    { x: 11.2, z: 34.0, w: 0.5, l: 5.2, angle: 0.38 },
  ].map((d) => ({ ...d, h }));
}

/**
 * Pocket divider walls: the tall thin fingers that separate the twelve scoring
 * slots, closing the comb so a ball cannot sneak between two pockets.
 *
 * @returns {{x:number, z:number, w:number, l:number}[]}
 */
export function buildPocketDividers() {
  const z = BOARD.height - POCKET.depth / 2 - 1.0;
  const l = POCKET.depth;
  const w = POCKET.dividerThickness;
  const out = [];

  for (const pocket of POCKETS) {
    out.push({ x: pocket.x - POCKET.width / 2 - w / 2, z, w, l });
    out.push({ x: pocket.x + POCKET.width / 2 + w / 2, z, w, l });
  }

  return out;
}

/** Where the floor of the bottom slots sits along z. */
export function pocketFloorZ() {
  return BOARD.height - 2.0;
}

/** Notional centre for a pocket, used by sensors and LEDs. */
export function pocketCenter(pocket) {
  return { x: pocket.x, z: BOARD.height - POCKET.depth / 2 - 1.0 };
}

export { mulberry32 };
