// Run: node tests/chord-runner.test.mjs
// Checks the chord race rules (the same ones the Test page uses) and that the chord data matches index.html exactly.
import { readFileSync } from 'node:fs';
import { createChordRunner, buildChordOrder, chordFor, canRunChords, noteOffFrom, GRASP_WINDOW_MS, INV_LABEL } from '../public/exercise-runner.js';
import { CHORD_TYPES, ROOT_NAMES, EXAMPLES } from '../public/exercise-spec.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } };
const seeded = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const spec = (type = 'major', voicing = 'any') => ({ v: 1, pool: { kind: 'chords', type, voicing }, prompt: { show: 'name', hint: true }, accept: 'exact', scoring: 'time' });

// ---- 1. the chord data matches index.html (the Test page), so the two can't drift apart ----
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const grab = (startMarker, endMarker) => { const a = html.indexOf(startMarker); const b = html.indexOf(endMarker, a); return html.slice(a, b + endMarker.length); };
const idxTypes = new Function('return ' + grab('const CHORD_TYPES = {', '\n};').replace('const CHORD_TYPES = ', '').replace(/;$/, ''))();
const idxRoots = new Function('return ' + grab('const ROOTS = [', '\n];').replace('const ROOTS = ', '').replace(/;$/, ''))();
ok(Object.keys(idxTypes).join() === Object.keys(CHORD_TYPES).join(), 'same chord types, same order');
for (const k of Object.keys(idxTypes)) {
  const a = idxTypes[k], b = CHORD_TYPES[k];
  ok(a.label === b.label && a.suffix === b.suffix && a.sym === b.sym && a.ivals.join() === b.ivals.join() && b.n === b.ivals.length, 'chord type matches index.html: ' + k);
}
ok(idxRoots.length === 12 && idxRoots.every(r => ROOT_NAMES[r.pc] === r.name), 'root names match index.html (by pitch class)');
{ // index.html's own chordFor, extracted and run against ours for every type, root, inversion and the any-voicing case
  const PC_NAME = {}; idxRoots.forEach(r => PC_NAME[r.pc] = r.name);
  const src = grab('function chordFor(', '\n}\n');
  const theirs = new Function('CHORD_TYPES', 'ROOTS', 'PC_NAME', src + '; return chordFor;')(idxTypes, idxRoots, PC_NAME);
  let n = 0;
  for (const type of Object.keys(CHORD_TYPES)) for (const r of idxRoots) for (const inv of [0, 1, 2, 3]) for (const any of [false, true]) {
    if (inv >= CHORD_TYPES[type].n) continue;
    const a = theirs(r, type, inv, any), b = chordFor(r.pc, type, inv, any); n++;
    ok(a.name === b.name && a.type === b.type && a.inv === b.inv && a.pcs.join() === b.pcs.join() && a.bass === b.bass,
       `chordFor matches index.html: ${type} ${r.name} inv${inv} any=${any}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  ok(n > 400, 'compared ' + n + ' chords');
}

// ---- 2. the run's chords ----
ok(buildChordOrder(spec(), seeded(1)).length === 12, 'one chord type = 12 chords (one per root)');
ok(new Set(buildChordOrder(spec(), seeded(1)).map(c => c.rootPc)).size === 12, 'every root appears once');
ok(buildChordOrder(spec('dom7', '3rd'), seeded(1)).every(c => c.inv === 3 && c.bass != null), '3rd inversion: every chord needs its bass');
ok(buildChordOrder(spec('major', 'any'), seeded(1)).every(c => c.bass === undefined), 'any voicing: no bass rule');
ok(buildChordOrder(spec('major', 'root'), seeded(1)).every(c => c.bass === c.rootPc), 'root position: the root is the bass');
ok(buildChordOrder(spec('minor', '1st'), seeded(1)).every(c => c.bass === (c.rootPc + 3) % 12), '1st inversion of a minor: the 3rd is the bass');
ok(chordFor(7, 'major', 1, false).name === 'G/B' && chordFor(7, 'minor', 1, false).name === 'Gm/B♭' && chordFor(3, 'major', 0, true).name === 'E♭ Major' && chordFor(0, 'dom7', 0, true).name === 'C7' && chordFor(0, 'min7', 0, true).name === 'C m7', 'chord names');
ok(INV_LABEL.join() === 'root,1st inv,2nd inv,3rd inv', 'inversion labels');
const same = (a, b) => a.map(c => c.name).join() === b.map(c => c.name).join();
ok(same(buildChordOrder(spec(), seeded(5)), buildChordOrder(spec(), seeded(5))), 'the same seed gives the same order');
ok(!same(buildChordOrder(spec(), seeded(5)), buildChordOrder(spec(), seeded(6))), 'different seeds shuffle differently');

// ---- helpers: play a chord as simultaneous key-downs, bass lowest ----
const notesFor = (chord, base = 48) => {
  const bassPc = chord.bass != null ? chord.bass : chord.pcs[0];
  return [...chord.pcs].sort((a, b) => ((a - bassPc + 12) % 12) - ((b - bassPc + 12) % 12)).map(pc => base + bassPc + ((pc - bassPc + 12) % 12));   // each key's pitch class is pc, the bass lowest
};
const strike = (r, keys, t, gap = 5) => { const ev = []; keys.forEach((k, i) => ev.push(...r.keyDown(k, t + i * gap))); return ev; };
const release = (r, keys, t) => { const ev = []; keys.forEach(k => ev.push(...r.keyUp(k, t))); return ev; };
const target = r => r.state(0).target;
const playOne = (r, t, voicingBase = 48) => { const keys = notesFor(target(r), voicingBase); const ev = strike(r, keys, t); release(r, keys, t + 50); return ev; };

// ---- 3. the flow: go-signal, then a timed run ----
let r = createChordRunner(spec(), seeded(1)), s = r.state(0);
ok(s.phase === 'ready' && s.idx === 0 && s.total === 12 && s.misses === 0 && s.elapsedMs === 0 && s.accuracy === null, 'starts ready, 0 of 12');
let ev = playOne(r, 1000);
ok(ev.join() === 'start', 'the first chord is the go-signal: ' + ev);
s = r.state(1500);
ok(s.phase === 'running' && s.idx === 1 && s.elapsedMs === 490, 'clock runs from the moment the go-signal chord landed (its last key, at 1010): ' + s.elapsedMs);
ev = playOne(r, 1400);
ok(ev.join() === 'advance' && r.state(0).idx === 2, 'the next chord advances');
// finish: chord 3..12, each landing 300 ms after the last, clean
let t = 1400;
for (let i = 2; i < 12; i++) { t += 300; ev = playOne(r, t); }
s = r.state(99999);
ok(ev.join() === 'advance,done' && s.phase === 'done' && s.target === null, 'the last chord ends the run: ' + ev);
ok(s.totalMs === t - 1000, `total time is last landing minus go-signal: ${s.totalMs} vs ${t - 1000}`);
ok(s.accuracy === 100 && s.misses === 0, 'clean run is 100%');
ok(s.results.length === 12 && s.results[0].ms === null && s.results[1].ms === 400 && s.results[2].ms === 300 && s.results.every(x => x.misses === 0), 'splits: first has no time, then the gaps: ' + JSON.stringify(s.results.map(x => x.ms)));
ok(strike(r, [60, 64, 67], 99000).length === 0 && r.state(0).phase === 'done', 'keys do nothing once the run is done');

// ---- 4. misses ----
r = createChordRunner(spec(), seeded(2));
{ // warm-up before the clock starts costs nothing
  strike(r, [60], 0); ev = r.tick(500);
  ok(ev.length === 0 && r.state(0).misses === 0, 'a stray note before the go-signal is not a miss');
  release(r, [60], 600);
  playOne(r, 1000);                                  // go-signal
}
{ // a stray note: one miss once the 80 ms window closes, and only one for that strike
  const keys = notesFor(target(r));
  strike(r, [keys[0]], 2000);
  ok(r.tick(2000 + GRASP_WINDOW_MS - 1).length === 0, 'no miss inside the window');
  ev = r.tick(2000 + GRASP_WINDOW_MS);
  ok(ev.join() === 'miss' && r.state(0).misses === 1, 'one note held when the window closes: a miss');
  ok(r.tick(3000).length === 0 && r.state(0).misses === 1, 'a strike is judged once, not every tick');
  release(r, [keys[0]], 3100);
}
{ // a chord built up slowly: a miss for each strike that stays incomplete
  const keys = notesFor(target(r)); const m0 = r.state(0).misses;
  ev = [...r.keyDown(keys[0], 5000), ...r.keyDown(keys[1], 5100)];       // 100 ms later: the first note's window already closed
  ok(ev.join() === 'miss' && r.state(0).misses === m0 + 1, 'second note arrives after the window: one miss');
  ev = r.keyDown(keys[2], 5200);                                          // third note completes the chord
  ok(ev.join() === 'miss,advance', 'the completing note still lands the chord (after one more miss): ' + ev);
  release(r, keys, 5300);
}
{ // a whole chord inside the window is clean even with 20 ms between notes
  const keys = notesFor(target(r)); const m0 = r.state(0).misses;
  ev = strike(r, keys, 6000, 20);
  ok(ev.join() === 'advance' && r.state(0).misses === m0, 'a chord struck within 80 ms is clean');
  release(r, keys, 6100);
}
{ // a wrong chord (right count, wrong notes)
  const m0 = r.state(0).misses; const idx0 = r.state(0).idx;
  const wrongKeys = notesFor(target(r)).map(k => k + 1);                  // every note a semitone up
  strike(r, wrongKeys, 7000); ev = r.tick(7100);
  ok(ev.join() === 'miss' && r.state(0).misses === m0 + 1 && r.state(0).idx === idx0, 'a wrong chord is a miss and does not advance');
  release(r, wrongKeys, 7200);
}
{ // the right chord plus an extra note is not a match; releasing the extra note completes it, with no miss if quick
  const keys = notesFor(target(r)); const extra = 36 + [0,1,2,3,4,5,6,7,8,9,10,11].find(pc => !target(r).pcs.includes(pc)); const m0 = r.state(0).misses; const idx0 = r.state(0).idx;
  strike(r, [extra, ...keys], 8000, 5);   // the stray note goes down first, so the chord never matches on its own
  ok(r.state(0).idx === idx0, 'chord + extra note does not match');
  ev = r.keyUp(extra, 8040);
  ok(ev.join() === 'advance' && r.state(0).misses === m0, 'releasing the extra note within the window lands the chord, no miss');
  release(r, keys, 8100);
}
{ // misses are charged to the chord they happened on
  // finish the run cleanly, then every miss must be charged to some chord
  let tt = 20000; while (r.state(0).phase !== 'done') { playOne(r, tt); tt += 300; }
  const fin = r.state(0);
  ok(fin.results.reduce((a, x) => a + x.misses, 0) === fin.misses && fin.misses > 0, 'per-chord misses add up to the total: ' + fin.results.reduce((a, x) => a + x.misses, 0) + ' vs ' + fin.misses);
  ok(fin.accuracy === Math.round(12 / (12 + fin.misses) * 100), 'accuracy = chords / (chords + misses)');
}

// ---- 5. voicing: the bass must be right ----
r = createChordRunner(spec('major', '1st'), seeded(3));
{
  const c = target(r);                                                    // e.g. a 1st inversion: the 3rd must be lowest
  const wrong = [...c.pcs].sort((a, b) => ((a - c.rootPc + 12) % 12) - ((b - c.rootPc + 12) % 12)).map(pc => 48 + c.rootPc + ((pc - c.rootPc + 12) % 12)); // root position
  strike(r, wrong, 1000); ok(r.state(0).idx === 0, 'right notes in root position do not match a 1st-inversion target');
  release(r, wrong, 1100);
  ev = playOne(r, 2000);
  ok(ev.join() === 'start', 'right notes with the third in the bass match');
}
r = createChordRunner(spec('major', 'any'), seeded(3));
{
  const c = target(r);
  const inv = [0, 1, 2].map(i => notesFor({ ...c, bass: c.pcs[i] }));    // each of the 3 inversions
  const k = inv[2]; ev = strike(r, k, 1000);
  ok(ev.join() === 'start', 'any voicing accepts a 2nd-inversion shape: ' + ev);
  release(r, k, 1100);
}
{ // the octave never matters, only the pitch classes
  r = createChordRunner(spec('major', 'any'), seeded(4));
  const c = target(r); const spread = notesFor(c).map((k, i) => k + 12 * i);
  ev = strike(r, spread, 1000); ok(ev.join() === 'start', 'notes spread over octaves still match');
}

// ---- 6. restart ----
r = createChordRunner(spec(), seeded(7));
const first = r.state(0).results.map(x => x.name).join();
playOne(r, 1000); strike(r, [60], 2000); r.tick(2200);
r.restart(); s = r.state(0);
ok(s.phase === 'ready' && s.idx === 0 && s.misses === 0 && s.elapsedMs === 0 && s.accuracy === null, 'restart: back to ready, counters cleared');
ok(s.results.map(x => x.name).join() !== first, 'restart reshuffles');
{ const r2 = createChordRunner(spec(), seeded(8)); r2.keyDown(60, 0); r2.restart(); ok(r2.keyDown(64, 10).length === 0 && r2.state(0).idx === 0, 'a key still held across restart stays held (it counts toward the next chord)'); }

// ---- 7. input handling ----
ok(noteOffFrom([0x80, 60, 64]) === 60 && noteOffFrom([0x90, 60, 0]) === 60 && noteOffFrom([0x90, 60, 90]) === null && noteOffFrom([0xB0, 64, 0]) === null && noteOffFrom(null) === null && noteOffFrom([0x80]) === null, 'noteOffFrom');
ok(canRunChords(spec()) && !canRunChords(null) && !canRunChords({ ...spec(), scoring: 'points' }) && !canRunChords({ ...spec(), accept: 'triad_or_seventh' }), 'canRunChords: chords + exact + time only');
for (const e of EXAMPLES) ok(canRunChords(e.spec) === (e.id === 'chords'), 'only the chord drill example is playable for now: ' + e.id);
{ let threw = false; try { createChordRunner(EXAMPLES[1].spec); } catch { threw = true; } ok(threw, 'rejects diatonic'); }

// ---- 8. a fuzz: a messy human (stray keys, slow builds, releases) still finishes, and the rules never break ----
{
  const rng = seeded(11); let steps = 0, runs = 0;
  for (let run = 0; run < 200; run++) {
    const types = Object.keys(CHORD_TYPES), type = types[Math.floor(rng() * types.length)];
    const voicings = CHORD_TYPES[type].n === 4 ? ['any', 'root', '1st', '2nd', '3rd'] : ['any', 'root', '1st', '2nd'];
    const rr = createChordRunner(spec(type, voicings[Math.floor(rng() * voicings.length)]), rng);
    const mine = new Set();                                              // the keys this fake player is holding
    let time = 0, prevIdx = 0, prevMisses = 0, finished = false;
    for (let i = 0; i < 2000 && !finished; i++) {
      time += 1 + Math.floor(rng() * 150);
      const roll = rng();
      if (roll < 0.3) {                                                  // let go of everything, then play the chord
        [...mine].forEach(k => { rr.keyUp(k, time); mine.delete(k); });
        const tg = rr.state(time).target;
        if (tg) notesFor(tg).forEach((k, j) => { rr.keyDown(k, time + j * Math.floor(rng() * 30)); mine.add(k); });
      } else if (roll < 0.55) { const k = 36 + Math.floor(rng() * 48); rr.keyDown(k, time); mine.add(k); }     // a stray note
      else if (roll < 0.8) { const k = [...mine][0]; if (k !== undefined) { rr.keyUp(k, time); mine.delete(k); } }   // let one go
      else rr.tick(time);
      const st = rr.state(time); steps++;
      if (st.idx < prevIdx || st.misses < prevMisses) { ok(false, 'progress or misses went backwards'); break; }
      if (st.idx > prevIdx + 1 && !(prevIdx === 0 && st.idx === 1)) { ok(false, 'skipped a chord'); break; }
      if (st.phase === 'done') { finished = true; runs++; ok(st.accuracy >= 0 && st.accuracy <= 100 && st.totalMs >= 0 && st.results.reduce((a, x) => a + x.misses, 0) === st.misses, 'sane final numbers'); }
      prevIdx = st.idx; prevMisses = st.misses;
    }
  }
  ok(runs > 150, 'most messy runs still finish (' + runs + ' of 200)');
  console.log('fuzz steps:', steps, 'runs finished:', runs);
}

console.log(fails ? fails + ' FAILED' : 'ALL CHORD RUNNER TESTS PASSED');
process.exit(fails ? 1 : 0);
