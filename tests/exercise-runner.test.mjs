// Run: node tests/exercise-runner.test.mjs
// Checks the note runner's rules: exact-key judging, hit/miss counting, accuracy, no immediate repeats, restart.
import { createNoteRunner, noteOnFrom, isRestartKey, keyName } from '../public/exercise-runner.js';
import { noteChoices, poolFor, EXAMPLES } from '../public/exercise-spec.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } };
const spec = { v: 1, pool: poolFor('note'), prompt: { show: 'staff', hint: false }, accept: 'exact', scoring: 'accuracy' };
const all = noteChoices();
const seeded = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;   // repeatable "random"

// 1. a fresh runner: a real note, nothing counted yet
let r = createNoteRunner(spec, seeded(1)), s = r.state();
ok(all.some(n => n.midi === s.target.midi && n.name === s.target.name), 'first target is one of the 39 notes');
ok(s.right === 0 && s.attempts === 0 && s.accuracy === null && s.last === null, 'starts at 0/0 with no accuracy yet');

// 2. a hit counts, and moves to a different key
let before = r.state().target;
s = r.press(before.midi);
ok(s.right === 1 && s.attempts === 1 && s.accuracy === 100 && s.last === 'right', 'hit: 1/1, 100%');
ok(s.target.midi !== before.midi, 'after a hit the next note is a different key');

// 3. a miss counts as an attempt, and the SAME note stays
before = r.state().target;
const wrong = before.midi === 60 ? 61 : 60;
s = r.press(wrong);
ok(s.right === 1 && s.attempts === 2 && s.accuracy === 50 && s.last === 'miss', 'miss: 1/2, 50%');
ok(s.target.midi === before.midi && s.target.name === before.name, 'after a miss the same note stays');
s = r.press(before.midi);
ok(s.right === 2 && s.attempts === 3 && s.accuracy === 67, 'then the hit lands: 2/3 rounds to 67%');

// 4. the octave is part of the answer; so are keys outside the range, and junk input
r = createNoteRunner(spec, seeded(2));
const t = r.state().target;
ok(r.press(t.midi + 12).last === 'miss', 'same letter one octave up is a miss');
ok(r.press(t.midi - 12).last === 'miss', 'same letter one octave down is a miss');
ok(r.press(0).last === 'miss', 'a key far outside the range is a miss');
const n = r.state().attempts;
ok(r.press(undefined).attempts === n && r.press(60.5).attempts === n && r.press('60').attempts === n, 'non-integer input is ignored, not counted');

// 5. enharmonics: C♯4 and D♭4 are one key, so either spelling is answered by it
for (const [a, b] of [['C♯4', 'D♭4'], ['F♯5', 'G♭5'], ['A♯3', 'B♭3']]) {
  const A = all.find(x => x.name === a), B = all.find(x => x.name === b);
  ok(A && B && A.midi === B.midi, a + ' and ' + b + ' are the same key');
}
// answer every black-key spelling with its key: aim the first pick at it (nothing to avoid on the first pick)
for (const note of all.filter(x => x.acc !== 0)) {
  const idx = all.findIndex(x => x.name === note.name);
  const aimed = createNoteRunner(spec, () => (idx + 0.5) / all.length);
  ok(aimed.state().target.name === note.name, 'aimed at ' + note.name + ' got ' + aimed.state().target.name);
  ok(aimed.press(note.midi).last === 'right', note.name + ' answered by its key');
}

// 6. restart wipes the score and picks a fresh note
r = createNoteRunner(spec, seeded(3));
for (let i = 0; i < 5; i++) r.press(r.state().target.midi);
r.press(0);
s = r.restart();
ok(s.right === 0 && s.attempts === 0 && s.accuracy === null && s.last === null, 'restart resets the counters');
ok(all.some(x => x.midi === s.target.midi), 'restart picks a valid note');

