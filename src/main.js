/**
 * Entry point: builds the Three.js scene, wires the machine, the game rules,
 * the controls and the overlay together, then drives the render loop.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAMERA, TILT } from './config.js';
import { PinballMachine } from './pinball.js';
import { Game } from './game.js';
import { Controls } from './controls.js';
import { OrbitCamera } from './camera.js';
import { UI } from './ui.js';
import { audio } from './audio.js';

const canvas = document.getElementById('scene');

// ------------------------------------------------------------------ renderer

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// -------------------------------------------------------------------- scene

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1517);
scene.fog = new THREE.Fog(0x1b1517, 190, 340);

// Image-based lighting so metals (pegs, ball, rails) read as metal instead
// of black. One PMREM bake at boot, then free for every frame.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// A night-market arcade is lit from above by a mixture of warm bulbs and the
// cold glow of a snack stall. Two lights plus a hemisphere fill is enough.
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x35241c, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2d0, 1.5);
key.position.set(-45, 160, 90);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 20;
key.shadow.camera.far = 500;
key.shadow.camera.left = -160;
key.shadow.camera.right = 160;
key.shadow.camera.top = 200;
key.shadow.camera.bottom = -60;
key.shadow.bias = -0.0012;
scene.add(key);

const warm = new THREE.PointLight(0xffb45a, 55, 260, 2);
warm.position.set(30, 95, 60);
scene.add(warm);

const cool = new THREE.PointLight(0x88c4ff, 30, 240, 2);
cool.position.set(-40, 70, -10);
scene.add(cool);

// ------------------------------------------------------------------- machine

const machine = new PinballMachine(scene);
const game = new Game(machine);

const camera = new THREE.PerspectiveCamera(
  CAMERA.fov,
  window.innerWidth / window.innerHeight,
  CAMERA.near,
  CAMERA.far,
);
camera.position.set(...CAMERA.position);
camera.lookAt(new THREE.Vector3(...CAMERA.target));

// Free-look rig: the default pose is the fixed arcade framing, but the player
// can drag empty space to orbit and use the wheel to dolly in and out.
const orbit = new OrbitCamera(camera);

const controls = new Controls({ machine, game, camera, canvas, orbit });
const ui = new UI({ controls });
game.attachUI(ui);

// The plunger visual is driven by controls, but it also needs its own pull
// state so the spring-back animation has something to interpolate from.
machine.plungerVisualPull = 0;
const originalUpdateVisual = machine.updatePlungerVisual.bind(machine);
machine.updatePlungerVisual = (pull) => {
  machine.plungerVisualPull = pull;
  originalUpdateVisual(pull);
};

// ------------------------------------------------------------------ the loop

const clock = new THREE.Clock();
let lastGameState = null;

let firstFrame = true;

function frame() {
  requestAnimationFrame(frame);

  // While the automated harness is driving the simulation it takes ownership of
  // `game.update`, so the render loop only pumps rAF without any WebGL work.
  if (window.__pinballTestDrive) {
    return;
  }

  // Cap the delta so a backgrounded tab does not fast-forward the physics.
  const dt = Math.min(clock.getDelta(), 0.05);

  game.update(dt);
  controls.update(dt);
  ui.update(dt);

  // Park the showcase while a round is live, and slide back to the standard
  // framing whenever a new ball is loaded so aiming starts from a known view.
  orbit.suspendShowcase = game.state !== 'READY' && game.state !== 'GAME_OVER';
  if (game.state === 'AIMING' && lastGameState !== 'AIMING') orbit.returnToDefault();
  lastGameState = game.state;

  // Ease the orbit rig toward the player's drag/zoom, then let the very
  // slight impact shake ride on top of whatever framing was chosen.
  orbit.update(dt);
  const camPos = orbit.position;
  const camLook = orbit.lookAt;
  camera.position.set(
    camPos.x + ui.shakeOffset.x,
    camPos.y + ui.shakeOffset.y,
    camPos.z,
  );
  camera.lookAt(
    camLook.x + ui.shakeOffset.x * 0.4,
    camLook.y + ui.shakeOffset.y * 0.4,
    camLook.z,
  );

  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    ui.ready();
  }
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  // Portrait screens need a wider vertical lens so the machine and touch
  // controls fit together without forcing the player to pinch-zoom first.
  camera.fov = w < h ? 56 : w < 760 ? 49 : CAMERA.fov;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

window.addEventListener('resize', onResize);
onResize();
ui.setMuted(audio.muted);
frame();

// Expose a tiny handle for debugging / automated tests in the console.
window.__pinball = { machine, game, controls, ui, audio, camera, orbit, scene, renderer, THREE, TILT };
