// ChordRush staff drawing: a treble or bass staff with ONE whole note, as an SVG string. Plain SVG, no library.
//
// Everything is measured in "line spacings" (LS = the gap between two staff lines). A note's vertical spot is its
// `step`: C4 = 28, D4 = 29 ... one step is half a line spacing.
//   treble: E4 (step 30) is the bottom line, F5 (step 38) the top. Notes A3 (26) to C6 (42) need up to two ledger lines each way.
//   bass:   G2 (step 18) is the bottom line, A3 (step 26) the top. Notes C2 (14) to E4 (30) need up to two ledger lines each way.
// Both staves are drawn in the same place on the page, so switching clefs doesn't move anything.
//
// Colors come from CSS (currentColor), so the staff follows the page theme.

const LS = 16;                          // pixels between staff lines
const W = 560, H = 270;                 // viewBox
const X0 = 28, X1 = 532;                // where the five lines start and end
const Y_TOP = 96;                       // y of the top line (F5, step 38)
const NOTE_X = 330;                     // the note's horizontal centre
const CLEF_STAFF = {                    // top / bottom staff line (as steps), and the line the clef curls around
  treble: { top: 38, bottom: 30, clefLine: 32 },   // G4
  bass:   { top: 26, bottom: 18, clefLine: 24 },   // F3
};
const yOf = (step, c) => Y_TOP + (c.top - step) * LS / 2;

// the treble clef, drawn as one stroke. Coordinates are in line spacings; (0,0) is the G line it curls around,
// so the staff lines are at y = -3 (top) ... +1 (bottom). It is placed so that point sits on the real G line (step 32).
const CLEF = 'M -0.5 2.3 C -0.5 3.0, 0.7 3.1, 0.62 2.0 L 0.12 -3.3 '
           + 'C -0.12 -4.7, 1.15 -4.75, 0.92 -3.35 C 0.72 -2.2, -0.65 -1.55, -0.95 -0.45 '
           + 'C -1.25 0.95, 0.65 1.35, 0.9 0.1 C 1.05 -0.95, -0.3 -1.15, -0.55 -0.2 '
           + 'C -0.68 0.45, 0.22 0.62, 0.32 0.02';

// the bass clef: a dot on the F line, an arc up and over and back down to the left, and two dots either side of the F line.
// (0,0) is the F line (second line from the top), so the staff lines are at y = -1 (top) ... +3 (bottom).
const BASS_CLEF = 'M -0.5 -0.5 C -0.1 -1.05, 0.6 -1.05, 1.0 -0.55 C 1.45 0.0, 1.3 1.0, 0.7 1.7 C 0.1 2.4, -0.6 2.8, -1.1 3.05';
const CLEF_GLYPH = {
  treble: '<path d="' + CLEF + '" stroke-width="0.26"/><circle cx="-0.5" cy="2.3" r="0.27" fill="currentColor" stroke="none"/>',
  bass:   '<path d="' + BASS_CLEF + '" stroke-width="0.3"/><circle cx="-0.62" cy="0" r="0.5" fill="currentColor" stroke="none"/>'
        + '<circle cx="1.75" cy="-0.5" r="0.2" fill="currentColor" stroke="none"/><circle cx="1.75" cy="0.5" r="0.2" fill="currentColor" stroke="none"/>',
};

const FLAT = '<path d="M 0 -1.5 L 0 0.5 M 0 0.5 C 1.05 0.05 0.95 -0.9 0 -0.3" fill="none" stroke="currentColor" stroke-width="0.17" stroke-linecap="round" stroke-linejoin="round"/>';
const SHARP = '<path d="M -0.3 -1.25 L -0.3 1.3 M 0.3 -1.45 L 0.3 1.1" stroke="currentColor" stroke-width="0.14" stroke-linecap="round" fill="none"/>'
            + '<path d="M -0.68 -0.1 L 0.68 -0.45 M -0.68 0.7 L 0.68 0.35" stroke="currentColor" stroke-width="0.3" stroke-linecap="butt" fill="none"/>';

// `note` is one entry from noteChoices() ({ step, acc, ... }), or null for an empty staff; `clef` is 'treble' (default) or 'bass'
export function renderStaff(note, clef = 'treble') {
  const c = CLEF_STAFF[clef] || CLEF_STAFF.treble, name = CLEF_STAFF[clef] ? clef : 'treble';
  let svg = '<svg class="staff" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A note on the ' + name + ' staff">';
  for (let i = 0; i < 5; i++) {
    const y = Y_TOP + i * LS;
    svg += '<line x1="' + X0 + '" y1="' + y + '" x2="' + X1 + '" y2="' + y + '" stroke="currentColor" stroke-width="1.4"/>';
  }
  // the clef: scaled by LS, with its origin on the line it curls around
  svg += '<g transform="translate(' + (X0 + 46) + ' ' + yOf(c.clefLine, c) + ') scale(' + LS + ')" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
       + CLEF_GLYPH[name] + '</g>';
  if (note) {
    const y = yOf(note.step, c), lw = 2.3 * LS / 2 + 4;
    for (let s = c.bottom - 2; s >= note.step; s -= 2) svg += ledger(yOf(s, c), lw);   // ledger lines below the staff
    for (let s = c.top + 2; s <= note.step; s += 2) svg += ledger(yOf(s, c), lw);      // ledger lines above it
    if (note.acc) svg += '<g transform="translate(' + (NOTE_X - 1.75 * LS) + ' ' + y + ') scale(' + LS + ')">' + (note.acc > 0 ? SHARP : FLAT) + '</g>';
    // a whole note: a filled oval with a tilted hollow in the middle
    svg += '<ellipse cx="' + NOTE_X + '" cy="' + y + '" rx="' + 0.74 * LS + '" ry="' + 0.52 * LS + '" fill="currentColor"/>'
         + '<ellipse cx="' + NOTE_X + '" cy="' + y + '" rx="' + 0.42 * LS + '" ry="' + 0.25 * LS + '" fill="var(--panel, #fff)" transform="rotate(-35 ' + NOTE_X + ' ' + y + ')"/>';
  }
  return svg + '</svg>';
}
const ledger = (y, halfWidth) => '<line x1="' + (NOTE_X - halfWidth) + '" y1="' + y + '" x2="' + (NOTE_X + halfWidth) + '" y2="' + y + '" stroke="currentColor" stroke-width="1.4"/>';
