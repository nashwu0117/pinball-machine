/**
 * The 3D machine: geometry + physics bodies for the cabinet, the tilted glass
 * tray, the pin field, the bottom slots, the launch lane and the plunger.
 *
 * Geometry and physics are built together so a peg always sits exactly where its
 * collider is. Everything is authored in playfield-local coordinates (origin at
 * the centre of the tray floor, +z toward the player) and the whole assembly is
 * parented to one `group` that carries the TILT rotation.
 */

import * as THREE from 'three';
import {
  BOARD, TILT, POCKETS, POCKET, LANE, PLUNGER, BALL, JITTER, PALETTE, STAND,
} from './config.js';
import { CANNON, MATERIALS, createWorld, tiltedGravity, clampSpeed } from './physics.js';
import { FIELD, pocketFloorZ } from './layout.js';
import {
  CabinetMethods, TrayMethods, PegMethods, BumperMethods, DeflectorMethods,
  PocketMethods, LaneMethods, PlungerMethods, HousingMethods, ButtonMethods,
  StandMethods,
} from './geometry.js';

export class PinballMachine {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.world = createWorld();
    this.world.gravity.copy(tiltedGravity(TILT));

    /** Root transform. The physics world stays authored flat (tilted gravity
        fakes the slope, so gameplay/tests never change), while the visual
        machine really leans by TILT above its metal rack — syncBall() maps
        the ball between the two frames. */
    this.group = new THREE.Group();
    // +TILT about X lowers the player-side (+z) edge, matching tiltedGravity
    // which pulls the ball toward +z: the visual slope and the physics agree.
    this.group.rotation.x = TILT;
    this.group.position.y = STAND.tableY;
    scene.add(this.group);
    /** Board orientation as a quaternion, for ball mesh transforms. */
    this._boardQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), TILT,
    );
    this.group.updateMatrixWorld(true);

    /** Pegs / bumpers that gameplay code wants to inspect. */
    this.pegs = [];
    this.pegBodies = [];
    this.bumperBodies = [];
    this.bumperMeshes = [];
    this.pocketZones = [];
    this.ledMeshes = new Map();

    this.pocketFloorZ = pocketFloorZ();
    this._disposables = [];

    this._buildCabinet();
    this._buildTray();
    this._buildPegs();
    this._buildBumpers();
    this._buildDeflectors();
    this._buildPockets();
    this._buildLane();
    this._buildPlunger();
    this._buildHousing();
    this._buildStand();

    this._buildBall();
    this._wireCollisionCallbacks();
  }
}

