/**
 * Geometry builders for the machine.
 *
 * These are exported as objects of methods; `pinball.js` copies them onto
 * `PinballMachine.prototype`. Splitting them out keeps the class readable while
 * letting the cabinet, tray, pin field and lane each live in one focused block.
 *
 * Authoring convention for every method below:
 *   x: -28 .. +28   (left .. right, from the player's point of view)
 *   y: 0 is the tray floor, positive is out of the tray
 *   z: 0 is the back wall, BOARD.height (70) is the front lip nearest the player
 */

import * as THREE from 'three';
import { BOARD, PALETTE, POCKETS, POCKET, POCKET_ARCH, LANE, PLUNGER, STAND, TILT, HOLE_MULTIPLIERS } from './config.js';
import { CANNON, MATERIALS } from './physics.js';
import { buildPegs, buildBumpers, buildDeflectors, buildPocketDividers, pocketFloorZ } from './layout.js';

// ---------------------------------------------------------------- materials

/** Matte plastic with a hint of wax, like a cheap Taiwanese arcade cabinet. */
export function plastic(color, { roughness = 0.62, emissive = 0.05 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.03,
    emissive: new THREE.Color(color).multiplyScalar(emissive),
  });
}

/** Brushed metal for the plunger shaft, pegs and trim. */
export function metal(color, roughness = 0.3, metalness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** The clear plastic cover over the tray. */
export function glassMaterial(color, opacity = 0.16) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** LED material that can be switched on and off. */
export function ledMaterial(color, on = false) {
  return new THREE.MeshStandardMaterial({
    color: on ? color : PALETTE.ledOff,
    emissive: new THREE.Color(on ? color : 0x000000),
    emissiveIntensity: on ? 1.6 : 0,
    roughness: 0.35,
  });
}

/** Rounded rectangle path -- the classic plastic-cabinet silhouette. */
export function roundedRectShape(width, height, radius) {
  const s = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/**
 * Add a mesh to the group and remember its geometry/material for disposal.
 * @param {object} self the PinballMachine instance
 */
export function add(self, mesh, geo, mat, { shadow = true } = {}) {
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  self.group.add(mesh);
  if (geo) self._disposables.push(geo);
  if (mat) self._disposables.push(mat);
  return mesh;
}

/**
 * Register a static box collider.
 * @param {object} self
 * @param {number} x @param {number} y @param {number} z
 * @param {number} hx @param {number} hy @param {number} hz half extents
 * @param {CANNON.Material} material
 * @param {number} [angle] rotation about y
 */
export function staticBox(self, x, y, z, hx, hy, hz, material, angle = 0) {
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    material,
  });
  body.position.set(x, y, z);
  if (angle) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
  self.world.addBody(body);
  return body;
}

// ------------------------------------------------------------------ cabinet

export const CabinetMethods = {
  /** The yellow plastic shell the whole machine is built into. */
  _buildCabinet() {
    const w = BOARD.width + 6;
    const h = BOARD.height + 13;
    const depth = 8;
    const yellow = plastic(PALETTE.bodyYellow, { roughness: 0.52, emissive: 0.04 });
    const darkYellow = plastic(PALETTE.bodyYellowDark, { roughness: 0.68, emissive: 0.02 });

    // Low, narrow sheet-metal/plastic body. The actual machine is a tabletop
    // cabinet (35.5 × 64 cm), not a broad American pinball cabinet.
    const slabGeo = new THREE.BoxGeometry(w, depth, h);
    const slab = new THREE.Mesh(slabGeo, darkYellow);
    slab.position.set(0, -BOARD.baseThickness - depth / 2, h / 2 - 3.0);
    add(this, slab, slabGeo, darkYellow);

    // Front control apron, flush with the playfield and spanning the cabinet.
    const apronGeo = new THREE.BoxGeometry(w - 2.0, 2.4, 12.0);
    const apron = new THREE.Mesh(apronGeo, yellow);
    apron.position.set(0, 0.55, BOARD.height + 6.0);
    add(this, apron, apronGeo, yellow);

    // Continuous rainbow edging is the machine's most recognisable detail.
    const rainbow = [
      PALETTE.trimRed, PALETTE.trimOrange, 0xf4d52f,
      PALETTE.trimGreen, PALETTE.trimBlue, PALETTE.trimPurple,
    ];
    const segLength = h / 12;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const geo = new THREE.BoxGeometry(2.15, 2.0, segLength + 0.12);
        const mat = plastic(rainbow[i % rainbow.length], { roughness: 0.4, emissive: 0.07 });
        const seg = new THREE.Mesh(geo, mat);
        seg.position.set(sx * (w / 2 - 0.35), 1.25, -3.0 + segLength * (i + 0.5));
        add(this, seg, geo, mat);
      }
    }
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.BoxGeometry(w / 7 + 0.1, 2.0, 2.1);
      const mat = plastic(rainbow[i % rainbow.length], { roughness: 0.4, emissive: 0.07 });
      const front = new THREE.Mesh(geo, mat);
      front.position.set(-w / 2 + (w / 7) * (i + 0.5), 1.25, h - 3.35);
      add(this, front, geo, mat);
    }

    // Red catch tray below the centre front edge, visible in every B.B.MAN.
    const trayGeo = new THREE.BoxGeometry(18, 1.5, 7.0);
    const trayMat = plastic(0xe13b42, { roughness: 0.5, emissive: 0.04 });
    const catchTray = new THREE.Mesh(trayGeo, trayMat);
    catchTray.position.set(0, -2.0, h + 0.2);
    add(this, catchTray, trayGeo, trayMat);

    this.cabinetSize = { w, h, depth };
  },
};

