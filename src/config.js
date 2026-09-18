/**
 * Global tunables for the Taiwanese night-market pinball machine.
 *
 * Units: 1 world unit === 1 centimetre. This keeps the physics numbers in a
 * range where cannon-es is happy (spheres of radius ~0.9 and boxes of tens of
 * centimetres behave well with the default solver settings).
 *
 * The board is a real 3D slab that leans toward the player by TILT radians,
 * exactly like a real night-market machine whose glass tray is propped up.
 */

/** Playfield inner dimensions (cm). */
export const BOARD = {
  // The real B.B.MAN cabinet is 35.5 × 64 cm. The small allowance here is
  // for the launch rail inside the right edge of the playfield.
  width: 36,
  height: 58,
  /** Physical thickness of the wooden/plastic base plate. */
  baseThickness: 2.2,
  /** Height of the rails that fence the ball in. */
  wallHeight: 3.0,
  /** Rail thickness. Must exceed one substep of travel at max speed. */
  wallThickness: 1.2,
};

/** How far the playfield is tilted back (radians). ~8.6 degrees. */
export const TILT = 0.15;

/** Gravity magnitude in cm/s^2 when the board is flat. */
export const GRAVITY = 981;

/** Ball geometry + material. */
export const BALL = {
  radius: 0.62,
  mass: 1.1,
  /** Rolling friction against the board surface. */
  friction: 0.16,
  /** How bouncy the ball is off rails/pegs. */
  restitution: 0.42,
  linearDamping: 0.06,
  angularDamping: 0.22,
  /** Hard ceiling to guarantee we can never tunnel through a rail. */
  maxSpeed: 430,
  /** A ball slower than this for this many seconds is considered stuck. */
  stuckSpeed: 6,
  stuckTime: 3.0,
};

/** Physics stepping. */
export const PHYSICS = {
  fixedStep: 1 / 240,
  maxSubSteps: 24,
  solverIterations: 18,
  solverTolerance: 0.0015,
};

/**
 * Vertical launch / scoring pockets at the bottom of the board.
 * `x` is the centre of the pocket along the board width.
 * Values match the LED targets: 2 / 4 / 6 / 8 / 10.
 *
 * The physical slots on the board are NOT laid out symmetrically so that the
 * same awkward geometry as the real machine is preserved, and so that a
 * straight drop cannot accidentally look like a scripted path.
 */
export const BASE_SCORE_OPTIONS = [10, 20, 50, 100];
export const SHOT_BATCH_OPTIONS = [5, 10, 20];
export const HOLE_MULTIPLIERS = [1, 2, 3, 5, 10, 5, 3, 2, 1];

/** Twelve narrow scoring lanes across the player-side edge of the real tray. */
export const POCKETS = Array.from({ length: HOLE_MULTIPLIERS.length }, (_, index) => ({
  value: index + 1,
  lane: index,
  x: -12.0 + index * 3.0,
  multiplier: HOLE_MULTIPLIERS[index],
  caught: false,
}));

/** Pocket entrance geometry. */
export const POCKET = {
  width: 2.72,
  depth: 11.5,
  dividerThickness: 0.34,
  /** Height of the pocket dividers, measured from the board floor. */
  dividerHeight: 2.8,
};

/** The 2 and 10 pockets sit under a small arch so pachinko-style sitters can drain out. */
export const POCKET_ARCH = {
  /** Side pockets that get an arch above them. */
  values: [],
  /** Clearance from the board floor to the underside of the arch. */
  clearance: 5.2,
  /** Length of the arch along z. */
  length: 7.0,
};

/** Number of balls the player starts with. */
export const STARTING_BALLS = 10;


/** Valid LED targets. */
export const TARGETS = [2, 4, 6, 8, 10];

/** Launcher (plunger) behaviour. */
export const PLUNGER = {
  /** Rest position of the knob along z (relative to the plunger bracket).
   *  Pulling ADDS to this: the knob follows the pointer toward the player,
   *  then snaps inward on release. */
  restZ: 4.0,
  /** Maximum outward pull travel (cm). */
  maxPull: 9.0,
  /** Launch speed at zero pull. Weak attempts roll back to the same plunger. */
  minSpeed: 36,
  /** Launch speed at full pull. */
  maxSpeed: 390,
  /** How fast the knob springs back when released (cm/s in pull-space). */
  releaseSpeed: 95,
};