export const BallMethods = {
  /** Create the single dynamic ball body. It is reused for every shot. */
  _buildBall() {
    const geo = new THREE.SphereGeometry(BALL.radius, 24, 18);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8eef4,
      roughness: 0.08,
      metalness: 0.98,
      envMapIntensity: 1.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    // The ball lives outside `group` so syncBall controls its world transform.
    mesh.visible = false;
    this.scene.add(mesh);
    /** Scratch quaternion for syncBall. */
    this._ballQuat = new THREE.Quaternion();

    const body = new CANNON.Body({
      mass: BALL.mass,
      shape: new CANNON.Sphere(BALL.radius),
      material: MATERIALS.ball,
      linearDamping: BALL.linearDamping,
      angularDamping: BALL.angularDamping,
      // A sleeping ball would silently freeze mid-board, so sleeping is off.
      allowSleep: false,
      collisionFilterGroup: 1,
      collisionFilterMask: -1,
    });
    this.world.addBody(body);

    this.ballMesh = mesh;
    this.ballBody = body;
    this.ballActive = false;
    this._disposables.push(geo, mat);
  },

  /**
   * Place the ball in the barrel, ready to be launched.
   * This only sets the starting pose -- nothing about the ball's motion after
   * this point is scripted.
   */
  loadBall() {
    const body = this.ballBody;
    body.wakeUp();
    body.position.set(this.barrelX, BALL.radius + 1.1, LANE.loadZ + 2.0);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.quaternion.set(0, 0, 0, 1);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
    this.ballActive = true;
    this.ballMesh.visible = true;
    this.syncBall();
  },

  /**
   * Launch the ball up the barrel.
   *
   * The player controls how far the plunger was pulled outward. Speed is
   * `minSpeed + pull * (maxSpeed - minSpeed)` plus a small relative error, and
   * the heading gets a tiny random deviation too. Everything after that is the
   * physics solver's business.
   *
   * @param {number} pull outward pull distance in cm (0..PLUNGER.maxPull)
   * @returns {number} the speed actually applied (cm/s)
   */
  launchBall(pull) {
    const t = Math.max(0, Math.min(1, pull / PLUNGER.maxPull));
    // Once the player has made a deliberate pull, give the ball enough
    // momentum to clear the launch-lane guide. Only an almost-zero tap keeps
    // the genuinely weak-launch/return-to-plunger behaviour.
    const launchT = t > 0.09 ? Math.max(t, 0.48) : t;
    const base = PLUNGER.minSpeed + launchT * (PLUNGER.maxSpeed - PLUNGER.minSpeed);
    const speed = base * (1 + (Math.random() * 2 - 1) * JITTER.speed);

    const body = this.ballBody;
    body.wakeUp();
    body.velocity.set((Math.random() * 2 - 1) * JITTER.angle * speed, 0, -speed);
    // A little sidespin, also randomised. This shows up as visible curl off the
    // pins because the ball is a real rolling sphere.
    body.angularVelocity.set(
      (Math.random() * 2 - 1) * JITTER.spin * 40,
      0,
      (Math.random() * 2 - 1) * JITTER.spin * 22,
    );
    return speed;
  },

  /**
   * Copy the physics body's transform onto the mesh.
   *
   * Physics is authored in playfield-local space (flat board, slope faked by
   * tilted gravity) but the visual group really leans by TILT, so the mesh
   * position goes through the group's world matrix and the spin quaternion is
   * pre-multiplied by the board rotation. Rolling then looks correct on the
   * sloped board instead of spinning around a horizontal axis.
   */
  syncBall() {
    const b = this.ballBody;
    this.ballMesh.position.copy(b.position).applyMatrix4(this.group.matrixWorld);
    this._ballQuat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    this.ballMesh.quaternion.copy(this._ballQuat).premultiply(this._boardQuat);
  },

  /**
   * Hook the contact events gameplay cares about: pin ticks (sound + camera
   * shake) and bumper kicks.
   *
   * Both handlers add a small random nudge to the ball's velocity. That is the
   * stand-in for the dents, dust and slightly bent pins of a real machine, and
   * it is what stops a board with identical geometry from ever replaying the
   * same shot twice.
   */
  _wireCollisionCallbacks() {
    /** Assigned by game.js. @type {((speed:number)=>void)|null} */
    this.onPegHit = null;
    /** Assigned by game.js. @type {((index:number, speed:number)=>void)|null} */
    this.onBumperHit = null;

    const ball = this.ballBody;

    for (const peg of this.pegBodies) {
      peg.addEventListener('collide', (event) => {
        if (event.body !== ball) return;
        const speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
        if (speed < 3) return;
        ball.velocity.x += (Math.random() * 2 - 1) * JITTER.restitutionPerHit * speed * 0.16;
        ball.velocity.y += (Math.random() * 2 - 1) * JITTER.restitutionPerHit * speed * 0.06;
        this.onPegHit?.(speed);
      });
    }

    for (const bumper of this.bumperBodies) {
      bumper.addEventListener('collide', (event) => {
        if (event.body !== ball) return;
        const dx = ball.position.x - bumper.position.x;
        const dz = ball.position.z - bumper.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const kick = bumper.userData.kick;
        ball.velocity.x += (dx / len) * kick;
        ball.velocity.z += (dz / len) * kick;
        ball.velocity.y += kick * 0.18;
        clampSpeed(ball, BALL.maxSpeed);
        this.onBumperHit?.(bumper.userData.index, Math.hypot(ball.velocity.x, ball.velocity.z));
      });
    }
  },
};

Object.assign(PinballMachine.prototype, BallMethods);

