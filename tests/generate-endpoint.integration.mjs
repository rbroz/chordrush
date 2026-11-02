// Run: node tests/generate-endpoint.integration.mjs      (needs network only for `npx wrangler`; no API key, no Supabase)
//
// Runs the REAL Worker in the REAL Cloudflare runtime (workerd, via `wrangler dev`) in a temp copy of the project,
// pointed at two mock servers: a fake Supabase (auth + the usage functions) and a fake Anthropic API.
// This proves what unit tests can't: the Worker bundles with the SDK, the ../public/exercise-spec.js import resolves,
// the SDK works inside workerd, and the daily limits behave end to end.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0, passes = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else { passes++; console.log('  ok:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- mock Supabase + mock Anthropic (one server, split by path) ---------- */
const state = { users: {}, global: 0, anthropic: [], rpc: [], mode: 'good' };
const form = o => ({ supported: true, reason: 'Used all 12 keys.', title: 'ii V I everywhere', pool_kind: 'progression', chord_type: 'major', voicing: 'any',
  keys: [], steps: ['ii', 'V', 'I'], prompt_show: 'numeral', hint: false, accept: 'triad_or_seventh', scoring: 'points', ...o });
const readBody = req => new Promise(res => { let b = ''; req.on('data', c => b += c); req.on('end', () => res(b)); });
const server = http.createServer(async (req, res) => {
  const body = await readBody(req); const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  if (req.url === '/auth/v1/user') return req.headers.authorization === 'Bearer good-token' ? send(200, { id: 'u1' }) : send(401, { msg: 'bad jwt' });
  if (req.url === '/rest/v1/rpc/ai_reserve') {
    const a = JSON.parse(body); state.rpc.push({ fn: 'reserve', a, svc: req.headers.authorization });
    const u = state.users[a.p_user] || 0;
    if (state.global >= a.p_global_limit) return send(200, { ok: false, reason: 'global', user_used: u });
    if (u >= a.p_user_limit) return send(200, { ok: false, reason: 'user', user_used: u });
    state.users[a.p_user] = u + 1; state.global++; return send(200, { ok: true, user_used: u + 1 });
  }
  if (req.url === '/rest/v1/rpc/ai_settle') {
    const a = JSON.parse(body); state.rpc.push({ fn: 'settle', a });
    if (a.p_refund) { state.users[a.p_user] = Math.max(0, (state.users[a.p_user] || 0) - 1); state.global = Math.max(0, state.global - 1); }
    res.writeHead(204); return res.end();
  }
  if (req.url === '/v1/messages') {
    const b = JSON.parse(body); state.anthropic.push({ headers: req.headers, body: b });
    const text = b.messages[0].content;
    if (/fail500/.test(text)) return send(500, { type: 'error', error: { type: 'api_error', message: 'upstream exploded' } });
    const f = /scale/.test(text) ? form({ supported: false, reason: "I can only make chord exercises, so I can't do scales." }) : form();
    return send(200, { id: 'msg_it', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(f) }],
                       stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 80 } });
  }
  send(404, { error: 'mock: unknown path ' + req.url });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const MOCK = 'http://127.0.0.1:' + server.address().port;