// --------------------------------------------------------------- playfield

export const TrayMethods = {
  /** The tilted floor, the rails fencing it in, and the clear plastic cover. */
  _buildTray() {
    const { width, height, baseThickness, wallHeight, wallThickness } = BOARD;
    const halfW = width / 2;

    // --- floor -------------------------------------------------------------
    const floorGeo = new THREE.BoxGeometry(width, baseThickness, height);
    const floorMat = plastic(PALETTE.playfield, { roughness: 0.82, emissive: 0.08 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, -baseThickness / 2, height / 2);
    add(this, floor, floorGeo, floorMat);

    // Screened-on border band, like the printed paint on a real tray.
    // It stops above the pocket comb so the red/pink slot floors stay visible.
    const bandGeo = new THREE.BoxGeometry(width - 1.4, 0.14, 58.0);
    const bandMat = plastic(PALETTE.playfieldEdge, { roughness: 0.9, emissive: 0.04 });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 0.07, 0.7 + 58.0 / 2);
    band.castShadow = false;
    add(this, band, bandGeo, bandMat);

    // Printed playfield art. A real night-market tray is never a blank sheet:
    // cheap two-colour ink, sunbursts and lucky motifs show through the pins.
    const artCanvas = document.createElement('canvas');
    artCanvas.width = 768;
    artCanvas.height = 896;
    const art = artCanvas.getContext('2d');
    art.clearRect(0, 0, artCanvas.width, artCanvas.height);
    art.save();
    art.translate(artCanvas.width / 2, artCanvas.height * 0.54);
    for (let i = 0; i < 24; i++) {
      art.rotate((Math.PI * 2) / 24);
      art.beginPath();
      art.moveTo(0, 0);
      art.lineTo(-22, -500);
      art.lineTo(22, -500);
      art.closePath();
      art.fillStyle = i % 2 ? 'rgba(224,55,48,.075)' : 'rgba(31,111,164,.055)';
      art.fill();
    }
    art.restore();
    art.strokeStyle = 'rgba(191,35,40,.32)';
    art.lineWidth = 8;
    art.strokeRect(26, 26, artCanvas.width - 52, artCanvas.height - 52);
    art.strokeStyle = 'rgba(22,105,170,.24)';
    art.lineWidth = 3;
    art.strokeRect(43, 43, artCanvas.width - 86, artCanvas.height - 86);
    art.textAlign = 'center';
    art.font = '900 78px "Microsoft JhengHei", sans-serif';
    art.fillStyle = 'rgba(180,32,37,.20)';
    art.fillText('好運來', artCanvas.width / 2, 455);
    art.font = '700 28px sans-serif';
    art.letterSpacing = '8px';
    art.fillStyle = 'rgba(26,85,130,.28)';
    art.fillText('LUCKY SHOT', artCanvas.width / 2, 500);

    const artTex = new THREE.CanvasTexture(artCanvas);
    artTex.colorSpace = THREE.SRGBColorSpace;
    const artMat = new THREE.MeshStandardMaterial({
      map: artTex,
      transparent: true,
      opacity: 0.94,
      roughness: 0.95,
      depthWrite: false,
    });
    const artGeo = new THREE.PlaneGeometry(width - 7, 55);
    const artMesh = new THREE.Mesh(artGeo, artMat);
    artMesh.rotation.x = -Math.PI / 2;
    artMesh.position.set(-1.5, 0.17, 29.2);
    artMesh.renderOrder = 1;
    add(this, artMesh, artGeo, artMat, { shadow: false });
    this._disposables.push(artTex);

    this.floorBody = staticBox(
      this, 0, -baseThickness / 2, height / 2,
      width / 2, baseThickness / 2, height / 2, MATERIALS.floor,
    );

    // --- rails (visual + collider) ----------------------------------------
    const railMat = metal(PALETTE.rail, 0.35, 0.8);
    const rail = (cx, cz, lx, lz) => {
      const g = new THREE.BoxGeometry(lx, wallHeight, lz);
      const mesh = new THREE.Mesh(g, railMat);
      mesh.position.set(cx, wallHeight / 2, cz);
      add(this, mesh, g, railMat);
      return staticBox(this, cx, wallHeight / 2, cz, lx / 2, wallHeight / 2, lz / 2, MATERIALS.wall);
    };

    rail(-halfW + wallThickness / 2, height / 2, wallThickness, height); // left
    rail(halfW - wallThickness / 2, height / 2, wallThickness, height); // right
    rail(0, wallThickness / 2, width, wallThickness); // back

    // Front lip: catches anything that reaches the bottom edge outside a
    // pocket, so a ball can never simply fall out of the machine.
    rail(0, height - wallThickness / 2, width, wallThickness);

    // The colourful trim is visually thin, but the moulded cabinet below it
    // forms a deep catch wall. Invisible outer guards model that thickness and
    // prevent a high-energy glancing hit from tunnelling out of the machine.
    staticBox(this, -halfW - 1.5, 3.0, height / 2, 1.5, 3.0, height / 2 + 3, MATERIALS.wall);
    staticBox(this, halfW + 1.5, 3.0, height / 2, 1.5, 3.0, height / 2 + 3, MATERIALS.wall);
    staticBox(this, 0, 3.0, -1.5, halfW + 3, 3.0, 1.5, MATERIALS.wall);
    staticBox(this, 0, 3.0, height + 1.5, halfW + 3, 3.0, 1.5, MATERIALS.wall);

    // --- clear plastic cover ----------------------------------------------
    const coverGeo = new THREE.BoxGeometry(width + 1.6, 0.5, height + 1.6);
    const coverMat = glassMaterial(PALETTE.glass, 0.13);
    const cover = new THREE.Mesh(coverGeo, coverMat);
    cover.position.set(0, 11.5, height / 2);
    add(this, cover, coverGeo, coverMat, { shadow: false });

    // Ceiling collider at cover height. Even after a full-power bumper kick the
    // ball cannot leave the tray: this is the last line of defence.
    this.ceilingBody = staticBox(
      this, 0, 12.2, height / 2,
      width / 2 + 1, 0.25, height / 2 + 1, MATERIALS.wall,
    );

    // Chrome posts holding the cover up.
    const postGeo = new THREE.CylinderGeometry(0.55, 0.55, 12, 10);
    for (const sx of [-1, 1]) {
      for (const sz of [0, 1]) {
        const p = new THREE.Mesh(postGeo, railMat);
        p.position.set(sx * (halfW + 0.6), 6, sz ? height - 0.6 : 0.6);
        p.castShadow = false;
        this.group.add(p);
      }
    }
    this._disposables.push(postGeo);
  },
};

