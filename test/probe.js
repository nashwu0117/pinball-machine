/**
 * Test helpers that run *inside* the page.
 *
 * These are serialised into the browser by `run.js`, so they must not close
 * over anything from Node. They drive the game through its public API only.
 */

/**
 * Fire a long series of shots at a spread of plunger pulls, watching for stuck
 * balls, fly-outs and scoring mistakes the whole time.
 *
 * @param {import('puppeteer').Page} page
 */
export async function playManyShots(page) {
  // Keep this scoring series above the barrel threshold. Weak-return behaviour
  // has its own focused assertion in run.js and must not be counted as a shot.
  const powers = [9, 5, 9, 7.5, 5.2, 9, 5.5, 8.5, 6, 9, 5, 7, 9, 5.5, 8, 9, 5.8, 6.5, 9, 9.5];
  const LIMITS = { x: 30.5, zMin: -3, zMax: 74, yMax: 15 };

  const outcomes = [];
  const speeds = [];
  let stuckCount = 0;
  let outOfBounds = 0;
  let nudges = 0;
  let maxZ = -Infinity; let minZ = Infinity;
  let maxX = -Infinity; let minX = Infinity;
  let maxY = -Infinity;
  let wallPenetrations = 0;

  // One evaluate per shot: a single long evaluate starves the renderer in
  // software WebGL and crashes the tab, while short ones are stable.
  for (const pull of powers) {
    const ballsLeft = await page.evaluate(() => window.__pinball.game.balls);
    if (ballsLeft <= 0) break;
    let row;
    try {
      row = await page.evaluate(async (pull) => {
        const { game, machine, renderer, scene } = window.__pinball;
        window.__pinballTestDrive = true;
        renderer.shadowMap.enabled = false;
        scene.traverse((o) => { if (o.isLight) o.castShadow = false; });

        const dt = 1 / 60;
        async function advanceUntil(pred, maxSeconds) {
          const steps = Math.ceil(maxSeconds / dt);
          for (let i = 0; i < steps; i++) {
            if (pred()) return true;
            game.update(dt);
            if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
          }
          return pred();
        }

        if (game.state !== 'AIMING') {
          if (game.state === 'READY') game.pressStart();
          await advanceUntil(() => game.state === 'SPINNING', 2);
          for (let i = 0; i < 150 && game.state === 'SPINNING'; i++) {
            game.update(dt);
            if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
          }
          if (game.state === 'SPINNING') game.stopSpin();
          await advanceUntil(() => game.state === 'AIMING', 2);
        }
        const before = game.balls;
        const shotsBefore = game.shots;
        game.releasePlunger(pull);
        const speed = Math.round(machine.ballBody.velocity.length());

        let sawMove = false;
        let timedOut = false;
        let shotOutOfBounds = 0;
        let sMinX = Infinity; let sMaxX = -Infinity;
        let sMinZ = Infinity; let sMaxZ = -Infinity;
        let sMaxY = -Infinity;
        let shotWallPenetrations = 0;
        const maxSteps = 20 * 60;
        for (let i = 0; i < maxSteps; i++) {
          const p = machine.ballBody.position;
          sMinX = Math.min(sMinX, p.x); sMaxX = Math.max(sMaxX, p.x);
          sMinZ = Math.min(sMinZ, p.z); sMaxZ = Math.max(sMaxZ, p.z);
          sMaxY = Math.max(sMaxY, p.y);
          if (Math.abs(p.x) > 30.5 || p.z < -3 || p.z > 74 || p.y > 15) shotOutOfBounds += 1;
          // The sphere must remain inside the rail inner faces. This is a
          // stricter assertion than the broad out-of-bounds envelope above.
          const xLimit = 36 / 2 - 1.2 - 0.62;
          const zMin = 1.2 + 0.62;
          const zMax = 58 - 1.2 - 0.62;
          if (p.x < -xLimit - 0.02 || p.x > xLimit + 0.02
            || p.z < zMin - 0.02 || p.z > zMax + 0.02) shotWallPenetrations += 1;
          if (machine.ballBody.velocity.length() > 1) sawMove = true;
          game.update(dt);
          if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
          if (game.state !== 'IN_PLAY') break;
          if (i === maxSteps - 1) timedOut = true;
        }
        await advanceUntil(() => game.state !== 'RESOLVING', 4);

        return {
          row: {
            target: game.target,
            before,
            after: game.balls,
            result: game.lastResult?.type ?? null,
            value: game.lastResult?.value ?? null,
            lane: game.lastResult?.lane ?? null,
            moved: sawMove,
            returned: game.shots === shotsBefore,
          },
          speed,
          timedOut,
          shotOutOfBounds,
          wallPenetrations: shotWallPenetrations,
          bounds: { sMinX, sMaxX, sMinZ, sMaxZ, sMaxY },
        };
      }, pull);
    } catch (e) {
      outcomes.push({ error: String(e?.message ?? e) });
      break;
    }
    // A weak pull that returned to AIMING is a retry, not a completed shot.
    if (!row.row.returned) outcomes.push(row.row);
    speeds.push(row.speed);
    if (row.timedOut) stuckCount += 1;
    outOfBounds += row.shotOutOfBounds;
    maxX = Math.max(maxX, row.bounds.sMaxX); minX = Math.min(minX, row.bounds.sMinX);
    maxZ = Math.max(maxZ, row.bounds.sMaxZ); minZ = Math.min(minZ, row.bounds.sMinZ);
    maxY = Math.max(maxY, row.bounds.sMaxY);
    wallPenetrations += row.wallPenetrations;
  }

  const tail = await page.evaluate(() => {
    const { game } = window.__pinball;
    return {
      shots: game.shots, hits: game.hits, earned: game.earned, best: game.bestMultiplier,
      finalBalls: game.balls, state: game.state,
    };
  });

  return {
    outcomes, speeds, stuckCount, outOfBounds, nudges, wallPenetrations,
    bounds: { minX, maxX, minZ, maxZ, maxY },
    ...tail,
  };
}