// 7. 20,000 random hits: never the same key twice in a row, and every one of the 39 notes shows up
r = createNoteRunner(spec, seeded(4));
const seen = new Set(); let repeats = 0;
for (let i = 0; i < 20000; i++) {
  const cur = r.state().target; seen.add(cur.name);
  r.press(cur.midi);
  const next = r.state().target.midi;
  if (next === cur.midi) repeats++;
}
ok(repeats === 0, 'no immediate repeats in 20,000 hits (got ' + repeats + ')');
ok(seen.size === 39, 'all 39 notes appear (saw ' + seen.size + ')');
// ...and with Math.random, not just my seeded one
r = createNoteRunner(spec);
let rep2 = 0;
for (let i = 0; i < 5000; i++) { const c = r.state().target.midi; r.press(c); if (r.state().target.midi === c) rep2++; }
ok(rep2 === 0, 'no immediate repeats with Math.random');

// 8. accuracy is always hits / attempts
r = createNoteRunner(spec, seeded(5));
let hits = 0, tries = 0;
for (let i = 0; i < 3000; i++) {
  const hit = Math.random() < 0.7; const cur = r.state().target;
  r.press(hit ? cur.midi : (cur.midi === 70 ? 71 : 70)); tries++; if (hit) hits++;
}
s = r.state();
ok(s.right === hits && s.attempts === tries && s.accuracy === Math.round(100 * hits / tries), 'counters match a tally kept outside the runner');

// 9. MIDI parsing: only a real key strike counts
ok(noteOnFrom([0x90, 60, 100]) === 60, 'note on');
ok(noteOnFrom([0x95, 72, 1]) === 72, 'note on, another channel, velocity 1');
ok(noteOnFrom([0x90, 60, 0]) === null, 'note on with velocity 0 is really a release');
ok(noteOnFrom([0x80, 60, 64]) === null, 'note off');
ok(noteOnFrom([0xB0, 64, 127]) === null, 'sustain pedal / control change');
ok(noteOnFrom([0xE0, 0, 64]) === null && noteOnFrom([0xF8]) === null && noteOnFrom(null) === null && noteOnFrom([]) === null, 'pitch bend, clock, null, empty');
ok(noteOnFrom(new Uint8Array([0x90, 64, 90])) === 64, 'works on the Uint8Array the browser actually sends');

// 10. spacebar restarts
ok(isRestartKey({ code: 'Space', key: ' ' }) && isRestartKey({ key: ' ' }) && isRestartKey({ code: 'Space' }), 'space is the restart key');
ok(!isRestartKey({ code: 'Enter', key: 'Enter' }) && !isRestartKey({ key: 'a' }) && !isRestartKey(null), 'other keys are not');

// 10b. the runner reports the last key you struck, and keys have names with octaves
ok(keyName(60) === 'C4' && keyName(72) === 'C5' && keyName(61) === 'C♯4' && keyName(57) === 'A3' && keyName(21) === 'A0' && keyName(0) === 'C-1', 'key names');
r = createNoteRunner(spec, seeded(6));
ok(r.state().lastKey === null, 'no last key before playing');
const tt = r.state().target.midi; r.press(tt === 60 ? 61 : 60);
ok(r.state().lastKey === (tt === 60 ? 61 : 60), 'a miss records the key you played');
r.press(tt); ok(r.state().lastKey === tt, 'a hit records it too');
r.restart(); ok(r.state().lastKey === null, 'restart clears it');

// 11. it only runs note exercises
for (const e of EXAMPLES) { let threw = false; try { createNoteRunner(e.spec); } catch { threw = true; } ok(threw, 'rejects the ' + e.id + ' exercise'); }
{ let threw = false; try { createNoteRunner(null); } catch { threw = true; } ok(threw, 'rejects null'); }

console.log(fails ? fails + ' FAILED' : 'ALL RUNNER TESTS PASSED');
process.exit(fails ? 1 : 0);
