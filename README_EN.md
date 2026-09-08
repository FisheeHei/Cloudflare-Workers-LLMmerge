# LLM-merge

[中文 README](./README.md)

LLM-merge is a single-file LLM gateway for Cloudflare Workers and Pages Advanced Mode. It combines multiple OpenAI-compatible upstreams behind one `/v1` Base URL and provides an admin panel for upstreams, client keys, models, prompts, context, routing, logs, and statistics.

## Use Cases

- Build a pool of compatible upstream accounts and distribute requests by model and client.
- Give OpenAI, Responses, and Anthropic-style clients one gateway URL.
- Inject system prompts, reference material, and on-demand context for selected clients.
- Accept users at a nearby Cloudflare edge and fetch the upstream directly from that edge.

## Features

- OpenAI Chat, Completions, Embeddings, Responses, and Anthropic Messages compatibility.
- Responses `store`, `previous_response_id`, response retrieval/cancel, and `/v1/responses/compact`.
- Upstream enable/disable, model and path allowlists, priority, weight, failover, and cooldown.
- Load balancing, client-key affinity, cross-edge staggering, Hedged Request, and Gateway Fast.
- Upstream adapters for generic OpenAI-compatible services, including NVIDIA NIM and common reasoning fields.
- System prompt, global context, context fragments, keyword/model matching, client scopes, and character limits.
- Model refresh, upstream health checks, model speed tests, client-key management, import/export, logs, and statistics.

## Deployment

### Workers

Deploy the Worker configuration with:

```bash
wrangler deploy --config wrangler.worker.toml
```

### Pages Advanced Mode

Use `_worker.js` as the Advanced Mode entry file. No build step is required. Configure production Variables, Secrets, and Bindings in the Cloudflare Pages project settings.

Use the same binding names in Pages and Workers:

- `llmerge`: primary state storage; D1 is recommended.
- `ROUTE_COORDINATOR`: Durable Object for cross-edge request staggering.
- `KV`: optional compatibility storage and D1/DO degraded snapshot.
- `ANALYTICS`: optional Analytics Engine write binding.

Do not enable Smart Placement. The gateway is designed for nearby user ingress and direct upstream fetches from the serving edge.

## Storage Bindings

The primary state backend is selected automatically in this order: `llmerge` Durable Object > `llmerge` D1 > `KV`.

D1 is recommended and must use the binding name `llmerge`. Apply the repository migration before first use:

```bash
wrangler d1 migrations apply <D1_DATABASE_NAME> --remote
```

The migration file is `d1_migrations/0001_create_store.sql`. The gateway also attempts to create the table on first read/write:

```sql
CREATE TABLE IF NOT EXISTS llmmerge_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);
```

`ROUTE_COORDINATOR` stores only short-lived scheduling state. It does not proxy model requests or store prompts, context, or upstream tokens. Without it, the gateway still works, but coordination is limited to per-isolate state and is not globally strict across edges.

## Required Configuration

At minimum, set:

```txt
ADMIN_TOKEN=replace-with-a-random-value
API_KEY_CRYPT_SECRET=replace-with-a-long-random-secret
```

Admin panel:

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

Without `ADMIN_TOKEN`, the default path is `/llmmerge-admin`; do not use the default path in production.

Common variables:

| Variable | Default | Description |
| --- | --- | --- |
| `REQUEST_TIMEOUT_MS` | `180000` | Base upstream first-byte/non-stream timeout; non-stream requests also have a 90-second response deadline |
| `STREAM_IDLE_TIMEOUT_MS` | `900000` | Streaming idle timeout |
| `SSE_KEEPALIVE_MS` | `5000` | SSE keepalive comment interval |
| `UPSTREAM_COOLDOWN_TTL` | `60` | Upstream failure cooldown in seconds |
| `MODEL_CACHE_TTL` | `3600` | Aggregated model-list cache in seconds |
| `UPSTREAMS_JSON` | empty | Initial upstream JSON seed |
| `CLIENTS_JSON` | empty | Initial client-key JSON seed |
| `ANALYTICS_ACCOUNT_ID` | empty | Account ID for Analytics Engine queries |
| `ANALYTICS_API_TOKEN` | empty | Requires Account Analytics Read |
| `ANALYTICS_DATASET` | `llmmerge_requests` | Analytics Engine dataset name |

KV-only deployments can also use `KV_FLUSH_INTERVAL_MS`, `KV_DAILY_READ_BUDGET`, `KV_DAILY_WRITE_BUDGET`, and `WORKERS_DAILY_REQUEST_BUDGET` for mirror and admin usage limits.

## Adding Upstreams

Add an upstream in the admin panel or seed it with `UPSTREAMS_JSON`. Most OpenAI-compatible services only need a base URL, API key, model list, and supported paths:

```json
[
  {
    "name": "provider-primary",
    "preset": "custom-openai",
    "base_url": "https://api.example.com/v1",
    "api_key": "your-upstream-api-key",
    "models": ["provider/model-name"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "priority": 1,
    "weight": 1,
    "enabled": true
  }
]
```

Field notes:

