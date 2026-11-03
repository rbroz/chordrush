// ChordRush exercise players: the screen part of an exercise. Each one draws into a host element and is driven by the page:
//   const player = createChordPlayer(hostEl, spec);
//   player.keyDown(key, time) / player.keyUp(key, time)   (from MIDI)      player.restart()      player.destroy()
// All the RULES live in exercise-runner.js (which has no screen in it); these only draw what the runner says.
// Playing here is practice only: nothing is saved and nothing goes on a leaderboard.
import { createNoteRunner, createChordRunner, keyName, INV_LABEL } from './exercise-runner.js';
import { renderStaff } from './staff.js';
import { renderChordHint } from './chord-hint.js';

// green for good, red for a miss; fades by itself
function makeFlasher(el) {
  let timer = null;
  return kind => {
    el.classList.remove('flash-right', 'flash-miss'); void el.offsetWidth;
    el.classList.add(kind === 'right' ? 'flash-right' : 'flash-miss');
    clearTimeout(timer); timer = setTimeout(() => el.classList.remove('flash-right', 'flash-miss'), 260);
  };
}
const fmt = ms => (ms / 1000).toFixed(2);

/* ---------- the note test: one note on the treble staff ---------- */
export function createNotePlayer(host, spec) {
  const runner = createNoteRunner(spec);
  host.innerHTML = `<section class="ex-player" aria-label="Note test">
    <div class="ex-score">
      <span><b class="np-right">0/0</b><span class="ex-lbl">right</span></span>
      <span><b class="np-acc">—</b><span class="ex-lbl">accuracy</span></span>
      <button class="ex-btn ex-restart" type="button">restart (space)</button>
    </div>
    <div class="ex-stage"></div>
    <div class="ex-player-foot"><span>Play the note on your MIDI keyboard. The octave counts.</span><span class="np-played"></span><span class="ex-midi"></span></div>
  </section>`;
  const q = s => host.querySelector(s), flash = makeFlasher(q('.ex-player'));
  function draw(result) {
    const s = runner.state();
    q('.np-right').textContent = s.right + '/' + s.attempts;
    q('.np-acc').textContent = s.accuracy === null ? '—' : s.accuracy + '%';
    q('.ex-stage').innerHTML = renderStaff(s.target);
    q('.np-played').textContent = s.lastKey === null ? '' : 'You played ' + keyName(s.lastKey) + (s.last === 'right' ? ' ✓' : ' ✗');
    if (result) flash(result);
  }
  const restart = () => { runner.restart(); draw(null); };
  q('.ex-restart').onclick = restart;
  draw(null);
  return { runner, restart, keyDown: key => draw(runner.press(key).last), keyUp() {}, destroy() { host.innerHTML = ''; } };
}

/* ---------- the chord race: play each chord as fast as you can ---------- */
export function createChordPlayer(host, spec) {
  const runner = createChordRunner(spec);
  host.innerHTML = `<section class="ex-player" aria-label="Chord test">
    <div class="ex-score">
      <span><b class="cp-time">0.00</b><span class="ex-lbl">s</span></span>
      <span><b class="cp-prog">1 / 12</b></span>
      <span><b class="cp-miss">0</b><span class="ex-lbl">✗</span></span>
      <button class="ex-btn ex-restart" type="button">restart (space)</button>
    </div>
    <div class="cp-stage">
      <div class="cp-row"><div class="cp-name"></div><div class="cp-hint"></div></div>
      <div class="cp-label">play to start</div>
    </div>
    <div class="cp-done" hidden></div>
    <div class="ex-player-foot"><span>Play the chord on your MIDI keyboard, all the keys at once.</span><span class="ex-midi"></span></div>
  </section>`;
  const q = s => host.querySelector(s), flash = makeFlasher(q('.ex-player'));
  const now = () => performance.now();
  let raf = 0, alive = true, shown = '';

  function drawStage(s) {
    const key = s.phase + ':' + s.idx;
    if (key === shown) return;                       // only redraw the chord when it changes
    shown = key;
    const c = s.target;
    q('.cp-name').textContent = c.name;
    if (c.inv) { const tag = document.createElement('span'); tag.className = 'cp-inv'; tag.textContent = INV_LABEL[c.inv]; q('.cp-name').appendChild(tag); }
    q('.cp-hint').innerHTML = spec.prompt.hint ? renderChordHint(c) : '';
    q('.cp-label').textContent = s.phase === 'ready' ? 'play to start' : 'play';
  }
  function drawDone(s) {
    shown = 'done';
    const timed = s.results.filter(r => r.ms !== null).map(r => r.ms), fast = Math.min(...timed), slow = Math.max(...timed);
    const box = q('.cp-done'); box.textContent = '';
    const total = document.createElement('div'); total.className = 'cp-total';
    total.textContent = fmt(s.totalMs) + 's ';
    const sub = document.createElement('span');
    sub.textContent = fmt(s.totalMs / s.total) + 's/chord · ' + s.accuracy + '% acc';
    total.appendChild(sub); box.appendChild(total);
    const list = document.createElement('div'); list.className = 'cp-splits';
    s.results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'cp-split' + (r.misses ? ' miss' : '') + (r.ms !== null && r.ms === fast ? ' fast' : r.ms !== null && r.ms === slow ? ' slow' : '');
      const nm = document.createElement('span'); nm.textContent = r.name;
      const tm = document.createElement('span'); tm.textContent = r.ms === null ? 'start' : fmt(r.ms) + 's';
      row.append(nm, tm); list.appendChild(row);
    });
    box.appendChild(list);
    const again = document.createElement('div'); again.className = 'cp-again'; again.textContent = 'press space to go again';
    box.appendChild(again);
  }
  function render() {
    const s = runner.state(now()), done = s.phase === 'done';
    q('.cp-stage').hidden = done; q('.cp-done').hidden = !done;
    q('.cp-time').textContent = fmt(s.elapsedMs);
    q('.cp-prog').textContent = Math.min(s.idx + 1, s.total) + ' / ' + s.total;
    q('.cp-miss').textContent = s.misses;
    if (done) { if (shown !== 'done') drawDone(s); } else drawStage(s);
  }
  function handle(events) {
    if (events.includes('miss')) flash('miss');
    if (events.includes('advance') || events.includes('start')) flash('right');
    if (events.length) render();
  }
  function frame() {                                  // every frame: close the 80 ms window when it is due, keep the clock moving
    if (!alive) return;
    handle(runner.tick(now()));
    if (runner.state(now()).phase === 'running') { q('.cp-time').textContent = fmt(runner.state(now()).elapsedMs); raf = requestAnimationFrame(frame); }
    else raf = 0;
  }
  const ensureLoop = () => { if (!raf && alive) raf = requestAnimationFrame(frame); };
  function restart() { runner.restart(); shown = ''; render(); ensureLoop(); }
  q('.ex-restart').onclick = restart;
  render();
  // the 80 ms window can only close while keys are down, so the loop also runs in the ready phase after a strike
  const settleSoon = () => { ensureLoop(); setTimeout(() => { if (alive) handle(runner.tick(now())); }, 90); };
  return {
    runner, restart,
    keyDown(key, t) { handle(runner.keyDown(key, t === undefined ? now() : t)); settleSoon(); },
    keyUp(key, t) { handle(runner.keyUp(key, t === undefined ? now() : t)); },
    destroy() { alive = false; cancelAnimationFrame(raf); host.innerHTML = ''; },
  };
}
