# ⚡ LLM-merge

[中文 README](./README.md)

LLM-merge is a single-file LLM gateway for Cloudflare Workers / Pages Advanced Mode. It merges multiple OpenAI-compatible upstreams behind your own `/v1` endpoint and ships with a hidden admin dashboard for upstreams, client keys, model import, logs, and stats.

> [!IMPORTANT]
> `ADMIN_TOKEN` is only a path segment, not a real login system. Use a random long value in production.

> [!WARNING]
> `API_KEY_CRYPT_SECRET` encrypts upstream API keys. Do not rotate it casually after production data already exists.

## ✨ Features

- Unified OpenAI-compatible endpoints: `/v1/models`, `/v1/chat/completions`, `/v1/embeddings`
- Claude Code-compatible `/v1/messages`, internally converted to OpenAI Chat Completions
- Multiple upstreams, multiple API keys, enable/disable, weight, priority, path allowlist, model allowlist
- `load_balance` and `failover` routing switches
- Hidden admin dashboard at `/{ADMIN_TOKEN}`
- Model picker that can import from a saved upstream or a draft upstream, grouped by source and family
- Virtual `sk-gw-...` client keys with model and upstream restrictions
- KV-backed persistence for config, client keys, model cache, cooldown state, logs, and stats
- Encrypted storage for upstream API keys

## 🧭 Admin dashboard

Dashboard areas:

| Area | Purpose |
| --- | --- |
| Overview | Request counts, success rate, token totals, current model |
| Client Keys | Create, refresh, copy, and delete `sk-gw-...` keys |
| Upstreams | Add, edit, delete upstreams, and configure models, paths, weight, and priority |
| Model Picker | Pull models from an upstream and filter by source / family before writing back |
| Logs & Diagnostics | Recent requests, health checks, upstream capability detection |
| Global Settings | Timeout, cooldown, model cache TTL, routing switches |

The dashboard supports:

- add, edit, and delete upstreams
- auto-save on upstream add / delete
- manual save for normal field edits
- import models from the current draft upstream or from an existing saved upstream
- filter models by source and family; Workers AI hides `@cf/` in the picker display while keeping full model IDs in config
- export and import upstream config files
- inspect upstream health and latency
- toggle `load_balance` / `failover`
- create, refresh, and delete virtual client keys
- view recent logs, 24h stats, current model, and token totals

## 🚀 Deployment

### 1. Create a Worker or Pages project

Workers:

```bash
wrangler deploy
```

Pages: use Advanced Mode and point it at `_worker.js`. No frontend build step is needed.

### 2. Bind KV

Create a KV namespace:

```bash
wrangler kv namespace create KV
```

Then bind it as:

```text
KV
```

The namespace display name can be anything. The code only reads `env.KV`.

### 3. Set variables and secrets

Recommended production secrets:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
```

Local development:

```bash
copy .dev.vars.example .dev.vars
```

macOS / Linux:

```bash
cp .dev.vars.example .dev.vars
```

### 4. Open the dashboard

After deploy:

```text
https://your-domain.example/{ADMIN_TOKEN}
```

If `ADMIN_TOKEN` is omitted, the default path is:

```text
/llmmerge-admin
```

Using a random value is still strongly recommended.

## 🔧 Variables

| Variable | Example | Required | Notes |
| --- | --- | --- | --- |
| `KV` | KV binding | Recommended | Cloudflare KV binding used by the dashboard and persistence layer |
| `ADMIN_TOKEN` | `change-me-admin-token` | Recommended | Admin path segment; also accepts `ADMIN`, `admin`, `TOKEN`, `token` |
| `API_KEY_CRYPT_SECRET` | `change-me-32-bytes-or-longer` | Recommended | Encryption secret for upstream API keys |
| `REQUEST_TIMEOUT_MS` | `180000` | No | Upstream first-byte/idle timeout, default `180000` |
| `STDTIME_URL` | `https://stdtime.gov.hk/` | No | Hong Kong Standard Time calibration source; project time zone is `Asia/Hong_Kong` / UTC+8 |
| `UPSTREAM_COOLDOWN_TTL` | `60` | No | Cooldown seconds after a failed upstream, default `60` |
| `MODEL_CACHE_TTL` | `3600` | No | Model list cache seconds, default `3600` |
| `UPSTREAMS_JSON` | see below | No | Initial upstream seed config; KV wins once a saved config exists |
| `CLIENTS_JSON` | see below | No | Initial client key seed config |

## 🔌 Upstream config

`UPSTREAMS_JSON` can be used as a seed, or you can add upstreams directly in the dashboard:

```json
[
  {
    "name": "nim-primary",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "nvapi-xxxxxxxx",
    "models": ["meta/llama-3.1-8b-instruct", "nvidia/nv-embed-v1"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "weight": 3,
    "priority": 1,
    "enabled": true
  }
]
```

