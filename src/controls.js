/**
 * Player input: plunger drag, 開始 button click, keyboard shortcuts.
 *
 * The plunger is operated by pulling the knob *downward on screen*, toward the
 * player. Releasing lets the spring snap inward and fires the ball with the
 * exact amount of power the player built up.
 *
 * Click-to-fire is also supported (a plain click on the plunger gives a
 * mid-strength shot) because dragging is not discoverable for every player.
 *
 * Dragging anywhere that is NOT an interactive part orbits the camera, so the
 * machine can be inspected from any angle. The raycast decides which one a
 * drag means: grab the plunger = fire, grab anything else = look around.
 */

import * as THREE from 'three';
import { PLUNGER } from './config.js';
import { audio } from './audio.js';

const DRAG_SENSITIVITY = 0.055; // pull-cm per screen pixel

export class Controls {
  /**
   * @param {object} opts
   * @param {import('./pinball.js').PinballMachine} opts.machine
   * @param {import('./game.js').Game} opts.game
   * @param {THREE.Camera} opts.camera
   * @param {HTMLElement} opts.canvas
   * @param {import('./camera.js').OrbitCamera} [opts.orbit] free-look camera rig
   */
  constructor({ machine, game, camera, canvas, orbit }) {
    this.machine = machine;
    this.game = game;
    this.camera = camera;
    this.canvas = canvas;
    this.orbit = orbit ?? null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.dragging = false;
    this.pointerId = null;
    this.dragStartY = 0;
    this.pull = 0;
    this.spaceHeld = false;
    /** Visual-only release animation state. */
    this.releasing = false;

    /** Orbit-drag state (camera look-around, not the plunger). */
    this.orbitDragging = false;
    this.orbitLastX = 0;
    this.orbitLastY = 0;
    /** Currently held walk keys (WASD / arrows) for camera panning. */
    this._walk = {};

    this._bind();
  }

  // ------------------------------------------------------------------ helpers

