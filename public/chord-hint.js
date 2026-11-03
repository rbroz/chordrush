// ChordRush keyboard hint: a one-octave slice of a piano with the chord's keys lit, as an SVG string.
// Same drawing as the Test page's hint (index.html), lifted into a module so the exercise player can use it.
// The slice starts about two keys below the bass and ends about two above the top note, snapped to white keys.
import { ROOT_NAMES } from './exercise-spec.js';

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const ACCENT = '#5b7cfa';
const isWhite = a => WHITE.has(((a % 12) + 12) % 12);
const pcName = a => ROOT_NAMES[((a % 12) + 12) % 12];

// chord = { pcs, bass? } from chordFor(); returns '' when there is no chord
export function renderChordHint(chord) {
  if (!chord || !chord.pcs) return '';
  const pcs = chord.pcs;
  const bassPc = chord.bass != null ? chord.bass : pcs[0];
  const bassAbs = bassPc + 24;                                             // headroom so the lead-in below the bass stays positive
  const lit = new Set(pcs.map(pc => bassAbs + ((pc - bassPc + 12) % 12))); // chord tones ascending from the bass
  const topAbs = Math.max(...lit);
  let startAbs = bassAbs - 2; while (!isWhite(startAbs)) startAbs--;
  let endAbs = topAbs + 2;    while (!isWhite(endAbs)) endAbs++;

  const W = 24, H = 96, BW = 15, BH = 60;
  const whites = [];
  for (let a = startAbs; a <= endAbs; a++) if (isWhite(a)) whites.push(a);
  const width = whites.length * W;
  const wIndex = {}; whites.forEach((a, i) => { wIndex[a] = i; });

  let s = `<svg class="hint-kbd" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-label="keys to play">`;
  whites.forEach((a, i) => {                                               // white keys first
    const on = lit.has(a);
    s += `<rect x="${i * W}" y="0" width="${W - 1}" height="${H}" rx="3" fill="${on ? ACCENT : '#ffffff'}" stroke="#dcdce3"/>`;
    if (on) s += `<text x="${i * W + W / 2}" y="${H - 9}" text-anchor="middle" font-size="9" fill="#ffffff">${pcName(a)}</text>`;
  });
  for (let a = startAbs; a <= endAbs; a++) {                               // black keys on top
    if (isWhite(a)) continue;
    const x = (wIndex[a - 1] + 1) * W - BW / 2;
    const on = lit.has(a);
    s += `<rect x="${x}" y="0" width="${BW}" height="${BH}" rx="2" fill="${on ? ACCENT : '#2a2a30'}"/>`;
    if (on) s += `<text x="${x + BW / 2}" y="${BH - 7}" text-anchor="middle" font-size="8" fill="#ffffff">${pcName(a)}</text>`;
  }
  return s + '</svg>';
}