export const DisplayMethods = {
  /**
   * Advance the machine's presentation to match the physics.
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.ballActive) {
      // Belt-and-braces speed clamp. The fixed timestep already prevents
      // tunnelling; this additionally keeps a bumper kick from punching the
      // ball through the ceiling collider.
      clampSpeed(this.ballBody, BALL.maxSpeed);
      this._guardBallInsideWalls();
      this.syncBall();
    }
    this.ballMesh.visible = this.ballActive;

    // Ease the start button between its up and pressed positions.
    if (this.startButtonMesh) {
      const pressed = this.startButtonHomeY - 0.5;
      const goal = this.buttonPressed ? pressed : this.startButtonHomeY;
      this.startButtonMesh.position.y += (goal - this.startButtonMesh.position.y) * Math.min(1, dt * 20);
    }

    // Fade bumper posts back to their resting glow after a hit.
    for (const entry of this.bumperMeshes) {
      const mat = entry.material;
      const base = entry.userData.baseGlow ?? 0.16;
      if (mat.emissiveIntensity > base) {
        mat.emissiveIntensity = Math.max(base, mat.emissiveIntensity - dt * 5.5);
        if (mat.emissiveIntensity <= base) mat.emissive.setHex(entry.userData.baseEmissive);
      }
    }

    // Blink the target LEDs while the roulette is spinning.
    if (this.ledBlink) {
      this.ledBlink.elapsed += dt;
      const index = Math.floor(this.ledBlink.elapsed / this.ledBlink.interval)
        % this.ledBlink.values.length;
      this.ledBlink.values.forEach((value, i) => this.setLed(value, i === index));
    }
  },

  /**
   * Last-resort wall guard for the rare case where a high-speed contact leaves
   * the solver with a sub-step of penetration. The rail's inner face is one
   * wall thickness inside the cabinet; keep the whole sphere on that side and
   * reflect only the velocity component pointing farther into the wall.
   */
  _guardBallInsideWalls() {
    const body = this.ballBody;
    const xLimit = BOARD.width / 2 - BOARD.wallThickness - BALL.radius;
    const zMin = BOARD.wallThickness + BALL.radius;
    const zMax = BOARD.height - BOARD.wallThickness - BALL.radius;
    let corrected = false;

    if (body.position.x < -xLimit) {
      body.position.x = -xLimit;
      if (body.velocity.x < 0) body.velocity.x = Math.abs(body.velocity.x) * 0.42;
      corrected = true;
    } else if (body.position.x > xLimit) {
      body.position.x = xLimit;
      if (body.velocity.x > 0) body.velocity.x = -Math.abs(body.velocity.x) * 0.42;
      corrected = true;
    }
    if (body.position.z < zMin) {
      body.position.z = zMin;
      if (body.velocity.z < 0) body.velocity.z = Math.abs(body.velocity.z) * 0.42;
      corrected = true;
    } else if (body.position.z > zMax) {
      body.position.z = zMax;
      if (body.velocity.z > 0) body.velocity.z = -Math.abs(body.velocity.z) * 0.42;
      corrected = true;
    }
    if (corrected) body.wakeUp();
  },

  /** Flash a bumper post white-hot for a moment when it is struck. */
  flashBumper(index) {
    const entry = this.bumperMeshes[index];
    if (!entry) return;
    entry.material.emissive.setHex(0xffffff);
    entry.material.emissiveIntensity = 3.0;
  },

  /** Turn one target LED on or off. */
  setLed(value, on) {
    const mesh = this.ledMeshes.get(value);
    if (!mesh) return;
    mesh.material.color.setHex(on ? PALETTE.ledOn : PALETTE.ledOff);
    mesh.material.emissive.setHex(on ? PALETTE.ledOn : 0x000000);
    mesh.material.emissiveIntensity = on ? 2.0 : 0;
  },

  /** Start the LED roulette over every possible target. */
  startLedBlink(values, interval = 0.075) {
    this.ledBlink = { values, interval, elapsed: 0 };
  },

  /** Stop the roulette and light exactly one target. */
  stopLedBlink(winner) {
    this.ledBlink = null;
    for (const [value] of this.ledMeshes) this.setLed(value, value === winner);
  },

  /** Clear every target LED. */
  clearLeds() {
    this.ledBlink = null;
    for (const [value] of this.ledMeshes) this.setLed(value, false);
  },

  /** Turn one of the twelve playfield lane lamps on or off. */
  setPocketHighlight(lane, on) {
    const mesh = this.laneLedMeshes?.[lane];
    if (!mesh) return;
    mesh.material.color.setHex(on ? PALETTE.ledOn : PALETTE.ledOff);
    mesh.material.emissive.setHex(on ? PALETTE.ledOn : 0x000000);
    mesh.material.emissiveIntensity = on ? 2.8 : 0;
  },

  setLaneTarget(lane) {
    for (let i = 0; i < (this.laneLedMeshes?.length ?? 0); i++) {
      this.setPocketHighlight(i, i === lane);
    }
  },

  clearLaneLeds() {
    for (let i = 0; i < (this.laneLedMeshes?.length ?? 0); i++) {
      this.setPocketHighlight(i, false);
    }
  },

  /** Refresh the in-cabinet LED readout. */
  setReadout(balls, target) {
    this._paintScoreReadout(balls, target);
  },

  /** Free GPU resources. */
  dispose() {
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
  },
};

Object.assign(PinballMachine.prototype, DisplayMethods);

// Attach the geometry builders. Keeping them in separate modules makes each
// block readable; at runtime they are all part of the one class.
Object.assign(
  PinballMachine.prototype,
  CabinetMethods, TrayMethods, PegMethods, BumperMethods, DeflectorMethods,
  PocketMethods, LaneMethods, PlungerMethods, HousingMethods, ButtonMethods,
  StandMethods,
);

export { THREE, CANNON, PALETTE, FIELD, BOARD, POCKETS, POCKET, LANE, PLUNGER };
