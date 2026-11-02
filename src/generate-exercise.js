// POST /api/generate-exercise   { prompt }   Authorization: Bearer <Supabase access token>
// Turns a plain-English description into a validated exercise spec using Claude. Runs on the server only: the
// API key and the usage table are never reachable from the browser.
//
// Order matters, because every step before the model call is free and everything after it costs tokens:
//   1. validate the request   2. verify who is asking   3. reserve one generation (atomic, per-account + global cap)
//   4. call the model         5. record the tokens used   6. turn the answer into a validated spec

import Anthropic from '@anthropic-ai/sdk';
import { MAX_PROMPT_CHARS, normalizePrompt, buildRequest, readModelMessage, specFromModel } from './exercise-ai.js';

// Daily limits (UTC day). Change here and redeploy. The client mirrors LIMITS.perUserPerDay for its "n left" label only.
export const LIMITS = { perUserPerDay: 5, globalPerDay: 100 };
const MAX_BODY_CHARS = 4096;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Supabase Auth: a 200 from /auth/v1/user means the access token is valid and tells us whose it is
async function getUser(env, token, doFetch) {
  const resp = await doFetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (resp.status !== 200) return null;
  const user = await resp.json();
  return user && typeof user.id === 'string' ? user : null;
}

// service-role call to a Postgres function (same pattern the login endpoint already uses)
async function rpc(env, fn, args, doFetch) {
  const resp = await doFetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error(`rpc ${fn} failed (${resp.status})`);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

const FAIL_MESSAGES = {
  refusal:   "The generator couldn't help with that one. Try describing a chord exercise.",
  truncated: 'That came back incomplete. Try a shorter, simpler description.',
  empty:     "The generator didn't return an answer. Try again.",
  bad_json:  "The generator's answer wasn't usable. Try rephrasing.",
};

// deps: { fetch, makeClient } are injectable so the whole flow can be tested without a network or a real key
export async function handleGenerate(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1. the request
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: 'That request is too large.' }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'Send a JSON body with a "prompt".' }, 400); }
  const prompt = normalizePrompt(body && body.prompt);
  if (!prompt) return json({ error: 'Describe the exercise you want.' }, 400);
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: `Keep it under ${MAX_PROMPT_CHARS} characters.` }, 400);

  // 2. who is asking
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Log in to use the generator.' }, 401);
  if (!env.ANTHROPIC_API_KEY || !env.SUPABASE_SECRET_KEY) {
    return json({ error: "The generator isn't set up yet. You can still pick the options by hand." }, 503);
  }
  let user;
  try { user = await getUser(env, token, doFetch); }
  catch (e) { console.error('auth lookup failed', e && e.name); return json({ error: "Couldn't verify your login. Try again." }, 503); }
  if (!user) return json({ error: 'Your session expired. Log in again.' }, 401);

  // 3. reserve a generation BEFORE spending anything; atomic in the database, so double-clicks and parallel tabs can't overshoot
  let resv;
  try { resv = await rpc(env, 'ai_reserve', { p_user: user.id, p_user_limit: LIMITS.perUserPerDay, p_global_limit: LIMITS.globalPerDay }, doFetch); }
  catch (e) { console.error('reserve failed', e && e.message); return json({ error: "Couldn't check your daily limit. Try again." }, 503); }
  if (!resv || resv.ok !== true) {
    return json({
      error: resv && resv.reason === 'global'
        ? 'The generator has reached its daily limit. Try again tomorrow, or set the options by hand.'
        : `You've used your ${LIMITS.perUserPerDay} generations for today. They reset tomorrow (UTC), and you can still set the options by hand.`,
      remaining: 0,
    }, 429);
  }
  const remaining = Math.max(0, LIMITS.perUserPerDay - (Number(resv.user_used) || LIMITS.perUserPerDay));

  // 4. the model
  let message;
  try {
    const client = deps.makeClient ? deps.makeClient(env)
      : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, timeout: 25000, maxRetries: 1 });
    message = await client.messages.create(buildRequest(prompt));
  } catch (e) {
    console.error('model call failed', e && e.name, e && e.status);
    try { await rpc(env, 'ai_settle', { p_user: user.id, p_input: 0, p_output: 0, p_refund: true }, doFetch); } catch (e2) { console.error('refund failed', e2 && e2.message); }
    return json({ error: "The generator is unavailable right now. You can still pick the options by hand.", remaining: remaining + 1 }, 502);
  }

  // 5. the call cost tokens whatever the answer looks like, so record them
  const read = readModelMessage(message);
  try { await rpc(env, 'ai_settle', { p_user: user.id, p_input: read.usage.input, p_output: read.usage.output, p_refund: false }, doFetch); }
  catch (e) { console.error('usage record failed', e && e.message); }

  // 6. the answer
  if (!read.ok) return json({ ok: false, error: FAIL_MESSAGES[read.kind] || FAIL_MESSAGES.bad_json, remaining }, 502);
  const result = specFromModel(read.data);
  if (!result.ok) {
    return result.kind === 'unsupported'
      ? json({ ok: false, unsupported: true, message: result.message, remaining })
      : json({ ok: false, error: result.message, remaining }, 502);
  }
  return json({ ok: true, title: result.title, spec: result.spec, note: result.note, remaining });
}
