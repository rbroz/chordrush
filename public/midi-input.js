// ChordRush MIDI input for the exercise player: listen to EVERY connected MIDI keyboard and report each key strike.
// (The main test page has its own copy with a device picker and sound; this one is the small version the editor needs.)
//
//   const midi = await connectMidi({ onNoteOn: key => ..., onStatus: text => ... });
//
// The browser only asks for MIDI permission when connectMidi is called, so call it when the player is first shown.
import { noteOnFrom } from './exercise-runner.js';

export async function connectMidi({ onNoteOn, onStatus }) {
  const say = t => { if (onStatus) onStatus(t); };
  if (!navigator.requestMIDIAccess) { say('This browser has no MIDI support. Use Chrome or Edge on a computer.'); return null; }
  let access;
  try { access = await navigator.requestMIDIAccess({ sysex: false }); }
  catch (e) {
    const name = e && e.name;
    say(name === 'SecurityError' || name === 'NotAllowedError'
      ? 'MIDI is blocked for this page. Click the icon in the address bar, allow MIDI, then reload.'
      : name === 'InvalidStateError'
        ? 'The browser’s MIDI engine is stuck. Fully quit and reopen the browser.'
        : 'Couldn’t start MIDI. Try reloading.');
    return null;
  }
  const handle = ev => { const key = noteOnFrom(ev.data); if (key !== null) onNoteOn(key); };
  function bind() {
    const inputs = [...access.inputs.values()];
    inputs.forEach(i => { i.onmidimessage = handle; });
    say(inputs.length ? 'Connected: ' + inputs.map(i => i.name || 'MIDI keyboard').join(', ') : 'No MIDI keyboard found. Plug one in and it will connect.');
  }
  access.onstatechange = bind;   // a keyboard was plugged in or unplugged
  bind();
  return { close() { access.onstatechange = null; [...access.inputs.values()].forEach(i => { i.onmidimessage = null; }); } };
}