// --------------------------------------------------------------- pin field

export const PegMethods = {
  /**
   * The dense brass pin field.
   *
   * ~200 pins rendered with two InstancedMesh batches (shaft + cap) so the
   * whole field costs two draw calls, while every pin still gets its own real
   * `Cylinder` collider.
   */
  _buildPegs() {
    const pins = buildPegs();
    this.pegs = pins;

    const PEG_HEIGHT = 2.5;
    // Slight taper: real pins are driven in and flare where they meet the board.
    const shaftGeo = new THREE.CylinderGeometry(0.30, 0.36, PEG_HEIGHT, 8);
    const capGeo = new THREE.SphereGeometry(0.34, 8, 6);
    const shaftMat = metal(PALETTE.peg, 0.32, 0.92);
    const capMat = metal(PALETTE.pegCap, 0.22, 0.9);

    const shaft = new THREE.InstancedMesh(shaftGeo, shaftMat, pins.length);
    const caps = new THREE.InstancedMesh(capGeo, capMat, pins.length);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    caps.castShadow = false;
    caps.receiveShadow = true;
    // The bounding sphere of an InstancedMesh is computed from the base
    // geometry, so frustum culling would drop the whole field. Switch it off.
    shaft.frustumCulled = false;
    caps.frustumCulled = false;

    const matrix = new THREE.Matrix4();
    this.pegBodies = [];

    pins.forEach((pin, i) => {
      const y = PEG_HEIGHT / 2;
      matrix.makeTranslation(pin.x, y, pin.z);
      shaft.setMatrixAt(i, matrix);
      matrix.makeTranslation(pin.x, PEG_HEIGHT, pin.z);
      caps.setMatrixAt(i, matrix);

      // Collider: a sphere matching the shaft. Sphere-sphere contacts are the
      // most stable pair in the solver, so fast balls glance off pins instead
      // of catching a polygon edge and popping.
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Sphere(pin.radius + 0.08),
        material: MATERIALS.peg,
        collisionFilterGroup: 4,
        collisionFilterMask: 1,
      });
      body.position.set(pin.x, 1.0, pin.z);
      this.world.addBody(body);
      this.pegBodies.push(body);
    });

    shaft.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;

    this.group.add(shaft, caps);
    this._disposables.push(shaftGeo, capGeo, shaftMat, capMat);
  },
};

// ------------------------------------------------------------------ bumpers

export const BumperMethods = {
  /** Small coloured rebound posts distributed among the chrome pins. */
  _buildBumpers() {
    const specs = buildBumpers();
    this.bumperSpecs = specs;
    const colors = [
      PALETTE.bumperRed, PALETTE.bumperBlue, PALETTE.bumperRed,
      PALETTE.bumperBlue, PALETTE.trimOrange,
    ];

    this.bumperBodies = [];
    this.bumperMeshes = [];

    specs.forEach((spec, i) => {
      const height = 3.1;
      const geo = new THREE.CylinderGeometry(spec.radius, spec.radius * 1.1, height, 16);
      const color = colors[i % colors.length];
      const mat = plastic(color, { roughness: 0.4, emissive: 0.16 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spec.x, height / 2, spec.z);
      mesh.userData.baseGlow = 0.16;
      mesh.userData.baseEmissive = color;
      add(this, mesh, geo, mat);

      // White crown so a fast-moving ball reads against the coloured post.
      const crownGeo = new THREE.CylinderGeometry(spec.radius * 0.72, spec.radius * 0.9, 1.0, 14);
      const crownMat = plastic(0xfff6e0, { roughness: 0.5, emissive: 0.2 });
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.set(spec.x, height + 0.4, spec.z);
      add(this, crown, crownGeo, crownMat);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Sphere(spec.radius),
        material: MATERIALS.bumper,
        collisionFilterGroup: 8,
        collisionFilterMask: 1,
      });
      body.position.set(spec.x, 1.0, spec.z);
      body.userData = { type: 'bumper', kick: spec.kick, index: i };
      this.world.addBody(body);
      this.bumperBodies.push(body);
      this.bumperMeshes.push(mesh);
    });
  },
};

// -------------------------------------------------------------- deflectors

