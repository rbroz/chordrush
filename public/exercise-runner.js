// ChordRush exercise runner: the rules of an exercise, with no screen and no MIDI hardware in it.
// The page feeds it key presses and draws whatever state it returns, so these rules can be tested in Node.
//
// For now it plays the NOTE pool only (one note on the treble staff; play that key on your keyboard).
//
// The rules:
//   - a note is judged on its exact MIDI key, so the octave matters. C♯4 and D♭4 are the same key, so either one answers either.
//   - every key you strike counts as one attempt. The right key is a hit; any other key is a miss.
//   - after a hit you get a new note (never the same key twice in a row). After a miss the SAME note stays until you find it.
//   - accuracy = hits / attempts, rounded to a whole percent.
//   - the game is over after `reps` hits (default 20; Infinity = never). The clock starts at your first key and stops at the last hit.
import { noteChoices, CHORD_TYPES, ROOT_NAMES } from './exercise-spec.js';

// A raw MIDI message is [status, key, velocity]. Only a "note on" with velocity above 0 is a key strike
// (many keyboards send note-off as note-on with velocity 0, and we ignore those too).
export function noteOnFrom(data) {
  if (!data || data.length < 3) return null;
  const [status, key, velocity] = data;
  return (status & 0xF0) === 0x90 && velocity > 0 ? key : null;
}

// a key release: note-off, or note-on with velocity 0 (that is how many keyboards send a release)
export function noteOffFrom(data) {
  if (!data || data.length < 3) return null;
  const [status, key, velocity] = data;
  const cmd = status & 0xF0;
  return cmd === 0x80 || (cmd === 0x90 && velocity === 0) ? key : null;
}

// the name of a key as you'd say it, with the octave (60 = C4, middle C). Black keys use sharps.
const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const keyName = key => KEY_NAMES[((key % 12) + 12) % 12] + (Math.floor(key / 12) - 1);

export const isRestartKey = e => !!e && (e.code === 'Space' || e.key === ' ');

export function createNoteRunner(spec, rng = Math.random, options = {}) {
  if (!spec || !spec.pool || spec.pool.kind !== 'note') throw new Error('createNoteRunner needs a note exercise');
  const choices = noteChoices(spec.pool.clef);   // treble unless the spec says bass
  const reps = options.reps === undefined ? 20 : options.reps;
  let target = null, right = 0, attempts = 0, last = null, lastKey = null, startT = null, endT = null, done = false;   // last = 'right' | 'miss' | null (nothing played yet)

  // a random note, but never the same key as `avoid` (so you can't just hit the same key twice)
  function pick(avoid) {
    const pool = avoid == null ? choices : choices.filter(n => n.midi !== avoid);
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }
  const snapshot = (now = 0) => ({
    target, right, attempts, last, lastKey, reps, done,
    accuracy: attempts ? Math.round(100 * right / attempts) : null,
    elapsedMs: startT === null ? 0 : done ? endT - startT : Math.max(0, now - startT),
    totalMs: done ? endT - startT : null,
  });

  function restart() { right = 0; attempts = 0; last = null; lastKey = null; startT = null; endT = null; done = false; target = pick(null); return snapshot(); }
  // `t` is when the key was struck, in milliseconds (the clock only matters if the page shows a timer)
  function press(key, t = 0) {
    if (done || !Number.isInteger(key)) return snapshot(t);
    if (startT === null) startT = t;
    attempts++; lastKey = key;
    if (key === target.midi) {
      right++; last = 'right';
      if (right >= reps) { done = true; endT = t; target = null; }
      else target = pick(target.midi);
    } else last = 'miss';
    return snapshot(t);
  }

  restart();
  return { restart, press, state: snapshot };
}


/* ---------- the chord race ---------- */
// The same rules as the Test page (index.html), written so Node can test them: nothing here reads a clock or a timer.
// The page tells the runner what happened and WHEN (a millisecond time), and the runner says what that meant.
//   - a chord is matched on its exact set of pitch classes: every chord tone held, nothing else (octaves don't matter)
//   - a specific voicing also needs the right note in the bass (the lowest key held); "any" voicing has no bass rule
//   - the chord must land all at once: the first key opens an 80 ms window, and if the held keys are still not exactly the chord when
//     it closes, that is one miss (a stray note, a wrong voicing, or a chord built up in pieces)
//   - the first chord you play correctly is the go-signal: it starts the clock and does not count toward the time
//   - misses only count once the clock is running; accuracy = chords / (chords + misses)
export const GRASP_WINDOW_MS = 80;
const INV_INDEX = { root: 0, '1st': 1, '2nd': 2, '3rd': 3 };
export const INV_LABEL = ['root', '1st inv', '2nd inv', '3rd inv'];

