# negotiation-llm-proxy

Cloudflare Worker that holds the OpenRouter API key for the
[Automated Negotiation Demo](https://klausgarridotenorio.github.io/experiments/negotiation-demo/),
so site visitors get LLM-generated chat without bringing their own key.

Protections: origin allowlist (the site + localhost), model allowlist
(the demo's two free models), size and token caps, and a light per-IP
rate limit.

## Deploy (from this `worker/` directory)

```bash
npx wrangler login                       # one-time browser login
npx wrangler secret put OPENROUTER_API_KEY   # paste the key when prompted
npx wrangler deploy
```

`deploy` prints the worker URL, e.g.
`https://negotiation-llm-proxy.<your-subdomain>.workers.dev`.
Put that URL in `assets/demo/negotiation.js` as `PROXY_URL`.

## Rotating the key

Generate a new key at https://openrouter.ai/keys, then re-run
`npx wrangler secret put OPENROUTER_API_KEY`.
