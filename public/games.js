// The games anyone can play on the Games page. Each one is an exercise spec (see exercise-spec.js) plus a title and a blurb.
// Only games the player can run belong here. The Games page and the play page both read this list.
// defaults = the starting settings (timed on or off, reps = how many notes or chords per game); repOptions = the rep choices offered.
import { EXAMPLES, noteSpec } from './exercise-spec.js';

export const GAMES = [
  { id: 'chords', title: 'Chord race',
    blurb: 'Major chords on every root. Play each one as fast as you can.',
    spec: EXAMPLES.find(x => x.id === 'chords').spec,
    defaults: { timed: true, reps: 12 }, repOptions: [12, 24, 48, 96] },
  { id: 'notes', title: 'Note recognition',
    blurb: 'A note on the staff, treble or bass, naturals, sharps and flats. Find it on your keyboard.',
    spec: noteSpec(),
    defaults: { timed: false, reps: 20, clef: 'treble' }, repOptions: [10, 20, 50, 100] },
];