/**
 * Launch the same full-power shot repeatedly and record where the ball first
 * crosses the pocket mouth. Identical results would mean the physics is
 * scripted, which the brief explicitly forbids.
 *
 * @param {import('puppeteer').Page} page
 */
export async function chaosTest(page) {
  const crossings = [];
  let abortError = null;
  const dt = 1 / 60;

  for (let i = 0; i < 10; i++) {
    let crossed = null;
    try {
      crossed = await page.evaluate(async (dt) => {
        const { machine } = window.__pinball;
        window.__pinballTestDrive = true;
        machine.loadBall();
        machine.launchBall(9.0);
        let found = null;
        let wentNorth = false;
        let anchor = null;
        let still = 0;
        let relaunches = 0;
        for (let step = 0; step < 25 * 60 && found == null; step++) {
          const p = machine.ballBody.position;
          if (p.z < 34) wentNorth = true;
          if (wentNorth && p.z > 45.5 && p.y < 3.4) found = p.x;
          if (!anchor) {
            anchor = { x: p.x, y: p.y, z: p.z };
          } else if (Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z) < 3.0) {
            still += dt;
          } else {
            still = 0;
            anchor = { x: p.x, y: p.y, z: p.z };
          }
          if (still > 3.0 && relaunches < 3) {
            relaunches += 1;
            still = 0;
            anchor = null;
            wentNorth = false;
            machine.loadBall();
            machine.launchBall(9.0);
          }
          machine.world.step(1 / 240, dt, 24);
          machine.syncBall();
          if (step % 12 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        return found;
      }, dt);
    } catch (e) {
      abortError = String(e?.message ?? e);
      break;
    }
    if (crossed != null) crossings.push(Number(crossed.toFixed(2)));
  }

  await page.evaluate(() => { window.__pinballTestDrive = false; });
  const uniq = new Set(crossings.map((c) => Math.round(c)));
  return { crossings, uniq: uniq.size, abortError };
}

/** Measure the frame pacing under software WebGL. */
export function measureFrames(page) {
  return page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    return {
      median: frames[Math.floor(frames.length / 2)],
      p95: frames[Math.floor(frames.length * 0.95)],
    };
  });
}

/** Poll the page's live shot log and print new entries as they appear. */
export async function streamShots(page, stopWhen) {
  let seen = 0;
  while (!stopWhen()) {
    const log = await page.evaluate(() => window.__shotLog ?? []).catch(() => []);
    while (seen < log.length) {
      const r = log[seen++];
      const label = r.result === 'win' ? `WIN ×${r.value} lane ${r.lane + 1}`
        : r.result === 'miss' ? `miss (lane ${r.lane + 1})` : r.result ?? '?';
      console.log(`      shot ${seen}: target=${r.target} balls ${r.before}->${r.after} ${label}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
export function inspectMachine(page) {
  return page.evaluate(() => {
    const { machine } = window.__pinball;
    let meshes = 0;
    let instanced = 0;
    machine.group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) meshes += 1;
      if (o.isInstancedMesh) instanced += 1;
    });
    return {
      meshes,
      instanced,
      bodies: machine.world.bodies.length,
      pegs: machine.pegBodies.length,
      bumpers: machine.bumperBodies.length,
      pockets: machine.pocketZones.length,
      leds: machine.ledMeshes.size,
      laneLeds: machine.laneLedMeshes?.length ?? 0,
    };
  });
}
