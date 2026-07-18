/* Cloudflare Worker: LLM proxy for the Automated Negotiation Demo.
   Holds the OpenRouter API key as a secret so site visitors need none.

   Hardening for a public endpoint:
     - only POST from allowed origins (the site + localhost previews)
     - model allowlist (the demo's two free models only)
     - request size / max_tokens caps
     - best-effort per-IP rate limit (per isolate)
*/

const ALLOWED_ORIGINS = [
  "https://klausgarridotenorio.github.io",
  "http://localhost:4124",
  "http://localhost:4000",
];

const ALLOWED_MODELS = new Set([
  "nvidia/nemotron-nano-9b-v2:free",
  "nvidia/nemotron-3.5-content-safety:free",
]);

const MAX_TOKENS_CAP = 600;
const MAX_MESSAGES = 24;
const MAX_BODY_CHARS = 12000;

// Best-effort rate limit: 30 requests/minute per IP (resets when the
// isolate is recycled; good enough to blunt casual abuse on a demo).
const hits = new Map();
const RATE_LIMIT = 30;
const WINDOW_MS = 60_000;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > RATE_LIMIT;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const corsOrigin = allowed ? origin : ALLOWED_ORIGINS[0];

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
    }
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405, corsOrigin);
    }
    if (!allowed) {
      return json({ error: "origin not allowed" }, 403, corsOrigin);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json({ error: "rate limit exceeded, try again in a minute" }, 429, corsOrigin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return json({ error: "request too large" }, 413, corsOrigin);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid JSON" }, 400, corsOrigin);
    }

    const { model, messages, max_tokens, reasoning } = body || {};
    if (!ALLOWED_MODELS.has(model)) {
      return json({ error: "model not allowed" }, 400, corsOrigin);
    }
    if (!Array.isArray(messages) || messages.length === 0 ||
        messages.length > MAX_MESSAGES ||
        !messages.every((m) => m && typeof m.role === "string" &&
                               typeof m.content === "string")) {
      return json({ error: "invalid messages" }, 400, corsOrigin);
    }

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://klausgarridotenorio.github.io",
        "X-Title": "Automated Negotiation Demo",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(Number(max_tokens) || 220, MAX_TOKENS_CAP),
        // Pass through reasoning control (e.g. {enabled:false} so the
        // nano reasoning model spends its budget on the visible reply).
        ...(reasoning && typeof reasoning === "object" ? { reasoning } : {}),
      }),
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(corsOrigin) },
    });
  },
};
