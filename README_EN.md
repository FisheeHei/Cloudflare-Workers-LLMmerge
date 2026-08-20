# LLM-merge

[中文 README](./README.md)

LLM-merge is a single-file LLM aggregation gateway for Cloudflare Workers or Pages Advanced Mode. It combines multiple upstream model providers into one `/v1` Base URL and includes a lightweight admin panel for upstreams, client keys, models, prompts, context, routing, logs, and statistics.

## Features

- OpenAI-compatible endpoints: `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`
- Basic Responses API compatibility: `/v1/responses`
- Claude / Anthropic-style endpoint: `/v1/messages`
- Multiple upstreams with enable/disable, weight, priority, paths, and model allowlists
- Routing: failover, load balancing, Hedged Request, Gateway Fast mode
- Model picker with source grouping, tags, and context-length notes
- NVIDIA NIM bridge for GLM, Qwen, MiniMax, Kimi, DeepSeek, Nemotron, Mistral, and related models
- Prompt / Context injection scoped by client key, with keyword-based context fragments and import/export
- Live in-memory stats + Analytics Engine history, with D1/DO or KV mirror fallback
- Upstream import/export, health checks, model speed tests, and active-upstream display

## Deployment

### 1. Create a project

Deploy as a Worker:

```bash
wrangler deploy
```

For Pages, use Advanced Mode and keep `_worker.js` as the entry file. No build step is required.

### 2. Bind storage (KV / D1 / Durable Object)

Backends are auto-selected in this order: Durable Object `llmerge` > D1 `llmerge` > KV `KV`.

D1 is recommended. The binding name must be:

```txt
llmerge
```

Create the table before first use (the binding name is `llmerge` for both D1 and the optional Durable Object):

```sql
CREATE TABLE IF NOT EXISTS llmmerge_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);
```

The repo includes `d1_migrations/0001_create_store.sql`; the worker also auto-creates the table on first read/write.

KV-only mode still works with the binding name `KV`. Once D1/DO is enabled, KV becomes both a one-time lazy migration source and a low-frequency disaster snapshot for durable keys (gateway config, config snapshots, client keys). If D1 becomes temporarily unavailable, the gateway falls back to the KV snapshot and marks itself degraded, then writes back to D1 once it recovers; existing client keys keep working without re-export.

See `wrangler.worker.toml` for the Worker Durable Object example.

### 3. Bind Analytics Engine

Recommended binding:

```txt
binding: ANALYTICS
dataset: llmmerge_requests
```

To query historical stats in the admin panel, also set:

```txt
ANALYTICS_ACCOUNT_ID = your Cloudflare Account ID
ANALYTICS_API_TOKEN  = API token with Account Analytics Read
```

`ANALYTICS_DATASET` is optional and defaults to `llmmerge_requests`. Set it only if you use another dataset name.

### 4. Set environment variables

Recommended minimum:

```txt
ADMIN_TOKEN=your-admin-path
API_KEY_CRYPT_SECRET=long-random-secret
```

Admin panel:

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

If `ADMIN_TOKEN` is not set, the default admin path is `/llmmerge-admin`. Do not use the default in production.

## Variables

| Variable | Required | Description |
| --- | --- | --- |
| `KV` | Optional | Cloudflare KV binding; lightweight storage when D1/DO is absent |
| `llmerge` | Optional | D1 or Durable Object binding; KV becomes a one-time migration fallback when present |
| `ADMIN_TOKEN` | Recommended | Admin path token |
| `API_KEY_CRYPT_SECRET` | Recommended | Secret used to encrypt upstream API keys; keep stable in production |
| `ANALYTICS` | Optional | Analytics Engine binding for request stats |
| `ANALYTICS_ACCOUNT_ID` | Optional | Account ID for Analytics Engine SQL queries |
| `ANALYTICS_API_TOKEN` | Optional | Requires `Account Analytics Read` |
| `ANALYTICS_DATASET` | Optional | Defaults to `llmmerge_requests` |
| `REQUEST_TIMEOUT_MS` | Optional | Defaults to `180000`; non-streaming requests wait at most 90 seconds to avoid custom-domain 524s |
| `STREAM_IDLE_TIMEOUT_MS` | Optional | Defaults to `900000` |
| `SSE_KEEPALIVE_MS` | Optional | Defaults to `3000`; SSE heartbeat comment interval for streaming responses |
| `UPSTREAM_COOLDOWN_TTL` | Optional | Defaults to `60` seconds |
| `MODEL_CACHE_TTL` | Optional | Defaults to `3600` seconds |
| `KV_FLUSH_INTERVAL_MS` | Optional | KV-only log/stats mirror flush interval; defaults to `120000` |
| `KV_DAILY_READ_BUDGET` | Optional | Admin KV usage-meter budget; defaults to `100000` (Free plan) |
| `KV_DAILY_WRITE_BUDGET` | Optional | Admin KV usage-meter budget; defaults to `1000` (Free plan) |
| `WORKERS_DAILY_REQUEST_BUDGET` | Optional | Admin Workers request-meter budget; defaults to `1000000` |
| `STDTIME_URL` | Optional | Defaults to `https://stdtime.gov.hk/` |
| `UPSTREAMS_JSON` | Optional | Initial upstream seed config |
| `CLIENTS_JSON` | Optional | Initial client-key seed config |

## Upstreams

You can add upstreams in the admin panel or seed them with `UPSTREAMS_JSON`:

```json
[
  {
    "name": "nim-primary",
    "preset": "nvidia-nim",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "nvapi-...",
    "models": ["z-ai/glm-5.2", "moonshotai/kimi-k2.5"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "priority": 1,
    "weight": 1,
    "enabled": true
  }
]
```

Built-in templates:

- NVIDIA NIM
- DeepInfra
- Together AI
- DeepSeek
- Kimi / Moonshot AI
- MiniMax
- OpenRouter
- Groq Cloud
- GLM / Zhipu
- Cloudflare Workers AI REST
- Custom OpenAI-compatible upstream

Cloudflare Workers AI REST uses:

```txt
https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1
```

You can verify a Cloudflare API token first:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer {API_TOKEN}"
```

## Client Keys

The admin panel can generate `sk-gw-...` keys. You can also seed clients with `CLIENTS_JSON`:

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

- Empty `models` or `["*"]` means all models are allowed.
- Empty `upstreams` means all upstreams are allowed.

Scope targets for system prompt / global context / subagent / force-all injection support:

- `*` or `__all__`: all clients
- `__none__`: disabled
- Client `id` / `name` / `key`: exact match

Effective-client scopes only apply to existing client keys; identifiers that do not exist in the client list never trigger injection.

## Usage

OpenAI SDK:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-...",
  baseURL: "https://your-domain.example/v1",
});

const res = await client.chat.completions.create({
  model: "z-ai/glm-5.2",
  messages: [{ role: "user", content: "hello" }],
});
```

Main endpoints:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/v1/models` | Aggregated model list |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | OpenAI Completions (NIM documented protocol; falls back to Chat when no native upstream) |
| `POST` | `/v1/responses` | Responses API compatibility layer (native passthrough for self-hosted NIM) |
| `POST` | `/v1/messages` | Claude / Anthropic-style messages |
| `POST` | `/v1/embeddings` | Embeddings |

Additional Responses API support:

- `GET /v1/responses/{response_id}`: retrieve a previously `store`d response
- `POST /v1/responses/{response_id}/cancel`: cancel an in-flight streaming response
- `previous_response_id`: chain the previous turn (messages, function calls, and results) into the current input

NVIDIA NIM hosted endpoints are strictly adapted to the official Chat Completions schema. When a self-hosted NIM upstream includes `/v1/responses` in its paths, the gateway prefers native Responses API passthrough; otherwise it converts to Chat Completions before aggregation.

DeepSeek models called through any non-official upstream (NIM, OpenRouter, self-hosted endpoints, etc.) have upstream `reasoning_content` passed through; `/v1/responses` and `/v1/messages` calls translate it into reasoning items / thinking blocks. For DeepSeek V4 on NIM (for example `deepseek-ai/deepseek-v4-flash-0731`), the gateway also injects `chat_template_kwargs.reasoning_effort` (`none` / `high` / `max`, defaulting to `high`) per the NIM documentation. Official DeepSeek endpoints keep the original reasoning-hiding behavior.

`/v1/completions` prefers native passthrough to upstreams that declare that path (NIM fields are tightened to the official Completions schema). If no upstream declares `/v1/completions`, a single `prompt` is translated to Chat Completions and converted back to the standard `text_completion` response, for both streaming and non-streaming calls.

## Statistics

- Memory: live recent requests, tokens, logs, and active upstreams
- Analytics Engine: historical logs and statistics
- State mirror: current logs and recent hourly stats while Analytics Engine queries catch up or are unavailable

In short: memory is for live display, Analytics Engine is for long-term history, and D1/DO/KV is for configuration, current telemetry, and shared routing state. With D1/DO enabled, KV reads and writes drop to near zero, which fits the small Free-plan KV quota.

## Routing

- `failover`: try another upstream after failure
- `load_balance`: distribute by weight
- `coordination_level` (0-5, default 3): higher values spread concurrent requests away from active or reserved upstreams, with weight treated as relative capacity
- Successful requests and speed tests write a six-hour latency EWMA to state storage so fresh isolates can prefer recently faster upstreams
- Streaming failover only happens before the first visible output; once bytes are visible to the client, the gateway never replays the request, avoiding duplicate Agent text or tool calls
- An upstream `Retry-After` response becomes an upstream/model cooldown state; a healthy fallback is attempted immediately instead of waiting on the failed provider
- Health checks cache `/models` and minimal Chat capability probes in state storage; probes never include user Prompt, Context, or session data
- Health probes, model refreshes, and speed tests use bounded concurrency so a large upstream pool does not burst through the Workers Request budget
- `Hedged Request`: race multiple upstreams for the same model
- `Gateway Fast mode`: speed up the first two candidates for faster first byte
- Fast + Hedged together: Hedged decides candidate count, Fast speeds up the first two

## Notes

- Do not expose real upstream API keys.
- `ADMIN_TOKEN` only hides the admin path. It is not a full login system.
- Do not rotate `API_KEY_CRYPT_SECRET` casually after production use; saved upstream keys depend on it.
- Upstream export files contain plaintext API keys. Store them carefully.
- Analytics Engine SQL queries require `Account > Account Analytics > Read`.
- In-memory live stats may be lost if the Worker isolate is recycled. Use Analytics Engine as the historical source of truth.
- KV routing state is a short-lived hint, not a strict global lock. Use the Durable Object `llmerge` backend if strongly consistent scheduling is ever required.
- Long-reasoning models may have slow first bytes. Use suitable timeouts, Hedged Request, or Gateway Fast mode.