export const DeflectorMethods = {
  /** Angled plastic walls that peel balls off the rails (the 導流結構). */
  _buildDeflectors() {
    const specs = buildDeflectors();
    this.deflectorSpecs = specs;
    const colors = [
      PALETTE.trimGreen, PALETTE.trimBlue, PALETTE.trimPink,
      PALETTE.trimOrange, PALETTE.trimPurple, PALETTE.trimRed,
      PALETTE.trimBlue, PALETTE.trimGreen, PALETTE.trimOrange, PALETTE.trimPink,
    ];

    specs.forEach((d, i) => {
      const mat = plastic(colors[i % colors.length], { roughness: 0.46, emissive: 0.09 });
      const geo = new THREE.BoxGeometry(d.w, d.h, d.l);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, d.h / 2, d.z);
      mesh.rotation.y = d.angle;
      add(this, mesh, geo, mat);

      staticBox(
        this, d.x, d.h / 2, d.z,
        d.w / 2, d.h / 2, d.l / 2, MATERIALS.wall, d.angle,
      );
    });
  },
};

// ------------------------------------------------------------------ pockets

export const PocketMethods = {
    /** The nine fixed multiplier lanes of the night-market score board. */
  _buildPockets() {
    const depth = POCKET.depth;
    const w = POCKET.width;
    const dh = POCKET.dividerHeight;
    const zCenter = BOARD.height - depth / 2 - 1.0;
    const dividerMat = plastic(0xf1c51f, { roughness: 0.52, emissive: 0.05 });
    const dividers = buildPocketDividers();
    for (const d of dividers) {
      const geo = new THREE.BoxGeometry(d.w, dh, d.l);
      const mesh = new THREE.Mesh(geo, dividerMat);
      mesh.position.set(d.x, dh / 2, d.z);
      add(this, mesh, geo, dividerMat);
      staticBox(this, d.x, dh / 2, d.z, d.w / 2, dh / 2, d.l / 2, MATERIALS.catch);
    }

    this.pocketZones = [];
    this.laneLedMeshes = [];
    const floorMat = metal(0x65676b, 0.62, 0.45);
    const stripMat = plastic(0x242426, { roughness: 0.82, emissive: 0.01 });
    const ledGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.24, 18);

    POCKETS.forEach((pocket, index) => {
      const geo = new THREE.BoxGeometry(w, 1.2, depth);
      const mesh = new THREE.Mesh(geo, floorMat);
      mesh.position.set(pocket.x, -0.48, zCenter);
      add(this, mesh, geo, floorMat);

      const stripGeo = new THREE.BoxGeometry(0.54, 0.12, depth - 1.1);
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(pocket.x, 0.16, zCenter + 0.3);
      add(this, strip, stripGeo, stripMat, { shadow: false });

      staticBox(this, pocket.x, -0.6, zCenter, w / 2, 0.6, depth / 2, MATERIALS.catch);

      // Stop wall at the player end; the opposite end stays open as the lane
      // entrance, exactly like the comb visible under the real glass.
      staticBox(this, pocket.x, 1.2, zCenter + depth / 2, w / 2, 1.6, 0.4, MATERIALS.catch);

      this.pocketZones.push({
        value: index,
        lane: index,
        index,
        x: pocket.x,
        z: zCenter,
        halfWidth: w / 2,
        depth,
        multiplier: HOLE_MULTIPLIERS[index],
      });

      const ledMat = ledMaterial(PALETTE.ledOn, false);
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(pocket.x, 0.5, zCenter - depth / 2 + 0.9);
      led.userData.lane = index;
      this.group.add(led);
      this.laneLedMeshes.push(led);
      this._disposables.push(ledMat);

      const label = this._textSprite(`×${HOLE_MULTIPLIERS[index]}`, '#fff4b0', '#b51e2d');
      label.position.set(pocket.x, 1.85, BOARD.height - 0.75);
      label.scale.setScalar(HOLE_MULTIPLIERS[index] === 10 ? 1.35 : 1.05);
      this.group.add(label);
    });
    this._disposables.push(ledGeo);

    // Physics floor extension under the whole pocket block.
    staticBox(
      this, 0, -0.7, BOARD.height - 4.0,
      BOARD.width / 2, 0.5, 4.0, MATERIALS.catch,
    );
  },
};

// --------------------------------------------------------------- launch lane

