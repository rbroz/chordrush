// ChordRush Worker
// Serves the static site AND handles server-side API routes.
// Static assets are served automatically; only non-asset routes reach this code.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    // everything else → the static site (index.html, style.css, etc.)
    return env.ASSETS.fetch(request);
  },
};

// POST /api/login  { identifier, password }
// identifier can be an email OR a username. Returns session tokens on success.
async function handleLogin(request, env) {
  try {
    const { identifier, password } = await request.json();
    if (!identifier || !password) return json({ error: "Missing credentials" }, 400);

    // Resolve to an email. If it's a username, ask the locked-down DB function.
    let email = identifier.trim();
    if (!email.includes("@")) {
      email = await resolveUsernameToEmail(email, env);
      if (!email) return json({ error: "Invalid login" }, 400); // don't reveal which field was wrong
    }

    // Sign in against Supabase Auth (password grant). apikey = the PUBLIC key.
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: env.SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      const hint = (data.error_description || data.msg || data.error || "").toLowerCase();
      if (hint.includes("confirm")) return json({ error: "Please verify your email first (check your inbox)." }, 400);
      return json({ error: "Invalid login" }, 400);
    }

    // Hand the browser just the tokens it needs to establish a session.
    return json({ access_token: data.access_token, refresh_token: data.refresh_token });
  } catch (e) {
    return json({ error: "Login failed" }, 500);
  }
}

// Uses the SECRET key (service_role) to call the locked-down resolver function.
// This is why it must run on the server — the secret key never touches the browser.
async function resolveUsernameToEmail(username, env) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/email_for_username`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    },
    body: JSON.stringify({ uname: username }),
  });
  if (!resp.ok) return null;
  const email = await resp.json(); // scalar text (or null)
  return email || null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