/* ---------- a temp copy of the project, with wrangler pointed at the mocks ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chordrush-it-'));
for (const d of ['src', 'public']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
const staging = fs.readFileSync(path.join(ROOT, 'wrangler.staging.jsonc'), 'utf8');   // keep the real compatibility settings
const compat = (staging.match(/"compatibility_date"\s*:\s*"[^"]+"/) || ['"compatibility_date": "2026-07-18"'])[0];
const flags = (staging.match(/"compatibility_flags"\s*:\s*\[[^\]]*\]/) || [''])[0];
fs.writeFileSync(path.join(tmp, 'wrangler.jsonc'), `{
  "name": "chordrush-it", ${compat}, ${flags ? flags + ',' : ''}
  "main": "src/index.js",
  "assets": { "directory": "./public", "binding": "ASSETS" },
  "vars": { "SUPABASE_URL": "${MOCK}", "SUPABASE_PUBLISHABLE_KEY": "it-publishable", "SUPABASE_SECRET_KEY": "it-service",
            "ANTHROPIC_API_KEY": "it-anthropic-key", "ANTHROPIC_BASE_URL": "${MOCK}" }
}`);

const PORT = 8801 + Math.floor(Math.random() * 100);
const wr = spawn('npx', ['wrangler', 'dev', '-c', path.join(tmp, 'wrangler.jsonc'), '--port', String(PORT), '--inspector-port', String(PORT + 400), '--local'],
                 { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let wlog = ''; wr.stdout.on('data', d => wlog += d); wr.stderr.on('data', d => wlog += d);
const stop = () => { try { process.kill(-wr.pid); } catch {} server.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
process.on('exit', stop);

const BASE = 'http://127.0.0.1:' + PORT;
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/')).status === 200; } catch {} if (!up) await sleep(1000); }
if (!up) { console.log('Worker did not start:\n' + wlog.slice(-1500)); stop(); process.exit(1); }
console.log('Worker running in workerd on ' + BASE + ' (compat: ' + compat + (flags ? ', ' + flags : '') + ')');

const gen = async (prompt, token = 'good-token') => {
  const r = await fetch(BASE + '/api/generate-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ prompt }) });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
  return { status: r.status, data, text };
};
const texts = [];

console.log('static site and routing');
ok((await fetch(BASE + '/create')).status === 200, 'static pages still served (/create)');
ok((await fetch(BASE + '/exercise-spec.js')).status === 200, 'the shared spec module is still served as a static asset');
ok((await fetch(BASE + '/api/generate-exercise')).status === 405, 'GET /api/generate-exercise → 405');

console.log('auth');
let x = await gen('ii V I', null);       ok(x.status === 401, 'no token → 401');
x = await gen('ii V I', 'bad-token');    ok(x.status === 401, 'invalid token → 401');
ok(state.anthropic.length === 0 && state.rpc.length === 0, 'unauthenticated requests reserved nothing and never reached the model');

console.log('success path (real SDK inside workerd → mock Anthropic)');
x = await gen('ii V I in every key');
ok(x.status === 200 && x.data.ok === true, 'success: ' + x.text.slice(0, 160));
ok(x.data.spec && x.data.spec.pool.kind === 'progression' && x.data.spec.pool.steps.join() === 'ii,V,I' && x.data.spec.pool.keys.length === 12, 'spec built from the model form (progression ii–V–I, all 12 keys)');
ok(x.data.remaining === 4, 'remaining count: 4 left of 5');
const a = state.anthropic[0];
ok(a && a.headers.authorization === 'Bearer it-anthropic-key', 'the server API key reached the model API');
ok(a && !Object.values(a.headers).some(v => String(v).includes('good-token')), "the person's login token was NOT forwarded");
ok(a && a.body.model.startsWith('claude-haiku-4-5') && a.body.output_config.format.type === 'json_schema' && a.body.max_tokens === 700, 'request: Haiku 4.5, json_schema output, bounded max_tokens');
ok(state.rpc[0].fn === 'reserve' && state.rpc[0].svc === 'Bearer it-service' && state.rpc[0].a.p_user_limit === 5 && state.rpc[0].a.p_global_limit === 100, 'reserved first, with the service key and the agreed 5 / 100 limits');
const settle = state.rpc.find(c => c.fn === 'settle');
ok(settle && settle.a.p_refund === false && settle.a.p_input === 900 && settle.a.p_output === 80, 'tokens recorded after the call (900 in / 80 out)');
texts.push(x.text);

console.log('unsupported request');
x = await gen('C major scale in every key');
ok(x.status === 200 && x.data.ok === false && x.data.unsupported === true && /scales/.test(x.data.message), 'scales → friendly "not supported" with no spec');
texts.push(x.text);

console.log('upstream failure refunds the slot');
const usedBefore = state.users.u1;
x = await gen('please fail500 now');
ok(x.status === 502 && /unavailable/.test(x.data.error), 'upstream 500 → 502 with a friendly message');
ok(!x.text.includes('exploded'), 'upstream error details not leaked');
ok(state.users.u1 === usedBefore, 'the failed generation was refunded (count unchanged: ' + usedBefore + ')');
texts.push(x.text);

console.log('daily limit (5 per account)');
while ((state.users.u1 || 0) < 5) { const g = await gen('another ii V I'); if (g.status !== 200) { ok(false, 'unexpected failure while filling quota: ' + g.text); break; } }
const callsBefore = state.anthropic.length;
x = await gen('one more please');
ok(x.status === 429 && x.data.remaining === 0 && /5 generations/.test(x.data.error), 'the 6th generation → 429');
ok(state.anthropic.length === callsBefore, 'the model was NOT called for the blocked request');
texts.push(x.text);

console.log('global ceiling (100 total)');
state.users = {}; state.global = 100;
const before2 = state.anthropic.length;
x = await gen('ii V I');
ok(x.status === 429 && /daily limit/.test(x.data.error), 'global ceiling → 429 with its own message');
ok(state.anthropic.length === before2, 'no model call at the global ceiling');
texts.push(x.text);

console.log('secrets');
ok(texts.every(t => !/it-anthropic-key|it-service|it-publishable/.test(t)), 'no secret value appears in any response body');

console.log('\n' + (fails ? fails + ' FAILURE(S), ' : 'ALL PASSED, ') + passes + ' checks');
stop(); process.exit(fails ? 1 : 0);