export const LaneMethods = {
  /**
   * The right-hand lane structure: a narrow barrel the ball is launched up, and
   * a return lane that feeds the plunger.
   *
   * LANE.dividerX is the wall between the two lanes. It stops short of the top
   * (LANE.dividerTop) so a launched ball rolls over its tip and into the
   * playfield.
   */
  _buildLane() {
    const { width, height, wallHeight } = BOARD;
    const halfW = width / 2;
    const railMat = metal(PALETTE.rail, 0.35, 0.8);

    const wall = (x, z, lx, lz, mat = railMat) => {
      const g = new THREE.BoxGeometry(lx, wallHeight, lz);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, wallHeight / 2, z);
      add(this, mesh, g, mat);
      return staticBox(this, x, wallHeight / 2, z, lx / 2, wallHeight / 2, lz / 2, MATERIALS.wall);
    };

    // Divider between the full-height right launch lane and the playfield.
    wall(LANE.dividerX, 31.5, 0.6, 49.0);

    // Rounded cap on the divider tip: without it a fast ball can clip the
    // square corner and get flung unpredictably.
    const capGeo = new THREE.CylinderGeometry(0.3, 0.3, wallHeight, 12);
    const capMesh = new THREE.Mesh(capGeo, railMat);
    capMesh.position.set(LANE.dividerX, wallHeight / 2, 7.0);
    add(this, capMesh, capGeo, railMat);
    this._disposables.push(capGeo);

    // --- barrel (the lane the ball is launched up) ------------------------
    // Inner faces: divider east vs the right rail. The lane stays snug so a
    // launched ball cannot rattle sideways and lose its climb.
    const railInnerRight = halfW - BOARD.wallThickness;
    const barrelX = (LANE.dividerX + 0.3 + railInnerRight) / 2;
    const barrelWidth = railInnerRight - LANE.dividerX - 0.3;

    staticBox(this, barrelX, 0.5, BOARD.height / 2, barrelWidth / 2, 0.5, BOARD.height / 2, MATERIALS.floor);
    const barrelGeo = new THREE.BoxGeometry(barrelWidth, 1.0, BOARD.height);
    const laneMat = plastic(0xdfe6ea, { roughness: 0.6, emissive: 0.05 });
    const barrel = new THREE.Mesh(barrelGeo, laneMat);
    barrel.position.set(barrelX, 0.5, BOARD.height / 2);
    add(this, barrel, barrelGeo, laneMat);

    // --- top guide ---------------------------------------------------------
    // Angled wall at the back of the barrel. A ball arriving northbound hits
    // it and is sent west into the pin field.
    const guideAngle = 0.82;
    const guideGeo = new THREE.BoxGeometry(0.65, wallHeight, 5.8);
    const guideMat = plastic(PALETTE.trimGreen, { roughness: 0.45, emissive: 0.1 });
    const guide = new THREE.Mesh(guideGeo, guideMat);
    guide.position.set(14.7, wallHeight / 2, 4.1);
    guide.rotation.y = guideAngle;
    add(this, guide, guideGeo, guideMat);
    staticBox(
      this, 14.7, wallHeight / 2, 4.1,
      0.325, wallHeight / 2, 2.9, MATERIALS.wall, guideAngle,
    );

    this.barrelX = barrelX;

    // --- ball return hole --------------------------------------------------
    // A physical hole in the bottom of the barrel at BLOCK, so a ball that
    // rolls back down the barrel is returned to the plunger when the scorer
    // (game.js) sees it arrive there. Nothing to build -- the ball simply
    // rolls down the barrel floor, which slopes back to the bottom.
    this.barrelBottomZ = height - 4.0;
  },
};

// ------------------------------------------------------------------ plunger

export const PlungerMethods = {
  /**
   * The mechanical pull-rod in the bottom-right corner.
   *
   * The rod slides along -z when the player drags it, compressing a visual
   * spring (a stack of torus rings whose pitch we animate). Releasing drives the
   * rod forward and kicks the ball out of the barrel.
   *
   * Only the knob and rod are meshes; the ball is launched by directly setting
   * its velocity in `game.js`, which is both cheaper and far more predictable
   * than colliding the rod with the ball.
   */
  _buildPlunger() {
    const restZ = PLUNGER.restZ;
    // Place the plunger assembly right of the return lane, at the bottom of
    // the barrel, close enough to the front rail that the knob rests just
    // PROUD of the machine front (baseZ 68 + restZ 4 = knob centre z 72).
    // The physical launch lane is under glass, but the chrome handle is fixed
    // to the outside of the cabinet's lower-right corner.
    const x = BOARD.width / 2 + 1.5;
    const baseZ = BOARD.height + 10.0;

    this.plungerOrigin = new THREE.Vector3(x, 1.0, baseZ);
    this.plungerGroup = new THREE.Group();
    this.plungerGroup.position.copy(this.plungerOrigin);
    this.group.add(this.plungerGroup);

    // --- mounting bracket --------------------------------------------------
    const bracketMat = metal(0x6f757b, 0.4, 0.85);
    const bracketGeo = new THREE.BoxGeometry(5.0, 1.4, 3.0);
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.set(0, 0, -1.0);
    add(this, bracket, bracketGeo, bracketMat);

    // --- rod ---------------------------------------------------------------
    this.plungerRodRestZ = restZ;
    // Long enough to keep its rear inside the bracket at full outward pull.
    const rodGeo = new THREE.CylinderGeometry(0.42, 0.42, 24, 12);
    const rodMat = metal(PALETTE.metal, 0.22, 0.95);
    const rod = new THREE.Mesh(rodGeo, rodMat);
    rod.rotation.x = Math.PI / 2;
    rod.castShadow = true;
    // Must be a child of plungerGroup: add() would hang it off the main group
    // and the rod would render in the middle of the playfield instead of in
    // the bracket.
    this.plungerGroup.add(rod);
    this.plungerRod = rod;
    this._disposables.push(rodGeo, rodMat);

    // --- spring (animated torus stack) -------------------------------------
    const ringGeo = new THREE.TorusGeometry(1.5, 0.16, 6, 14);
    const ringMat = metal(0x8d949a, 0.35, 0.9);
    this.plungerRings = [];
    for (let i = 0; i < 10; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      this.plungerGroup.add(ring);
      this.plungerRings.push(ring);
    }
    this._disposables.push(ringGeo, ringMat);

    // --- knob --------------------------------------------------------------
    const knobGeo = new THREE.CylinderGeometry(1.55, 1.55, 3.2, 18);
    const knobMat = metal(0xd5d8da, 0.22, 0.95);
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.rotation.x = Math.PI / 2;
    knob.castShadow = true;
    // Same as the rod: belongs to the plunger assembly, not the main group.
    this.plungerGroup.add(knob);
    this.plungerKnob = knob;
    this._disposables.push(knobGeo, knobMat);

    // A small collar so the knob reads as a grippable handle.
    const collarGeo = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 14);
    const collarMat = metal(0x5c6166, 0.3, 0.9);
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = -2.0;
    this.plungerGroup.add(collar);
    this._disposables.push(collarGeo, collarMat);

    // --- stealth pointer target -------------------------------------------
    // An invisible, generous sphere centred ON THE KNOB so the drag is easy to
    // grab with the mouse even though the knob itself is small on screen. It
    // must sit at the knob's rest position (restZ), not the group origin: the
    // knob travels restZ in front of the bracket.
    const hitGeo = new THREE.SphereGeometry(5.5, 8, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.name = 'plungerHit';
    hit.position.set(0, 0, restZ);
    this.plungerGroup.add(hit);
    this.plungerHitMesh = hit;
    this._disposables.push(hitGeo, hitMat);

    /** Current pull in cm, 0 = released. Updated by controls/game. */
    this.plungerPull = 0;
    this.updatePlungerVisual(0);
  },

  /**
   * Move the rod, knob and spring to match an outward pull distance.
   * @param {number} pull 0..PLUNGER.maxPull
   */
  updatePlungerVisual(pull) {
    const t = Math.max(0, Math.min(1, pull / PLUNGER.maxPull));
    // Pulling downward on screen draws the handle toward the player (+z).
    // Release snaps it inward and transfers that stored force to the ball.
    const z = this.plungerRodRestZ + pull;
    this.plungerRod.position.set(0, 0, z - 12);
    this.plungerKnob.position.set(0, 0, z);
    // The visible coils tighten as the handle is drawn out.
    const span = 16 - t * 9;
    this.plungerRings.forEach((ring, i) => {
      const u = i / (this.plungerRings.length - 1);
      ring.position.z = -2.5 + t * 2.0 - u * span;
      ring.scale.setScalar(1 + t * 0.12);
    });
  },
};

