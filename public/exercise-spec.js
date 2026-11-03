// ChordRush exercise spec, version 1.
//
// An exercise is DATA, never code. It picks one option per "knob":
//   pool     what comes up        (a chord type × 12 roots, a key's diatonic chords, a progression across keys,
//                                  or single notes on the treble staff in the key of C)
//   prompt   what you see         (chord name, roman numeral, or both; optional keyboard hint; or the staff, for notes)
//   accept   what counts          (the exact chord, or the triad OR its diatonic 7th)
//   scoring  how it is judged     (time + accuracy, points, voice-leading smoothness; or right/attempts for notes)
//
// Everything is checked against the fixed lists below, so a spec can carry nothing except these choices.
// The four existing ChordRush tests are four points in this space (see EXAMPLES).

export const SPEC_VERSION = 1;
export const ROOT_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];   // index = pitch class

export const CHORD_TYPES = {   // n = number of notes; ivals = semitones above the root; suffix/sym = how the chord name is written
  major: { label: 'majors', n: 3, ivals: [0, 4, 7],     suffix: ' Major', sym: '' },
  minor: { label: 'minors', n: 3, ivals: [0, 3, 7],     suffix: ' minor', sym: 'm' },
  dim:   { label: 'dim',    n: 3, ivals: [0, 3, 6],     suffix: ' dim',   sym: '°' },
  aug:   { label: 'aug',    n: 3, ivals: [0, 4, 8],     suffix: ' aug',   sym: '+' },
  sus2:  { label: 'sus2',   n: 3, ivals: [0, 2, 7],     suffix: ' sus2',  sym: 'sus2' },
  sus4:  { label: 'sus4',   n: 3, ivals: [0, 5, 7],     suffix: ' sus4',  sym: 'sus4' },
  maj7:  { label: 'maj7',   n: 4, ivals: [0, 4, 7, 11], suffix: ' maj7',  sym: 'maj7' },
  min7:  { label: 'min7',   n: 4, ivals: [0, 3, 7, 10], suffix: ' m7',    sym: 'm7' },
  dom7:  { label: 'dom7',   n: 4, ivals: [0, 4, 7, 10], suffix: '7',      sym: '7' },
};
export const TYPE_GROUPS = [
  { label: 'triads', types: ['major', 'minor', 'dim', 'aug'] },
  { label: 'sus',    types: ['sus2', 'sus4'] },
  { label: '7ths',   types: ['maj7', 'min7', 'dom7'] },
];
export const VOICINGS = ['any', 'root', '1st', '2nd', '3rd'];
export const NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
export const PROGRESSIONS = {
  'I-V-vi-IV': { label: 'I–V–vi–IV', steps: ['I', 'V', 'vi', 'IV'] },   // pop "axis"
  'vi-IV-I-V': { label: 'vi–IV–I–V', steps: ['vi', 'IV', 'I', 'V'] },   // its rotation
  'I-IV-V':    { label: 'I–IV–V',    steps: ['I', 'IV', 'V'] },         // blues / rock / folk
  'ii-V-I':    { label: 'ii–V–I',    steps: ['ii', 'V', 'I'] },         // jazz cornerstone
};
const PROMPT_SHOWS = ['name', 'numeral', 'both', 'staff'];   // 'staff' = a note drawn on the treble clef (note pool only)
const ACCEPTS = ['exact', 'triad_or_seventh'];
const SCORINGS = ['time', 'points', 'smoothness', 'accuracy'];   // 'accuracy' = right / attempts (note pool only)
const ALL_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/* ---------- the note pool: single notes on the treble staff, A3 (two ledger lines below) to C6 (two above) ---------- */
// A note is a SPELLING (letter + accidental + octave), because a MIDI key can't tell C♯ from D♭. You play it on the keyboard,
// so either spelling of a black key is answered by the same key. E♯, B♯, C♭ and F♭ are left out (they'd be trick questions on a keyboard).
export const NOTE_MIN = 57;   // A3
export const NOTE_MAX = 84;   // C6
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARPABLE = ['C', 'D', 'F', 'G', 'A'], FLATTABLE = ['D', 'E', 'G', 'A', 'B'];   // letters that have a black key above / below them
// every note the pool can ask for (naturals, sharps and flats, no options): { midi, letter, acc (-1, 0, +1), octave, step (staff position: C4 = 28), name }
export function noteChoices() {
  const out = [];
  for (let octave = 3; octave <= 6; octave++) LETTERS.forEach((letter, i) => {
    for (const acc of [-1, 0, 1]) {
      if (acc === 0 ? false : acc > 0 ? !SHARPABLE.includes(letter) : !FLATTABLE.includes(letter)) continue;
      const midi = 12 * (octave + 1) + LETTER_PC[i] + acc;
      if (midi < NOTE_MIN || midi > NOTE_MAX) continue;
      out.push({ midi, letter, acc, octave, step: octave * 7 + i, name: letter + (acc > 0 ? '♯' : acc < 0 ? '♭' : '') + octave });
    }
  });
  return out;
}
export const noteRangeLabel = () => 'A3–C6';