| Field | Meaning |
| --- | --- |
| `name` | Internal upstream name |
| `base_url` | OpenAI-compatible API base URL; the Cloudflare Workers AI REST preset builds it from the Account ID |
| `api_key` | Upstream API key; use a Cloudflare API token for the Cloudflare preset; encrypted when saved through the dashboard |
| `models` | Model allowlist; empty means no model restriction |
| `paths` | Path allowlist such as `/v1/chat/completions` or `/v1/embeddings` |
| `weight` | Load-balancing weight |
| `priority` | Attempt order when load balancing is off; smaller is earlier |
| `enabled` | Enabled or disabled |
| `headers` | Optional extra request headers |
| `note` | Optional note |
| `account_id` | Account ID used by the Cloudflare Workers AI REST preset |

Built-in presets:

- NVIDIA NIM
- DeepInfra
- Together AI
- DeepSeek
- OpenRouter
- Cloudflare Workers AI (REST)
- Custom OpenAI-compatible upstream

The Cloudflare Workers AI REST preset follows the official AI Gateway REST API:

- Base URL: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`
- API Key: Cloudflare API token; model calls need `AI Gateway` permission, and model import needs `Workers AI Read` or `Workers AI Write`
- Header: includes `cf-aig-gateway-id: default` by default; edit upstream `headers` if you use another Gateway ID
- Model IDs: Workers AI uses `@cf/author/model`, for example `@cf/moonshotai/kimi-k2.6`
- Model list: the dashboard fetches Cloudflare `/ai/models/search`; use the Cloudflare Model Catalog as the source of truth

Verify the API token first with Cloudflare's official endpoint:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer {API_TOKEN}"
```

## 🔑 Client keys

`CLIENTS_JSON` example:

```json
[
  {
    "name": "default-client",
    "key": "sk-gw-demo-please-change",
    "models": ["*"],
    "upstreams": ["nim-primary"]
  }
]
```

| Field | Meaning |
| --- | --- |
| `name` | Client display name |
| `key` | Client key used to call the gateway; must start with `sk-` |
| `models` | Allowed models; empty or `*` means no restriction |
| `upstreams` | Allowed upstreams; empty means no restriction |

The dashboard can also generate `sk-gw-...` client keys.

## 🧪 Usage

### OpenAI SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});

const completion = await client.chat.completions.create({
  model: "meta/llama-3.1-8b-instruct",
  messages: [{ role: "user", content: "hello" }],
});
```

### Claude Code / Anthropic-style entry

If the client lets you set a custom Anthropic Base URL, point it to:

```text
https://your-domain.example/v1
```

Then use a generated `sk-gw-...` key. `/v1/messages` is converted inside the Worker into an OpenAI Chat Completions request.

## 📡 Endpoints

Public endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness check |
| `GET` | `/v1/models` | Aggregated model list |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions-compatible proxy |
| `POST` | `/v1/embeddings` | OpenAI Embeddings-compatible proxy |
| `POST` | `/v1/messages` | Claude / Anthropic-style messages entry |

Admin endpoints live under:

```text
/{ADMIN_TOKEN}/api/*
```

Common admin actions include reading and saving config, refreshing model cache, health checks, fetching upstream models, detecting upstream capability, creating and deleting client keys, and reading logs / stats.

## 💾 KV keys

| Key | Meaning |
| --- | --- |
| `gateway:config` | Saved gateway config |
| `client:index` | Client key index |
| `client:id:*` | Client records by ID |
| `client:token:*` | Reverse lookup by client key |
| `cache:models:*` | Upstream model cache |
| `cooldown:upstream:*` | Upstream cooldown state |
| `gateway:logs` | Recent request logs |
| `gateway:stats:*` | Hourly aggregated stats |

## 🔀 Routing

- `load_balance` on: split traffic across healthy upstreams by `weight`
- `load_balance` off: try upstreams by `priority`
- `failover` on: retry the next candidate when an upstream fails
- `failover` off: only try the current candidate

Default retryable status codes:

```text
408, 409, 425, 429, 500, 502, 503, 504
```

## ⚠️ Notes

- Never expose real upstream API keys in a public repo or frontend page.
- `ADMIN_TOKEN` is only a hidden path, not authentication.
- Do not rotate `API_KEY_CRYPT_SECRET` lightly once production config exists.
- KV free quotas are limited; logs and stats are batched, but high-traffic setups still need attention.
- Empty upstream `models` means no restriction, not disabled models.
- Empty client `models` or `*` means no restriction.
- Cloudflare Workers AI REST model IDs must use the `@cf/...` format.
- Exported files contain plain API keys. Treat them as secrets and do not share them publicly.
- Cloudflare Workers still have runtime limits; huge responses, very slow upstreams, or long streaming sessions can hit platform constraints.

## 💤 Not included

- Full login system
- Fine-grained RBAC
- Billing / quota accounting
- Long-term audit logs
- Responses API
- Image, audio, and file endpoints

Keep it single-file, low-dependency, and easy to deploy. Add more only when real usage proves it is needed.

## 🙏 Credit

The README structure borrows from [FisheeHei/CF-Workers-SUB](https://github.com/FisheeHei/CF-Workers-SUB).