/**
 * The launch lane structure on the right-hand edge of the tray.
 *
 * This mirrors a real B.B.MAN machine: a narrow vertical channel with a
 * one-way gate. The plunger sits at the BOTTOM of the channel; the player pulls
 * it back and releases, firing the ball UP the channel and over the top of the
 * divider, where it drops into the pin field.
 *
 * Layout (board width 62, so x runs -31..+31):
 *
 *   x = 26.2  divider between the playfield and the launch channel
 *   x = 28.4  centre of the launch channel
 *   x = 30.4  the tray's right rail
 *
 * The channel's floor sits slightly proud of the playfield so a ball that rolls
 * back down never drifts sideways into the pocket comb.
 */
export const LANE = {
  /** x of the divider that separates the playfield from the launch channel. */
  dividerX: 14.2,
  /** Centre line of the channel the ball is launched up. */
  channelX: 16.1,
  /** Top of the divider -- the ball rolls over this into the playfield. */
  dividerTop: 49.0,
  /** Where the ball rests, waiting for the plunger. */
  loadZ: 53.0,
  /** Width of the return lane left of the divider. */
  returnWidth: 2.8,
  /** Height of the channel floor above the playfield floor. */
  channelLift: 1.4,
};

/**
 * The physical stand the machine sits on.
 *
 * The machine group is tilted about the world X axis, so its underside is a
 * real sloped surface: the legs are world-space boxes that reach from the
 * ground up to that slope, exactly like a real night-market machine propped
 * on a wooden frame.
 */
export const STAND = {
  /** World Y of the machine group origin (the tray floor centre). */
  tableY: 43,
  /** Local Y of the cabinet underside (see geometry.js cabinet extrude). */
  cabinetBottom: -7.8,
  /** Local z of the back / front leg pair, measured along the tray. */
  legZ: [4.5, 55.0],
  /** Leg cross-section (cm). */
  legWidth: 2.8,
  legDepth: 4.0,
  /** Square ground plane size (cm). */
  groundSize: 640,
};

/** Camera framing (world space, before the shake offset is applied). */
export const CAMERA = {
  fov: 42,
  near: 1,
  far: 1200,
  // The machine now really leans above a ground plane, so the default view is
  // a 3/4 hero angle from slightly above player eye height: enough floor is
  // visible for the eye to anchor the machine in space.
  // A higher, closer playing angle keeps the entire pin field readable while
  // still showing enough cabinet depth to feel like a physical machine.
  position: [28, 105, 126],
  target: [0, 42, 27],
  shakeDecay: 7.5,
  shakeScale: 0.05,
};

/** Night-market palette. Bright, plasticky, a bit cheap-looking on purpose. */
export const PALETTE = {
  bodyYellow: 0xf5c518,
  bodyYellowDark: 0xd79c0c,
  trimRed: 0xe23b3b,
  trimOrange: 0xf27c1c,
  trimGreen: 0x35b64a,
  trimBlue: 0x2b7fd4,
  trimPurple: 0x8b4fbf,
  trimPink: 0xf06fa8,
  playfield: 0xf3ead6,
  playfieldEdge: 0xd8ccb0,
  peg: 0xc9a227,
  pegCap: 0xe8dc9a,
  rail: 0xbfc6cc,
  bumperRed: 0xe33d3d,
  bumperBlue: 0x2f7fd0,
  glass: 0xbfe8ff,
  pocketRed: 0xe0483f,
  pocketPink: 0xef7fa6,
  ledOff: 0x3a2a22,
  ledOn: 0xff2b2b,
  metal: 0x9aa3ab,
  knob: 0xd83a3a,
  wood: 0x8a5a33,
  woodDark: 0x6e4525,
  ground: 0x2a2220,
  bulbWarm: 0xffd9a0,
  crate: 0x9a7448,
};

/** Per-shot physics jitter so two identical launches never give one result. */
export const JITTER = {
  /** +/- ratio applied to the launch speed. */
  speed: 0.035,
  /** +/- ratio applied to the launch direction in x. */
  angle: 0.02,
  /** +/- ratio applied to the ball spin. */
  spin: 0.25,
  /** Restitution is nudged by this much on every peg hit. */
  restitutionPerHit: 0.03,
};