const clone = x => JSON.parse(JSON.stringify(x));
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isKeyed = s => s.pool.kind === 'diatonic' || s.pool.kind === 'progression';   // these pools carry a key (so numerals and 7ths make sense)

/* ---------- the four existing tests, as specs ---------- */
export const EXAMPLES = [
  { id: 'chords', title: 'Chord drill',
    blurb: 'One chord type, all 12 roots. Play each as fast as you can.',
    spec: { v: 1, pool: { kind: 'chords', type: 'major', voicing: 'any' },
            prompt: { show: 'name', hint: true }, accept: 'exact', scoring: 'time' } },
  { id: 'diatonic', title: 'Diatonic',
    blurb: 'A roman numeral in a key. Play the chord it names.',
    spec: { v: 1, pool: { kind: 'diatonic', keys: [0] },
            prompt: { show: 'numeral', hint: false }, accept: 'exact', scoring: 'time' } },
  { id: 'voiceleading', title: 'Voice leading',
    blurb: 'Move through a key’s chords, moving your hand as little as possible.',
    spec: { v: 1, pool: { kind: 'diatonic', keys: [0] },
            prompt: { show: 'both', hint: false }, accept: 'exact', scoring: 'smoothness' } },
  { id: 'progressions', title: 'Progressions',
    blurb: 'A progression in each key you pick. Play the 7th for bonus points.',
    spec: { v: 1, pool: { kind: 'progression', steps: PROGRESSIONS['I-V-vi-IV'].steps.slice(), keys: ALL_KEYS.slice() },
            prompt: { show: 'numeral', hint: false }, accept: 'triad_or_seventh', scoring: 'points' } },
];

export const defaultSpec = () => clone(EXAMPLES[0].spec);
// the one exercise the editor page makes right now: single notes on the treble staff (A3 to C6, naturals, sharps and flats)
export const noteSpec = () => ({ v: SPEC_VERSION, pool: { kind: 'note' }, prompt: { show: 'staff', hint: false }, accept: 'exact', scoring: 'accuracy' });
export const isBlankSpec = s => s == null || (isObj(s) && Object.keys(s).length === 0);

/* ---------- validation: returns a list of problems (empty = valid) ---------- */
const onlyKeys = (o, allowed, where, errs) => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push(where + ': unknown field "' + k + '"');
};
const validKeys = a => Array.isArray(a) && a.length >= 1 && a.length <= 12
  && a.every(n => Number.isInteger(n) && n >= 0 && n <= 11) && new Set(a).size === a.length;

export function validateSpec(s) {
  if (!isObj(s)) return ['spec must be an object'];
  const errs = [];
  onlyKeys(s, ['v', 'pool', 'prompt', 'accept', 'scoring'], 'spec', errs);
  if (s.v !== SPEC_VERSION) errs.push('unsupported spec version');

  const p = s.pool;
  if (!isObj(p)) errs.push('pool is missing');
  else if (p.kind === 'chords') {
    onlyKeys(p, ['kind', 'type', 'voicing'], 'pool', errs);
    if (!CHORD_TYPES[p.type]) errs.push('pool: unknown chord type');
    if (!VOICINGS.includes(p.voicing)) errs.push('pool: unknown voicing');
    else if (p.voicing === '3rd' && CHORD_TYPES[p.type] && CHORD_TYPES[p.type].n !== 4) errs.push('pool: 3rd inversion only exists for 7th chords');
  } else if (p.kind === 'diatonic') {
    onlyKeys(p, ['kind', 'keys'], 'pool', errs);
    if (!validKeys(p.keys)) errs.push('pool: pick at least one key');
  } else if (p.kind === 'progression') {
    onlyKeys(p, ['kind', 'steps', 'keys'], 'pool', errs);
    if (!(Array.isArray(p.steps) && p.steps.length >= 2 && p.steps.length <= 8 && p.steps.every(n => NUMERALS.includes(n)))) errs.push('pool: a progression needs 2 to 8 roman numerals');
    if (!validKeys(p.keys)) errs.push('pool: pick at least one key');
  } else if (p.kind === 'note') {
    onlyKeys(p, ['kind'], 'pool', errs);   // nothing to configure: every note from A3 to C6, naturals, sharps and flats
  } else errs.push('pool: unknown kind');

  const pr = s.prompt;
  if (!isObj(pr)) errs.push('prompt is missing');
  else {
    onlyKeys(pr, ['show', 'hint'], 'prompt', errs);
    if (!PROMPT_SHOWS.includes(pr.show)) errs.push('prompt: unknown option');
    if (typeof pr.hint !== 'boolean') errs.push('prompt: hint must be true or false');
  }
  if (!ACCEPTS.includes(s.accept)) errs.push('accept: unknown option');
  if (!SCORINGS.includes(s.scoring)) errs.push('scoring: unknown option');
  if (errs.length) return errs;   // shapes are sound; now check the combination

  if (p.kind === 'note') {   // a note exercise is shown on the staff, must be the exact note, and is scored by accuracy
    if (pr.show !== 'staff') errs.push('a note exercise is shown on the staff');
    if (pr.hint) errs.push('the keyboard hint is for chord names only');
    if (s.accept !== 'exact') errs.push('a note must be played exactly');
    if (s.scoring !== 'accuracy') errs.push('a note exercise is scored by accuracy');
    return errs;
  }
  if (pr.show === 'staff') errs.push('the staff prompt needs the note pool');
  if (s.scoring === 'accuracy') errs.push('accuracy scoring needs the note pool');
  const keyed = isKeyed(s);
  if (pr.show !== 'name' && pr.show !== 'staff' && !keyed) errs.push('roman numerals need a diatonic or progression pool');
  if (pr.hint && pr.show !== 'name') errs.push('the keyboard hint only works with the chord-name prompt');
  if (s.accept === 'triad_or_seventh' && !keyed) errs.push('triad-or-7th needs a diatonic or progression pool');
  if (s.scoring === 'smoothness' && smoothnessInvalid(s)) errs.push('smoothness scoring needs 3-note chords, any voicing, and exact chords');
  return errs;
}