// ------------------------------------------------------------------ housing

export const HousingMethods = {
  /**
   * The parts of the cabinet the player interacts with from outside the glass:
   *   - the overhead control panel carrying the five target LEDs
   *   - the big 開始 button below the playfield
   *   - the ball-count readout next to it
   *
   * Interactive meshes carry `userData.hitKind` so controls.js can raycast a
   * single list and know what was clicked.
   */
  _buildHousing() {
    const { w } = this.cabinetSize;
    const height = BOARD.height;
    const panelMat = plastic(PALETTE.bodyYellow, { roughness: 0.58, emissive: 0.04 });
    const frameMat = metal(PALETTE.metal, 0.4, 0.75);

    // Upright rear control box: coin acceptor on the left, B.B.MAN panel in
    // the centre, yellow prize-ball outlet on the right.
    const panelGeo = new THREE.BoxGeometry(w, 28, 5.2);
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 14.0, -3.0);
    add(this, panel, panelGeo, panelMat);

    // Rainbow tape continues around the upright box.
    const rainbow = [PALETTE.trimRed, PALETTE.trimOrange, 0xf4d52f, PALETTE.trimGreen, PALETTE.trimBlue, PALETTE.trimPurple];
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BoxGeometry(w / 8 + 0.08, 1.8, 1.2);
      const mat = plastic(rainbow[i % rainbow.length], { roughness: 0.4, emissive: 0.08 });
      for (const y of [0.6, 27.4]) {
        const strip = new THREE.Mesh(geo, mat);
        strip.position.set(-w / 2 + (w / 8) * (i + 0.5), y, 0.05);
        add(this, strip, geo, mat);
      }
    }

    // Chrome coin acceptor.
    const coinGeo = new THREE.BoxGeometry(7.0, 18.0, 1.6);
    const coin = new THREE.Mesh(coinGeo, frameMat);
    coin.position.set(-14.2, 15.0, 0.25);
    add(this, coin, coinGeo, frameMat);
    const slotGeo = new THREE.BoxGeometry(1.1, 4.4, 0.45);
    const slotMat = plastic(0x272523, { roughness: 0.8 });
    const slot = new THREE.Mesh(slotGeo, slotMat);
    slot.position.set(-14.2, 17.2, 1.2);
    add(this, slot, slotGeo, slotMat);

    // Yellow prize-ball outlet on the right.
    const outletGeo = new THREE.BoxGeometry(6.8, 17.0, 1.8);
    const outletMat = plastic(0xe7b313, { roughness: 0.55, emissive: 0.03 });
    const outlet = new THREE.Mesh(outletGeo, outletMat);
    outlet.position.set(14.2, 14.8, 0.35);
    add(this, outlet, outletGeo, outletMat);
    const holeGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 18);
    const hole = new THREE.Mesh(holeGeo, slotMat);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(14.2, 10.2, 1.35);
    add(this, hole, holeGeo, slotMat);

    // --- target LEDs: 2 4 6 8 10 ------------------------------------------
    this.ledMeshes = new Map();
    this.ledLabels = new Map();

    const ledGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 18);
    const ledPositions = [-6.0, -3.0, 0, 3.0, 6.0];
    const values = [2, 4, 6, 8, 10];

    values.forEach((value, i) => {
      const mat = ledMaterial(PALETTE.ledOn, false);
      const led = new THREE.Mesh(ledGeo, mat);
      led.rotation.x = Math.PI / 2;
      led.position.set(ledPositions[i], 7.0, 0.35);
      led.userData.hitKind = 'targetLed';
      led.userData.value = value;
      this.group.add(led);
      this.ledMeshes.set(value, led);
      this._disposables.push(mat);

      const bezGeo = new THREE.CylinderGeometry(0.86, 0.86, 0.32, 18);
      const bez = new THREE.Mesh(bezGeo, frameMat);
      bez.rotation.x = Math.PI / 2;
      bez.position.set(ledPositions[i], 7.0, -0.05);
      bez.castShadow = false;
      this.group.add(bez);
      this._disposables.push(bezGeo);

      const label = this._textSprite(String(value), '#3a2a10', '#f7e6a8');
      label.position.set(ledPositions[i], 5.4, 0.35);
      label.scale.setScalar(1.45);
      this.group.add(label);
      this.ledLabels.set(value, label);
    });
    this._disposables.push(ledGeo);

    this._buildNamePlate();
    this._buildScoreReadout(height);
    this._buildStartButton(height);
  },
};