// one chord: { name, type, inv, pcs, rootPc, bass? }. pcs = its pitch classes (root first); bass = the pitch class that must be lowest
export function chordFor(rootPc, type, inv, anyVoicing) {
  const T = CHORD_TYPES[type];
  const pcs = T.ivals.map(i => (rootPc + i) % 12);
  const root = ROOT_NAMES[rootPc];
  if (anyVoicing) return { name: root + T.suffix, type, inv: 0, pcs, rootPc };                    // no bass requirement
  if (!inv) return { name: root + T.suffix, type, inv: 0, pcs, rootPc, bass: rootPc };            // root position: the root is lowest
  const bass = (rootPc + T.ivals[inv]) % 12;
  return { name: root + T.sym + '/' + ROOT_NAMES[bass], type, inv, pcs, rootPc, bass };           // inversion, written like "G/B"
}
const shuffle = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// the chords of one run: `reps` chords drawn from the chosen type on all 12 roots, in the chosen voicing.
// Each pass through the 12 roots is shuffled, so every root comes up equally often; two in a row are never the same chord.
export function buildChordOrder(spec, rng = Math.random, reps = 12) {
  const { type, voicing } = spec.pool;
  const list = [];
  for (let pc = 0; pc < 12; pc++) list.push(voicing === 'any' ? chordFor(pc, type, 0, true) : chordFor(pc, type, INV_INDEX[voicing], false));
  const out = [];
  while (out.length < reps) {
    const bag = shuffle(list, rng);
    if (out.length && bag[0].rootPc === out[out.length - 1].rootPc) [bag[0], bag[1]] = [bag[1], bag[0]];   // no repeat across two passes
    for (const c of bag) if (out.length < reps) out.push(c);
  }
  return out;
}

// which specs this runner can play: chords, the exact chord, scored on time (+ accuracy)
export const canRunChords = spec => !!spec && !!spec.pool && spec.pool.kind === 'chords' && spec.accept === 'exact' && spec.scoring === 'time';

// Every method returns a list of events, in order: 'miss', 'advance' (a chord landed), 'start' (the first chord, the go-signal), 'done'.
export function createChordRunner(spec, rng = Math.random, options = {}) {
  if (!canRunChords(spec)) throw new Error('createChordRunner needs a chords exercise scored on time');
  const reps = Math.max(2, options.reps === undefined ? 12 : options.reps);   // the first chord is the go-signal, so a run needs at least two
  let order, idx, phase, held, deadline, startT, completions, missesAt, wrong, curMisses;

  function restart() {
    order = buildChordOrder(spec, rng, reps); idx = 0; phase = 'ready'; deadline = null; startT = 0;
    completions = []; missesAt = []; wrong = 0; curMisses = 0;
    if (!held) held = new Set();   // keys still down across a restart stay down
    return [];
  }
  const live = () => phase === 'ready' || phase === 'running';

  // the 80 ms window closed: if keys are still down and it never became the chord, that is a miss
  function settle(t, ev) {
    if (deadline === null || t < deadline) return;
    deadline = null;
    if (held.size > 0 && phase === 'running') { wrong++; curMisses++; ev.push('miss'); }
  }
  // do the held keys make exactly the target chord?
  function matches() {
    if (!held.size) return false;
    const chord = order[idx], keys = [...held];
    const pcs = new Set(keys.map(k => k % 12)), want = new Set(chord.pcs);
    if (pcs.size !== want.size) return false;
    for (const p of want) if (!pcs.has(p)) return false;
    if (chord.bass != null && Math.min(...keys) % 12 !== chord.bass) return false;   // right notes, wrong voicing
    return true;
  }
  function land(t, ev) {
    deadline = null;
    if (phase === 'ready') {                       // the go-signal: starts the clock, does not count toward the time
      startT = t; completions = [t]; missesAt[0] = 0; curMisses = 0; phase = 'running'; idx = 1; ev.push('start');
      return;
    }
    missesAt[idx] = curMisses; curMisses = 0; completions.push(t); idx++;
    ev.push('advance');
    if (idx >= order.length) { phase = 'done'; ev.push('done'); }
  }
  function after(t, ev) {                            // a key changed: did that make the chord?
    if (!live()) return;
    if (matches()) land(t, ev);
    else if (held.size === 0) deadline = null;
  }
  function keyDown(key, t) {
    const ev = []; settle(t, ev);
    held.add(key);
    if (live()) { const before = ev.length; after(t, ev); if (ev.length === before && held.size > 0) deadline = t + GRASP_WINDOW_MS; }
    return ev;
  }
  function keyUp(key, t) { const ev = []; settle(t, ev); held.delete(key); after(t, ev); return ev; }
  function tick(t) { const ev = []; settle(t, ev); return ev; }

  function state(now) {
    const total = order.length, finished = phase === 'done';
    const totalMs = finished ? completions[completions.length - 1] - startT : null;
    return {
      phase, idx, total, target: finished ? null : order[idx], misses: wrong,
      elapsedMs: phase === 'running' ? Math.max(0, now - startT) : totalMs === null ? 0 : totalMs,
      totalMs, accuracy: finished ? Math.round(total / (total + wrong) * 100) : null,
      results: order.map((c, i) => ({ name: c.name, ms: i === 0 || i >= completions.length ? null : completions[i] - completions[i - 1], misses: missesAt[i] || 0 })),
    };
  }
  restart();
  return { restart, keyDown, keyUp, tick, state };
}
