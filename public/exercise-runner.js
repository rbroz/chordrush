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
import { noteChoices } from './exercise-spec.js';

// A raw MIDI message is [status, key, velocity]. Only a "note on" with velocity above 0 is a key strike
// (many keyboards send note-off as note-on with velocity 0, and we ignore those too).
export function noteOnFrom(data) {
  if (!data || data.length < 3) return null;
  const [status, key, velocity] = data;
  return (status & 0xF0) === 0x90 && velocity > 0 ? key : null;
}

// the name of a key as you'd say it, with the octave (60 = C4, middle C). Black keys use sharps.
const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const keyName = key => KEY_NAMES[((key % 12) + 12) % 12] + (Math.floor(key / 12) - 1);

export const isRestartKey = e => !!e && (e.code === 'Space' || e.key === ' ');

export function createNoteRunner(spec, rng = Math.random) {
  if (!spec || !spec.pool || spec.pool.kind !== 'note') throw new Error('createNoteRunner needs a note exercise');
  const choices = noteChoices();
  let target = null, right = 0, attempts = 0, last = null, lastKey = null;   // last = 'right' | 'miss' | null (nothing played yet)

  // a random note, but never the same key as `avoid` (so you can't just hit the same key twice)
  function pick(avoid) {
    const pool = avoid == null ? choices : choices.filter(n => n.midi !== avoid);
    return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  }
  const snapshot = () => ({ target, right, attempts, last, lastKey, accuracy: attempts ? Math.round(100 * right / attempts) : null });

  function restart() { right = 0; attempts = 0; last = null; lastKey = null; target = pick(null); return snapshot(); }
  function press(key) {
    if (!Number.isInteger(key)) return snapshot();
    attempts++; lastKey = key;
    if (key === target.midi) { right++; last = 'right'; target = pick(target.midi); }
    else last = 'miss';
    return snapshot();
  }

  restart();
  return { restart, press, state: snapshot };
}