export const ButtonMethods = {
  /** White jump-light button on the left side of the yellow front apron. */
  _buildStartButton(height) {
    const btnBaseGeo = new THREE.CylinderGeometry(2.35, 2.55, 1.0, 22);
    const btnBaseMat = plastic(0xb41e27, { roughness: 0.45, emissive: 0.05 });
    const btnBase = new THREE.Mesh(btnBaseGeo, btnBaseMat);
    btnBase.position.set(-10.5, 2.0, height + 6.4);
    add(this, btnBase, btnBaseGeo, btnBaseMat);

    const btnGeo = new THREE.CylinderGeometry(1.75, 1.92, 1.25, 22);
    const btnMat = plastic(0xf5f2e9, { roughness: 0.25, emissive: 0.14 });
    const btn = new THREE.Mesh(btnGeo, btnMat);
    btn.position.set(-10.5, 2.85, height + 6.15);
    btn.userData.hitKind = 'startButton';
    this.group.add(btn);
    this.startButtonMesh = btn;
    this.startButtonHomeY = btn.position.y;
    this._disposables.push(btnGeo, btnMat, btnBaseGeo, btnBaseMat);
    this.startButtonLabel = null;

    // The visible cap is intentionally close to real scale, which made its
    // raycast target only a few pixels wide on some camera angles. Keep the
    // model accurate but give it a larger invisible touch/click target.
    const hitGeo = new THREE.CylinderGeometry(3.4, 3.4, 3.0, 16);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.copy(btn.position);
    hit.userData.hitKind = 'startButton';
    this.group.add(hit);
    this.startButtonHitMesh = hit;
    this._disposables.push(hitGeo, hitMat);

    // Round service lock in the centre of the apron.
    const lockGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.55, 18);
    const lockMat = metal(0xbfc4c7, 0.28, 0.9);
    const lock = new THREE.Mesh(lockGeo, lockMat);
    lock.position.set(0, 2.1, height + 6.3);
    add(this, lock, lockGeo, lockMat);
    const keyGeo = new THREE.BoxGeometry(0.25, 0.12, 1.0);
    const keyMat = plastic(0x292929, { roughness: 0.8 });
    const key = new THREE.Mesh(keyGeo, keyMat);
    key.position.set(0, 2.42, height + 6.3);
    add(this, key, keyGeo, keyMat, { shadow: false });
  },

  /**
   * The ball / target readout.
   *
   * Rendered onto a canvas so the digits are crisp, then used as both the
   * colour map and the emissive map so it glows like an LED segment display.
   */
  _buildScoreReadout(height) {
    const canvas = document.createElement('canvas');
    canvas.width = 168;
    canvas.height = 96;
    this.scoreCanvas = canvas;
    this.scoreCtx = canvas.getContext('2d');
    this._paintScoreReadout(10, null);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.scoreTexture = tex;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    const geo = new THREE.PlaneGeometry(7.2, 4.2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 14.2, 1.15);
    mesh.userData.hitKind = 'scoreReadout';
    add(this, mesh, geo, mat);
    this._disposables.push(tex);

    const frameGeo = new THREE.BoxGeometry(8.2, 5.2, 1.0);
    const frameMat = plastic(0x2b2723, { roughness: 0.55 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 14.2, 0.55);
    add(this, frame, frameGeo, frameMat);
  },

  /** The machine's painted name over the backboard. */
  _buildNamePlate() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#e970ae');
    gradient.addColorStop(0.55, '#f6acd1');
    gradient.addColorStop(1, '#df4d96');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cheap printed bubbles and starburst, matching the original pink fascia.
    for (const [x, y, r, color] of [
      [55, 72, 29, '#f58b24'], [430, 82, 22, '#34a8df'], [86, 190, 16, '#71b943'],
      [448, 230, 18, '#ef4560'], [58, 350, 19, '#ef4560'], [430, 410, 25, '#f0c727'],
    ]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 74px Arial Rounded MT Bold, sans-serif';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#713154';
    ctx.fillStyle = '#ffd83f';
    ctx.strokeText('B.B.MAN', canvas.width / 2, 115);
    ctx.fillText('B.B.MAN', canvas.width / 2, 115);
    ctx.font = '800 26px "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = '#fff4bf';
    ctx.fillText('彈 珠 超 人', canvas.width / 2, 172);

    // Simple mascot heads below the display area.
    for (const [x, color] of [[160, '#f0bd20'], [352, '#f8f1df']]) {
      ctx.beginPath(); ctx.arc(x, 475, 66, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 9; ctx.strokeStyle = '#593742'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x - 24, 470, 7, 0, Math.PI * 2); ctx.arc(x + 24, 470, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#30262a'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, 493, 18, 0, Math.PI); ctx.strokeStyle = '#30262a'; ctx.lineWidth = 6; ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const signMat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.18,
      roughness: 0.6,
    });
    const signGeo = new THREE.PlaneGeometry(18.5, 23.0);
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 14.2, 0.12);
    sign.castShadow = false;
    this.group.add(sign);
    this._disposables.push(tex, signGeo, signMat);
  },

  /**
   * Repaint the LED readout.
   * @param {number|null} balls
   * @param {number|null} target
   */
  _paintScoreReadout(balls, target) {
    const ctx = this.scoreCtx;
    const c = this.scoreCanvas;
    ctx.fillStyle = '#140f0c';
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.font = 'bold 78px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff5a3c';
    ctx.shadowColor = '#ff2d20';
    ctx.shadowBlur = 14;
    ctx.textAlign = 'center';
    ctx.fillText(String(balls ?? 0).padStart(2, '0').slice(-2), c.width / 2, 53);

    if (this.scoreTexture) this.scoreTexture.needsUpdate = true;
  },

  /**
   * A crisp text label as a flat, screen-facing quad.
   * @param {string} text
   * @param {string} color
   * @param {string} background
   */
  _textSprite(text, color, background) {
    const pad = 18;
    const font = 'bold 64px "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    const canvas = document.createElement('canvas');
    const measureCtx = canvas.getContext('2d');
    measureCtx.font = font;
    const textWidth = measureCtx.measureText(text).width;

    canvas.width = Math.ceil(textWidth) + pad * 2;
    canvas.height = 100;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 3);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const geo = new THREE.PlaneGeometry(canvas.width / canvas.height, 1);
    const sprite = new THREE.Mesh(geo, mat);
    sprite.userData.hitKind = 'label';
    this._disposables.push(tex, geo, mat);
    return sprite;
  },
};

