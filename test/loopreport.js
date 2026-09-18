/** Checks that evaluate the results of a long series of shots. */

import { check } from './assert.js';

/**
 * @param {object} sim the object returned by `playManyShots`
 */
export function reportLoop(sim) {
  const resolved = sim.outcomes.filter((o) => o.result);
  const pocketed = resolved.filter((o) => o.result === 'score');

  check('multiple shots were fired', sim.outcomes.length >= 5, `${sim.outcomes.length} shots`);
  check('every shot moved the ball',
    sim.outcomes.every((o) => o.moved !== false),
    JSON.stringify(sim.outcomes.filter((o) => o.moved === false)));
  check('every shot resolved into a pocket or a drain',
    resolved.length === sim.outcomes.length, `${resolved.length}/${sim.outcomes.length}`);
  check('no permanently stuck ball',
    sim.stuckCount === 0, `${sim.stuckCount} timeouts, ${sim.nudges} recovery nudges`);
  check('ball never penetrated an outer wall', sim.wallPenetrations === 0,
    `${sim.wallPenetrations} wall penetrations`);
  check('ball never left the machine', sim.outOfBounds === 0,
    `x[${sim.bounds.minX.toFixed(1)}, ${sim.bounds.maxX.toFixed(1)}] `
    + `z[${sim.bounds.minZ.toFixed(1)}, ${sim.bounds.maxZ.toFixed(1)}] `
    + `ymax=${sim.bounds.maxY.toFixed(1)}`);
  check('balls land in scoring pockets', pocketed.length > 0, `${pocketed.length} pocketed`);

  const distinct = new Set(pocketed.map((o) => o.lane));
  check('balls do not all land in the same slot', distinct.size >= 2,
    `slots hit: ${[...distinct].sort((a, b) => a - b).join(', ')}`);

  console.log(`      shot log: ${resolved.map((o) => (
    o.result === 'win' ? `WIN×${o.value}@lane${o.lane + 1}`
      : o.result === 'miss' ? `miss(lane${o.lane + 1})` : 'drain'
  )).join(' ')}`);

  const scores = sim.outcomes.filter((o) => o.result === 'score');
  check('a scored hole records its multiplier',
    scores.every((o) => Number.isFinite(o.value)),
    `${scores.length} scored holes`);

  check('every committed shot costs exactly one ball',
    sim.outcomes.every((o) => o.after === o.before - 1),
    `${sim.outcomes.length} committed shots`);

  const range = Math.max(...sim.speeds) - Math.min(...sim.speeds);
  check('plunger power changes launch speed', range > 80,
    `speeds ${Math.min(...sim.speeds)}..${Math.max(...sim.speeds)} cm/s`);

  console.log(`      final: balls=${sim.finalBalls} state=${sim.state} `
    + `shots=${sim.shots} hits=${sim.hits} earned=${sim.earned} best=${sim.best}`);
}
