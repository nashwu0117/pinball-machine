/**
 * Free orbit camera.
 *
 * The default framing is still the fixed arcade view, but being able to look
 * around the machine is what makes it read as truly 3D. Dragging on empty
 * canvas orbits, the wheel dollies, and everything eases smoothly toward the
 * goal angles so the motion never feels snappy.
 *
 * Sign conventions match three.js OrbitControls: drag right/left spins the
 * camera around the machine, drag down/up raises/lowers it. controls.js does
 * the raycasting first, so grabbing the plunger or the start button never
 * rotates the view.
 */

import * as THREE from 'three';
import { CAMERA } from './config.js';

export class OrbitCamera {
  /** @param {THREE.PerspectiveCamera} camera */
  constructor(camera) {
    this.camera = camera;

    this.target = new THREE.Vector3(...CAMERA.target);
    const offset = new THREE.Vector3(...CAMERA.position).sub(this.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    /** Currently rendered values. */
    this.theta = spherical.theta;
    this.phi = spherical.phi;
    this.radius = spherical.radius;
    /** Goals the rendered values ease toward. */
    this.thetaGoal = this.theta;
    this.phiGoal = this.phi;
    this.radiusGoal = this.radius;

    /** Where the camera sits after the last update (for shake integration). */
    this.position = new THREE.Vector3(...CAMERA.position);
    /** The point the camera looks at. */
    this.lookAt = this.target.clone();

    // Limits: never dip under the floor plane, never clip inside the cabinet,
    // never zoom out into the fog.
    this.minPhi = 0.22;
    this.maxPhi = 1.45;
    this.minRadius = 60;
    this.maxRadius = 380;

    /** Radians of orbit per pixel of drag. */
    this.rotateSpeed = 0.0052;
    /** Wheel deltaY multiplier (exponential dolly). */
    this.zoomSpeed = 0.0016;
    /** Damping stiffness: higher = snappier. */
    this.stiffness = 9.0;

    // --- idle showcase ---------------------------------------------------
    // After a few seconds without input the camera slowly circles the machine
    // so the 3D reads immediately, even before the player discovers dragging.
    this.lastInput = performance.now();
    this.idleAfter = 2.5;
    this.idleSpin = 0.3;
    this.idleRadius = 190;
    this.idlePhi = 1.02;

    /** Set by main.js: true while a round is live, disabling the showcase. */
    this.suspendShowcase = false;
    /** Pose the camera slides back to whenever a new ball is loaded. */
    this.defaultPose = { theta: spherical.theta, phi: spherical.phi, radius: spherical.radius };
  }

  /** Any game interaction (plunger, buttons, keys) resets the idle timer. */
  noteInteraction() {
    this.lastInput = performance.now();
  }

  /**
   * Ease back to the standard playing view. Called when a new ball is loaded
   * so aiming always starts from a known, sensible angle. The theta goal is
   * normalised to the nearest full turn so the camera takes the short way
   * round instead of unwinding every revolution the player made.
   */
  returnToDefault() {
    const twoPi = Math.PI * 2;
    const turns = Math.round((this.thetaGoal - this.defaultPose.theta) / twoPi);
    this.thetaGoal = this.defaultPose.theta + turns * twoPi;
    this.phiGoal = this.defaultPose.phi;
    this.radiusGoal = this.defaultPose.radius;
  }

  /**
   * Feed a drag delta in screen pixels.
   * @param {number} dx @param {number} dy
   */
  rotate(dx, dy) {
    this.lastInput = performance.now();
    this.thetaGoal -= dx * this.rotateSpeed;
    this.phiGoal -= dy * this.rotateSpeed;
    this.phiGoal = Math.max(this.minPhi, Math.min(this.maxPhi, this.phiGoal));
  }

  /**
   * Feed a wheel delta. Positive deltaY zooms out, like every orbit camera.
   * @param {number} deltaY
   */
  zoom(deltaY) {
    this.lastInput = performance.now();
    const ratio = Math.exp(deltaY * this.zoomSpeed);
    this.radiusGoal = Math.max(this.minRadius, Math.min(this.maxRadius, this.radiusGoal * ratio));
  }

  /**
   * Move the orbit target across the ground plane: walk around the machine.
   * @param {number} forward +1 = walk toward where the camera looks
   * @param {number} strafe  +1 = step right
   * @param {number} dt      seconds this frame (speed scales with dt)
   */
  pan(forward, strafe, dt) {
    this.lastInput = performance.now();
    // Horizontal basis of the current view.
    const fx = -Math.sin(this.theta);
    const fz = -Math.cos(this.theta);
    const rx = Math.cos(this.theta);
    const rz = -Math.sin(this.theta);

    // Walk speed scales with zoom so it feels the same at any distance.
    const speed = this.radius * 0.55 * dt;
    this.target.x += (fx * forward + rx * strafe) * speed;
    this.target.z += (fz * forward + rz * strafe) * speed;

    // Keep the machine in reach: never wander into the fog.
    this.target.x = Math.max(-90, Math.min(90, this.target.x));
    this.target.z = Math.max(-70, Math.min(130, this.target.z));
  }

  /** @param {number} dt seconds since the previous frame */
  update(dt) {
    // Idle showcase: slow continuous orbit until the player touches anything.
    // Suspended while a round is live so it never fights the aiming view.
    if (!this.suspendShowcase && performance.now() - this.lastInput > this.idleAfter * 1000) {
      this.thetaGoal += dt * this.idleSpin;
      const ease = 1 - Math.exp(-dt * 0.6);
      this.radiusGoal += (this.idleRadius - this.radiusGoal) * ease;
      this.phiGoal += (this.idlePhi - this.phiGoal) * ease;
    }

    const k = 1 - Math.exp(-dt * this.stiffness);
    this.theta += (this.thetaGoal - this.theta) * k;
    this.phi += (this.phiGoal - this.phi) * k;
    this.radius += (this.radiusGoal - this.radius) * k;

    this.position.setFromSphericalCoords(this.radius, this.phi, this.theta).add(this.target);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    this.lookAt.copy(this.target);
  }
}
