// en catalogue, namespace 'data': names and texts of the built-in data (muscles, seed exercises, the
// split library). The English text lives in the data files themselves (src/core/muscles.js,
// src/data/exercises.js, src/data/splits.js), which stay the single source: this catalogue is built from
// them, so the stored seed names, the tests and docs/SPLITS.md never drift from the English keys.
// de/zh catalogues are plain literal objects with exactly these keys (tests/data-i18n.test.js).
//
// Keys (ids in camelCase because keys are dot-separated camelCase; see dataKey()):
//   data.muscle.<id>                 'data.muscle.quads'
//   data.exercise.<seed slug>        'seed:bench-press' → 'data.exercise.benchPress'
//   data.equipment.<type>            exercise equipment type (barbell, dumbbell, machine, cable, bodyweight, other)
//   data.style.<id> / data.level.<id> / data.place.<id>   split library filters (STYLES, LEVELS, EQUIPMENT)
//   data.split.<id>.name / .suits / .bullet1 / .bullet2   'fb3-b' → 'data.split.fb3B.name'
//   data.session.<session id>        day names in the library ('upper-a' → 'data.session.upperA')
//   data.splitGuide.*                shared "How to run it" lines, disclaimer, basis (Licences screen)
//   data.bodyMap.*                   accessible names of the body map (src/ui/bodymap.js)
import { MUSCLES } from '../../core/muscles.js';
import { SEED_EXERCISES } from '../../data/exercises.js';
import { SPLITS, STYLES, LEVELS, EQUIPMENT, SHARED_BULLETS, SPLIT_BASIS, SPLIT_DISCLAIMER } from '../../data/splits.js';

/** 'seed:bench-press' / 'fb3-b' → 'benchPress' / 'fb3B' (key segment). */
export const dataKey = (id) => String(id).replace(/^seed:/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const out = {};
for (const m of MUSCLES) out[`data.muscle.${m.id}`] = m.name;
for (const e of SEED_EXERCISES) out[`data.exercise.${dataKey(e.id)}`] = e.name;
Object.assign(out, {
  'data.equipment.barbell': 'Barbell',
  'data.equipment.dumbbell': 'Dumbbell',
  'data.equipment.machine': 'Machine',
  'data.equipment.cable': 'Cable',
  'data.equipment.bodyweight': 'Bodyweight',
  'data.equipment.other': 'Other',
});
for (const s of STYLES) out[`data.style.${dataKey(s.id)}`] = s.label;
for (const l of LEVELS) out[`data.level.${dataKey(l.id)}`] = l.label;
for (const q of EQUIPMENT) out[`data.place.${dataKey(q.id)}`] = q.label;
for (const sp of SPLITS) {
  const k = `data.split.${dataKey(sp.id)}`;
  out[`${k}.name`] = sp.name;
  out[`${k}.suits`] = sp.suits;
  sp.bullets.forEach((b, i) => { out[`${k}.bullet${i + 1}`] = b; });
  for (const ses of sp.sessions) out[`data.session.${dataKey(ses.id)}`] = ses.name;
}
SHARED_BULLETS.forEach((b, i) => { out[`data.splitGuide.bullet${i + 1}`] = b; });
SPLIT_BASIS.forEach((b, i) => { out[`data.splitGuide.basis${i + 1}`] = b; });
out['data.splitGuide.disclaimer'] = SPLIT_DISCLAIMER;
Object.assign(out, {
  'data.bodyMap.front': 'Body map, front',
  'data.bodyMap.back': 'Body map, back',
  'data.bodyMap.both': 'Body map, front and back',
});

export default out;