// voice-leading smoothness is only defined for sequences of triads where YOU choose the voicing
function smoothnessInvalid(s) {
  if (s.accept !== 'exact') return true;
  return s.pool.kind === 'chords' && (CHORD_TYPES[s.pool.type].n !== 3 || s.pool.voicing !== 'any');
}

/* ---------- editing helpers ---------- */
// default pool when switching kinds (keeps your keys when moving between diatonic and progression)
export function poolFor(kind, prev) {
  const keys = prev && Array.isArray(prev.keys) && validKeys(prev.keys) ? prev.keys.slice() : null;
  if (kind === 'note')        return { kind };
  if (kind === 'chords')      return { kind, type: 'major', voicing: 'any' };
  if (kind === 'diatonic')    return { kind, keys: keys || [0] };
  return { kind: 'progression', steps: PROGRESSIONS['I-V-vi-IV'].steps.slice(), keys: keys || ALL_KEYS.slice() };
}

// After you change ONE knob, bend the OTHER knobs so the whole spec stays valid.
// `changed` is the knob you just touched, so your choice always wins over the others.
export function repairSpec(spec, changed) {
  const s = clone(spec);
  if (s.pool.kind === 'note') {                                  // a note exercise has exactly one valid prompt / accept / scoring
    s.prompt = { show: 'staff', hint: false }; s.accept = 'exact'; s.scoring = 'accuracy';
    return s;
  }
  if (s.prompt.show === 'staff') s.prompt = isKeyed(s) ? { show: 'numeral', hint: false } : { show: 'name', hint: true };   // left the note pool
  if (s.scoring === 'accuracy') s.scoring = 'time';
  if (!isKeyed(s)) {
    if (changed === 'pool') {                                    // picked chords: numerals/7ths no longer apply
      if (s.prompt.show !== 'name') { s.prompt.show = 'name'; s.prompt.hint = true; }
      s.accept = 'exact';
    } else if ((changed === 'prompt' && s.prompt.show !== 'name') || (changed === 'accept' && s.accept !== 'exact')) {
      s.pool = poolFor('diatonic', null);                        // asked for numerals / 7ths: they need a key
    }
  }
  if (s.scoring === 'smoothness') {
    if (changed === 'scoring') {                                 // asked for smoothness: bend the pool and accept to fit
      if (s.pool.kind === 'chords') {
        if (CHORD_TYPES[s.pool.type].n !== 3) s.pool.type = 'major';
        s.pool.voicing = 'any';
      }
      s.accept = 'exact';
    } else if (smoothnessInvalid(s)) s.scoring = 'time';         // changed something else: smoothness no longer fits
  }
  if (s.pool.kind === 'chords' && s.pool.voicing === '3rd' && CHORD_TYPES[s.pool.type].n !== 4) s.pool.voicing = 'any';
  if (s.prompt.show !== 'name') s.prompt.hint = false;
  return s;
}

/* ---------- one-line summary for tiles ---------- */
export function describeSpec(s) {
  if (isBlankSpec(s)) return 'blank';
  if (validateSpec(s).length) return 'needs attention';
  const p = s.pool;
  if (p.kind === 'note') return 'treble · ' + noteRangeLabel() + ' · all notes · accuracy';
  let pool;
  if (p.kind === 'chords') {
    pool = CHORD_TYPES[p.type].label + ' · ' + (p.voicing === 'any' ? 'any voicing' : p.voicing === 'root' ? 'root' : p.voicing + ' inv');
  } else {
    const ks = p.keys.length === 12 ? 'all keys'
      : p.keys.length <= 3 ? p.keys.slice().sort((a, b) => a - b).map(k => ROOT_NAMES[k]).join(' ') : p.keys.length + ' keys';
    pool = (p.kind === 'diatonic' ? 'diatonic' : p.steps.join('–')) + ' · ' + ks;
  }
  return pool + ' · ' + s.scoring;
}