  /** Convert a client-space pointer event into normalised device coords. */
  _setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /**
   * Raycast the interactive meshes and return the first recognised hit.
   * @returns {{kind: string, object: THREE.Object3D}|null}
   */
  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [
      this.machine.plungerHitMesh,
      this.machine.startButtonHitMesh,
      this.machine.startButtonMesh,
      this.machine.startButtonLabel,
      ...this.machine.ledMeshes.values(),
    ].filter(Boolean);

    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      const kind = hit.object.userData.hitKind;
      if (kind) return { kind, object: hit.object };
    }
    return null;
  }

  // ------------------------------------------------------------------ binding

  _bind() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => this._onDown(e));
    window.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
    // Stop the browser from turning a drag into a text selection or a scroll.
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel dollies the orbit camera. Non-passive so we can block page zoom.
    c.addEventListener('wheel', (e) => {
      if (this.orbit) {
        e.preventDefault();
        this.orbit.zoom(e.deltaY);
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._onKey(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
    // Losing the window (alt-tab, click outside) must not leave keys stuck on.
    window.addEventListener('blur', () => { this._walk = {}; });
  }

  _onDown(event) {
    // The first gesture is also what unlocks the Web Audio context.
    audio.unlock();
    this.orbit?.noteInteraction();
    this._setPointer(event);
    const pick = this._pick();

    if (pick?.kind === 'startButton') {
      const changed = this.game.state === 'SPINNING'
        ? this.game.stopSpin()
        : this.game.state === 'AIMING'
          ? this.game.releasePlunger(PLUNGER.maxPull * 0.65)
          : this.game.pressStart();
      if (changed) this.machine.buttonPressed = true;
      return;
    }

    // Grabbing the plunger begins a drag. We use the canvas element so the
    // pointer can leave the knob while still being tracked.
    const bump = this.raycaster.intersectObject(this.machine.plungerHitMesh, false);
    if (bump.length > 0) {
      // Reaching for the plunger before starting a round rolls the target
      // first, so the player never has to fire a dead plunger.
      if (this.game.state === 'READY' || this.game.state === 'GAME_OVER') {
        this.game.pressStart();
      }
      this.canvas.setPointerCapture?.(event.pointerId);
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.dragStartY = event.clientY;
      this.pull = 0;
      return;
    }

    // Anything else: orbit the camera instead of touching the game.
    if (this.orbit) {
      this.orbitDragging = true;
      this.pointerId = event.pointerId;
      this.orbitLastX = event.clientX;
      this.orbitLastY = event.clientY;
    }
  }

  _onMove(event) {
    // Camera orbit drag.
    if (this.orbitDragging) {
      if (this.pointerId != null && event.pointerId !== this.pointerId) return;
      this.orbit?.rotate(event.clientX - this.orbitLastX, event.clientY - this.orbitLastY);
      this.orbitLastX = event.clientX;
      this.orbitLastY = event.clientY;
      return;
    }

    if (!this.dragging) return;
    if (this.pointerId != null && event.pointerId !== this.pointerId) return;

    // Pull the handle down/toward the player to tension the spring. The knob
    // follows the pointer instead of moving in the opposite direction.
    const dy = event.clientY - this.dragStartY;
    const next = Math.max(0, Math.min(PLUNGER.maxPull, dy * DRAG_SENSITIVITY));

    if (Math.abs(next - this.pull) > 0.25) {
      audio.pull(next / PLUNGER.maxPull);
    }
    this.pull = next;
    this.machine.updatePlungerVisual(this.pull);
  }

  _onUp(event) {
    if (this.orbitDragging) {
      if (this.pointerId != null && event.pointerId !== this.pointerId) return;
      this.orbitDragging = false;
      this.pointerId = null;
      return;
    }

    if (!this.dragging) return;
    if (this.pointerId != null && event.pointerId !== this.pointerId) return;

    this.dragging = false;
    this.pointerId = null;

    const power = this.pull;
    // Preserve the player's real force. A short pull may roll back to the
    // waiting position; the same ball can then be launched again.
    this.machine.updatePlungerVisual(power);

    if (this.game.state === 'AIMING') {
      this.game.releasePlunger(power);
    }
    // Spring the plunger back to rest.
    this.pull = 0;
    this.releasing = true;
  }

  _onKey(event) {
    audio.unlock();
    this.orbit?.noteInteraction();
    // Walk keys: held keys pan the camera every frame via `update`.
    if (this.orbit && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.code)) {
      this._walk[event.code] = true;
      if (event.code.startsWith('Arrow')) event.preventDefault();
      return; // fall through: these are not game shortcuts
    }
    switch (event.code) {
      case 'Space': {
        event.preventDefault();
        if (event.repeat) break;
        if (this.game.state === 'READY' || this.game.state === 'GAME_OVER') {
          this.game.pressStart();
        } else if (this.game.state === 'AIMING') {
          this.spaceHeld = true;
          this.pull = 0;
          this.machine.updatePlungerVisual(0);
        }
        break;
      }
      case 'KeyM': {
        const muted = audio.toggleMute();
        this.game.ui?.setMuted(muted);
        break;
      }
      case 'KeyR':
        this.game.reset();
        break;
      case 'Enter':
        if (this.game.state === 'AIMING') {
          const pull = PLUNGER.maxPull * 0.65;
          this.machine.updatePlungerVisual(pull);
          this.game.releasePlunger(pull);
          this.releasing = true;
        } else {
          this.game.pressStart();
        }
        break;
      default:
        break;
    }
  }

  /** Release a walk key. Bound separately so keyup never triggers game logic. */
  _onKeyUp(event) {
    if (this.orbit) delete this._walk[event.code];
    if (event.code === 'Space' && this.spaceHeld) {
      event.preventDefault();
      this.spaceHeld = false;
      const power = this.pull;
      this.machine.updatePlungerVisual(power);
      if (this.game.state === 'AIMING') this.game.releasePlunger(power);
      this.pull = 0;
      this.releasing = true;
    }
  }

  // ------------------------------------------------------------------ update

  /**
   * Animate the plunger springing back after a release.
   * @param {number} dt
   */
  update(dt) {
    // Camera walking: WASD / arrow keys pan the orbit target.
    if (this.orbit) {
      const w = this._walk;
      const forward = (w.KeyW || w.ArrowUp ? 1 : 0) + (w.KeyS || w.ArrowDown ? -1 : 0);
      const strafe = (w.KeyD || w.ArrowRight ? 1 : 0) + (w.KeyA || w.ArrowLeft ? -1 : 0);
      if (forward !== 0 || strafe !== 0) this.orbit.pan(forward, strafe, dt);
    }

    if (this.spaceHeld && this.game.state === 'AIMING') {
      // A little over a second from minimum to full power. Holding SPACE feels
      // like compressing a spring instead of acting as a hidden fixed shot.
      this.pull = Math.min(PLUNGER.maxPull, this.pull + dt * 7.2);
      this.machine.updatePlungerVisual(this.pull);
    }

    if (!this.releasing) return;
    const current = this.machine.plungerVisualPull ?? 0;
    const next = Math.max(0, current - PLUNGER.maxPull * dt * 6.0);
    this.machine.updatePlungerVisual(next);
    this.machine.plungerVisualPull = next;
    if (next <= 0.01) {
      this.releasing = false;
      this.machine.plungerVisualPull = 0;
    }
  }
}

/** Expose the current pull for the on-screen power meter. */
export function pullRatio(controls) {
  return controls.pull / PLUNGER.maxPull;
}
