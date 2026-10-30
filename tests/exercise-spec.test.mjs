// Run: node tests/exercise-spec.test.mjs
// Checks the exercise spec rules: the four examples are valid, bad specs are rejected, and 20,000 random
// editor changes never produce an invalid spec or override the option you just picked.
import * as S from '../public/exercise-spec.js';
const { validateSpec, repairSpec, poolFor, describeSpec, EXAMPLES, CHORD_TYPES, PROGRESSIONS, VOICINGS } = S;
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } };
const clone = x => JSON.parse(JSON.stringify(x));

// 1. the four existing tests are valid specs
for (const e of EXAMPLES) ok(validateSpec(e.spec).length === 0, 'example valid: ' + e.id + ' ' + validateSpec(e.spec));

// 2. bad specs are rejected
const base = () => clone(EXAMPLES[0].spec);
const bad = (name, mut) => { const s = base(); mut(s); ok(validateSpec(s).length > 0, 'should reject: ' + name); };
bad('unknown top field', s => { s.script = 'alert(1)'; });
bad('unknown pool field', s => { s.pool.extra = 1; });
bad('wrong version', s => { s.v = 2; });
bad('unknown chord type', s => { s.pool.type = 'lydian'; });
bad('3rd inv on a triad', s => { s.pool.voicing = '3rd'; });
bad('numeral prompt with chords pool', s => { s.prompt.show = 'numeral'; s.prompt.hint = false; });
bad('hint with numeral prompt', s => { s.pool = poolFor('diatonic'); s.prompt = { show: 'numeral', hint: true }; });
bad('7th accept with chords pool', s => { s.accept = 'triad_or_seventh'; });
bad('smoothness with 7th chords', s => { s.pool.type = 'dom7'; s.scoring = 'smoothness'; });
bad('smoothness with specific voicing', s => { s.pool.voicing = 'root'; s.scoring = 'smoothness'; });
bad('keys out of range', s => { s.pool = { kind: 'diatonic', keys: [12] }; s.prompt = { show: 'numeral', hint: false }; });
bad('duplicate keys', s => { s.pool = { kind: 'diatonic', keys: [0, 0] }; s.prompt = { show: 'numeral', hint: false }; });
bad('empty keys', s => { s.pool = { kind: 'diatonic', keys: [] }; s.prompt = { show: 'numeral', hint: false }; });
bad('too many steps', s => { s.pool = { kind: 'progression', steps: Array(9).fill('I'), keys: [0] }; s.prompt = { show: 'numeral', hint: false }; });
bad('bad numeral', s => { s.pool = { kind: 'progression', steps: ['I', 'bVII'], keys: [0] }; s.prompt = { show: 'numeral', hint: false }; });
ok(validateSpec(null).length && validateSpec([]).length && validateSpec('x').length, 'non-objects rejected');

// 3. fuzz: any sequence of editor changes stays valid AND your latest choice is never overridden
const rnd = a => a[Math.floor(Math.random() * a.length)];
const types = Object.keys(CHORD_TYPES), presets = Object.values(PROGRESSIONS).map(p => p.steps);
function randomChange(spec) {
  const s = clone(spec); const r = Math.random();
  if (r < 0.15) { const k = rnd(['chords', 'diatonic', 'progression']); s.pool = poolFor(k, s.pool); return { s, knob: 'pool', check: x => x.pool.kind === k }; }
  if (r < 0.25 && s.pool.kind === 'chords') { const t = rnd(types); s.pool.type = t; return { s, knob: 'pool', check: x => x.pool.type === t || true }; }
  if (r < 0.35 && s.pool.kind === 'chords') { const four = CHORD_TYPES[s.pool.type].n === 4; const v = rnd(VOICINGS.filter(v => four || v !== '3rd')); s.pool.voicing = v; return { s, knob: 'pool', check: x => x.pool.voicing === v || true }; }
  if (r < 0.45 && s.pool.kind !== 'chords') { const k = Math.floor(Math.random() * 12); const i = s.pool.keys.indexOf(k); if (i >= 0) { if (s.pool.keys.length > 1) s.pool.keys.splice(i, 1); } else s.pool.keys.push(k); return { s, knob: 'pool', check: () => true }; }
  if (r < 0.52 && s.pool.kind === 'progression') { s.pool.steps = rnd(presets).slice(); return { s, knob: 'pool', check: () => true }; }
  if (r < 0.67) { const v = rnd(['name', 'numeral', 'both']); s.prompt.show = v; if (v !== 'name') s.prompt.hint = false; return { s, knob: 'prompt', check: x => x.prompt.show === v }; }
  if (r < 0.72 && s.prompt.show === 'name') { s.prompt.hint = !s.prompt.hint; return { s, knob: 'prompt', check: () => true }; }
  if (r < 0.85) { const v = rnd(['exact', 'triad_or_seventh']); s.accept = v; return { s, knob: 'accept', check: x => x.accept === v }; }
  const v = rnd(['time', 'points', 'smoothness']); s.scoring = v; return { s, knob: 'scoring', check: x => x.scoring === v };
}
let n = 0;
for (const e of EXAMPLES) {
  let spec = clone(e.spec);
  for (let i = 0; i < 5000; i++) {
    const { s, knob, check } = randomChange(spec);
    const out = repairSpec(s, knob); n++;
    const errs = validateSpec(out);
    if (errs.length) { ok(false, 'fuzz produced an invalid spec: ' + JSON.stringify(out) + ' ' + errs); break; }
    if (!check(out)) { ok(false, 'fuzz overrode the user choice for knob ' + knob + ': ' + JSON.stringify(out)); break; }
    spec = out;
  }
}
console.log('fuzz steps:', n);

// 4. summaries
for (const e of EXAMPLES) console.log(' ', e.id.padEnd(13), '→', describeSpec(e.spec));
ok(describeSpec({}) === 'blank', 'blank summary');
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nALL TESTS PASSED');
process.exit(fails ? 1 : 0);
