// The games anyone can play on the Games page. Each one is an exercise spec (see exercise-spec.js) plus a title and a blurb.
// Only games the player can run belong here. The Games page and the play page both read this list.
import { EXAMPLES, noteSpec } from './exercise-spec.js';

export const GAMES = [
  { id: 'chords', title: 'Chord race',
    blurb: 'A major chord on every root. Play each one as fast as you can.',
    spec: EXAMPLES.find(x => x.id === 'chords').spec },
  { id: 'notes', title: 'Note recognition',
    blurb: 'A note on the treble staff, naturals, sharps and flats. Find it on your keyboard.',
    spec: noteSpec() },
];