- `base_url`: the OpenAI-compatible API root, usually ending in `/v1`.
- `api_key`: the upstream API key; the gateway stores it encrypted.
- `models`: models allowed on this upstream; use `*` to match all models.
- `paths`: gateway paths actually supported by the upstream.
- `priority` and `weight`: used for candidate ordering and load distribution.

The requested model must match both the upstream model configuration and the client permissions. Multiple accounts or same-provider endpoints can be added as separate upstreams with the same `base_url` and different `api_key` values; the gateway selects among them according to the routing policy.

Built-in templates support NVIDIA NIM, DeepInfra, Together AI, DeepSeek, Kimi/Moonshot, MiniMax, OpenRouter, Groq, GLM/Zhipu, Cloudflare Workers AI REST, and custom OpenAI-compatible upstreams. A template only supplies provider defaults; it does not replace the provider's model and path configuration.

## Client Keys And Injection

Generate client keys in the admin panel or seed them with:

```json
[
  {
    "name": "default",
    "key": "sk-gw-change-me",
    "models": ["*"],
    "upstreams": []
  }
]
```

- Empty `models` or `*` allows all models.
- Empty `upstreams` allows all upstreams.
- Prompt/context scopes accept `*`, `__all__`, `__none__`, client `id`, name, or full key.

Gateway rules and matching reference context are rebuilt for every Chat, Messages, and Responses request. Responses receives them through `instructions`, not as a fake user message. On-demand context can match keywords, model, and client; force-all injection skips keyword filtering but still obeys the maximum character limit.

`history_max_chars` defaults to `0` (no trimming). A positive value trims ordinary conversation history while retaining gateway rules, reference context, and client system/developer messages. Use `/v1/responses/compact` when a long Responses conversation needs explicit compaction.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, storage, and binding status |
| `GET` | `/v1/models` | Aggregated model list |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | Native Completions or single-prompt Chat fallback |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/responses` | Responses compatibility layer |
| `POST` | `/v1/responses/compact` | Compact Responses history |
| `GET` | `/v1/responses/{id}` | Read a stored response |
| `POST` | `/v1/responses/{id}/cancel` | Cancel a streaming response |
| `POST` | `/v1/messages` | Anthropic/Claude-style requests |

OpenAI SDK example:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-...",
  baseURL: "https://your-domain.example/v1",
});

const response = await client.chat.completions.create({
  model: "provider/model-name",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
});
```

## Routing And Performance

- `failover`: try another upstream after failure, timeout, or cooldown.
- `load_balance`: rank by weight, active requests, client-key affinity, and recent latency.
- `coordination_level`: controls spreading away from active/reserved requests; default is `3`.
- `soft_interval_ms`: advisory staggering when several keys choose the same upstream; default is `50`, and `0` disables it.
- `ROUTE_COORDINATOR`: cross-edge short reservations; model requests still go directly from each edge to the upstream.
- Streaming failover only happens before the first visible output. Once bytes reach the client, the gateway never replays the request, avoiding duplicate text or tool calls.
- `Hedged Request` and `Gateway Fast` race multiple candidates. For a multi-account pool or concurrency-limited provider, they are usually best disabled because they intentionally increase concurrency.
- SSE sends a keepalive comment every five seconds to keep proxy connections open; keepalives are not model output.

Health checks only verify the upstream `/models` endpoint and do not prove that a specific model is ready. Use the admin speed test for model-level verification. Long-reasoning models may have slow first bytes, so the gateway uses an appropriate first-byte timeout and can try a fallback upstream.

## Statistics And Troubleshooting

- Memory: live requests, tokens, logs, and active upstreams for the current isolate.
- Analytics Engine: historical statistics and logs.
- D1/DO/KV: configuration, stored responses, current telemetry mirror, and routing state.
- Diagnostic headers include `x-llm-gateway-route-ms`, `x-llm-gateway-dispatch-ms`, `x-llm-gateway-upstream-start-ms`, `x-llm-gateway-upstream`, and `x-llm-gateway-attempts`.
- `/health` confirms whether the request reached the gateway and which storage backend is active.

When no first byte arrives, inspect `x-llm-gateway-upstream-start-ms`. A large value means the request reached upstream dispatch but the provider/model is slow; no upstream start usually points to DO staggering, model permissions, path matching, or timeout configuration.

## Security Notes

- Never commit real upstream API keys or expose them in public logs.
- `ADMIN_TOKEN` protects the admin path; it is not a complete authentication system.
- Keep `API_KEY_CRYPT_SECRET` stable in production. Changing it can make saved upstream keys undecryptable.
- Upstream exports contain plaintext API keys and must be protected.
- In-memory live statistics disappear when an isolate is recycled; use Analytics Engine for history.

## Files

- `_worker.js`: Worker/Pages Advanced Mode entry.
- `admin-page.js`: admin panel.
- `provider-bridges.js`: generic upstream and NVIDIA NIM adapters.
- `presets.js`: upstream templates.
- `wrangler.worker.toml`: Worker deployment configuration.
- `wrangler.toml`: Pages/local development reference configuration.
- `d1_migrations/0001_create_store.sql`: D1 schema migration.
