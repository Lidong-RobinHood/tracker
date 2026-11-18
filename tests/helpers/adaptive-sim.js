// Deterministic simulator of a person for the adaptive-target tests. No Math.random.
// True mass follows energy balance at 7700 kcal/kg; the scale adds noise (water, clothes, scale).
import { addDays } from '../../src/core/dates.js';

/** mulberry32 seeded PRNG → () => [0, 1) */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export const START = '2026-01-05'; // a Monday

/**
 * Simulate `days` days. Each day d: morning weigh-in (maybe skipped), then the day's eating.
 * @param {object} o
 * @param {number} o.seed
 * @param {number} o.days
 * @param {number} [o.tdee=2500]           true expenditure
 * @param {number} [o.stepDay]             from this day on the true expenditure changes by stepKcal
 * @param {number} [o.stepKcal=0]
 * @param {number} [o.kcalPerKgMass=0]     expenditure changes by this per kg of mass change (adaptation)
 * @param {number} [o.offset=0]            mean eating = true expenditure (at day 0) + offset
 * @param {(day: number, sim: object) => number} [o.eat]  planned intake for a day (overrides offset)
 * @param {number} [o.intakeSd=300]        day-to-day variation of what is eaten
 * @param {number} [o.weightSd=0.5]        scale/water noise sd (kg)
 * @param {number} [o.missWeigh=0]         probability a weigh-in is skipped
 * @param {number} [o.missLog=0]           probability a day is not logged at all
 * @param {number} [o.underLog=0]          probability a day is only partly logged (30 % of it)
 * @param {Record<number, number>} [o.weightSpikes]  day → extra kg on the scale that morning
 * @param {Record<number, number>} [o.eatOverride]   day → kcal actually eaten (and logged)
 * @param {Record<number, number>} [o.logOverride]   day → kcal logged (eaten stays normal)
 * @param {number} [o.mass0=85]
 */
export function simulate(o) {
  const rand = prng(o.seed);
  const randW = prng(o.seed * 7919 + 1); // separate streams so an override does not shift the noise
  const randM = prng(o.seed * 104729 + 3);
  const tdee0 = o.tdee ?? 2500;
  const sim = { weights: [], intake: [], mass: [], trueTdee: [], eaten: [] };
  let mass = o.mass0 ?? 85;
  const mass0 = mass;
  for (let d = 0; d < o.days; d++) {
    const date = addDays(START, d);
    const T = tdee0 + (o.stepDay !== undefined && d >= o.stepDay ? (o.stepKcal || 0) : 0)
      + (o.kcalPerKgMass || 0) * (mass - mass0);
    sim.mass.push(mass);
    sim.trueTdee.push(T);
    // weigh-in (noise drawn every day so skipping does not shift the stream)
    const noise = gauss(randW) * (o.weightSd ?? 0.5);
    const skipW = randM() < (o.missWeigh || 0);
    if (!skipW) sim.weights.push({ date, kg: Math.round((mass + noise + ((o.weightSpikes || {})[d] || 0)) * 10) / 10 });
    // eating
    const planned = o.eat ? o.eat(d, sim) : tdee0 + (o.offset || 0);
    let eaten = Math.max(0, planned + gauss(rand) * (o.intakeSd ?? 300));
    if (o.eatOverride && o.eatOverride[d] !== undefined) eaten = o.eatOverride[d];
    sim.eaten.push(eaten);
    const skipL = randM() < (o.missLog || 0);
    const under = randM() < (o.underLog || 0);
    let logged = under ? eaten * 0.3 : eaten;
    if (o.logOverride && o.logOverride[d] !== undefined) logged = o.logOverride[d];
    if (!skipL) sim.intake.push({ date, kcal: Math.round(logged) });
    mass += (eaten - T) / 7700;
  }
  return sim;
}

/** Date of simulation day d. */
export const dayDate = (d) => addDays(START, d);

export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
