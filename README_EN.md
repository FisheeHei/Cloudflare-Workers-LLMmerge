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
- Live in-memory stats + Analytics Engine history, with KV fallback
- Upstream import/export, health checks, model speed tests, and active-upstream display

## Deployment

### 1. Create a project

Deploy as a Worker:

```bash
wrangler deploy
```

For Pages, use Advanced Mode and keep `_worker.js` as the entry file. No build step is required.

### 2. Bind KV

The KV binding name must be:

```txt
KV
```

The KV namespace name can be anything. KV stores gateway config, client keys, upstreams, Prompt, Context, model cache, and cooldown state.

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
| `KV` | Yes | Cloudflare KV binding |
| `ADMIN_TOKEN` | Recommended | Admin path token |
| `API_KEY_CRYPT_SECRET` | Recommended | Secret used to encrypt upstream API keys; keep stable in production |
| `ANALYTICS` | Optional | Analytics Engine binding for request stats |
| `ANALYTICS_ACCOUNT_ID` | Optional | Account ID for Analytics Engine SQL queries |
| `ANALYTICS_API_TOKEN` | Optional | Requires `Account Analytics Read` |
| `ANALYTICS_DATASET` | Optional | Defaults to `llmmerge_requests` |
| `REQUEST_TIMEOUT_MS` | Optional | Defaults to `180000` |
| `STREAM_IDLE_TIMEOUT_MS` | Optional | Defaults to `900000` |
| `UPSTREAM_COOLDOWN_TTL` | Optional | Defaults to `60` seconds |
| `MODEL_CACHE_TTL` | Optional | Defaults to `3600` seconds |
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
| `POST` | `/v1/responses` | Responses API compatibility |
| `POST` | `/v1/messages` | Claude / Anthropic-style messages |
| `POST` | `/v1/embeddings` | Embeddings |

## Statistics

- Memory: live recent requests, tokens, logs, and active upstreams
- Analytics Engine: historical logs and statistics
- KV fallback: batch stats when Analytics Engine is not bound

In short: memory is for live display, Analytics Engine is for history, and KV is for configuration.

## Routing

- `failover`: try another upstream after failure
- `load_balance`: distribute by weight
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
- Long-reasoning models may have slow first bytes. Use suitable timeouts, Hedged Request, or Gateway Fast mode.