// ------------------------------------------------------------------- stand

export const StandMethods = {
  /**
   * The world around the machine: a shared-style metal rack, dark market
   * ground and one red plastic stool. All of it is added straight to the SCENE (not
   * the tilted machine group) so the world stays level while the machine
   * leans. Nothing here is collidable - the ball can never reach it.
   */
  _buildStand() {
    const { w, h } = this.cabinetSize;
    const tableY = STAND.tableY;

    /** Convert a machine-local point to world space (group transform). */
    const toWorld = (x, y, z) => new THREE.Vector3(x, y, z)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), TILT)
      .add(new THREE.Vector3(0, tableY, 0));

    // --- four legs ---------------------------------------------------------
    // Each leg is a vertical box whose top is cut by the sloped underside.
    // The geometry is a tall box sunk below the ground (no visible bottom cut
    // needed at this size); top edge follows the slope via per-leg height.
    const legMat = metal(0x4f5357, 0.62, 0.72);
    const footGeo = new THREE.BoxGeometry(STAND.legWidth + 1.4, 1.2, STAND.legDepth + 1.6);
    const footMat = plastic(0x242629, { roughness: 0.85, emissive: 0.01 });
    for (const sx of [-1, 1]) {
      for (const z of STAND.legZ) {
        // Underside local y at this z: cabinet bottom slab spans -12.7..-2.2,
        // so the leg must reach past -12.7. Sample the deck underside plane.
        const localY = -10.2;
        const p = toWorld(sx * (w / 2 - 2.8), localY, z);
        const topY = p.y + 0.4; // sink slightly into the wood for a solid joint
        const legH = Math.max(2, topY);
        const legGeo = new THREE.BoxGeometry(STAND.legWidth, legH, STAND.legDepth);
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(p.x, topY - legH / 2, p.z);
        leg.castShadow = true;
        this.scene.add(leg);
        this._disposables.push(legGeo);

        const foot = new THREE.Mesh(footGeo, footMat);
        foot.position.set(p.x, 0.6, p.z);
        foot.castShadow = true;
        this.scene.add(foot);
      }
    }
    this._disposables.push(footGeo, footMat, legMat);

    // --- back cross brace --------------------------------------------------
    const braceY = 16;
    const braceGeo = new THREE.BoxGeometry(w - 4, 2.2, 2.2);
    const brace = new THREE.Mesh(braceGeo, legMat);
    const backLeg = toWorld(0, -10.2, STAND.legZ[0]);
    brace.position.set(0, braceY, backLeg.z);
    brace.castShadow = true;
    this.scene.add(brace);
    this._disposables.push(braceGeo);

    // --- ground ------------------------------------------------------------
    const groundGeo = new THREE.PlaneGeometry(STAND.groundSize, STAND.groundSize);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = plastic(PALETTE.ground, { roughness: 0.95, emissive: 0.0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, 0, 20);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this._disposables.push(groundGeo, groundMat);

    // One red plastic night-market stool in front, matching how the machines
    // are actually presented on a shared metal rack.
    const stoolSeatGeo = new THREE.CylinderGeometry(8.0, 7.5, 2.0, 24);
    const stoolMat = plastic(0xd6323b, { roughness: 0.62, emissive: 0.02 });
    const stoolSeat = new THREE.Mesh(stoolSeatGeo, stoolMat);
    stoolSeat.position.set(-28, 14, 75);
    stoolSeat.castShadow = true;
    this.scene.add(stoolSeat);
    const stoolLegGeo = new THREE.BoxGeometry(2.2, 13, 2.2);
    for (const [x, z] of [[-32, 72], [-24, 72], [-32, 78], [-24, 78]]) {
      const leg = new THREE.Mesh(stoolLegGeo, stoolMat);
      leg.position.set(x, 6.5, z);
      leg.castShadow = true;
      this.scene.add(leg);
    }
    this._disposables.push(stoolSeatGeo, stoolLegGeo, stoolMat);
  },
};
