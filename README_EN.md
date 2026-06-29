# Cloudflare Workers LLM Merge

[中文 README](./README.md)

A single-file LLM gateway for Cloudflare Workers, also compatible with Cloudflare Pages Advanced Mode.

It merges multiple upstream LLM API keys behind your own unified endpoint. The current focus is:

- OpenAI-compatible proxying
- Multiple upstream API key aggregation
- Weighted load balancing
- Failover retry
- KV-backed configuration
- Hidden admin dashboard
- Virtual client API key issuance

## Key Features

- Unified OpenAI-compatible `/v1` endpoint
- Multiple providers or multiple keys from the same provider
- Weighted request distribution
- Automatic fallback to the next upstream on failure
- Upstream configuration stored in Cloudflare KV
- Upstream API keys encrypted before storage
- Hidden admin page available only at `/{ADMIN_TOKEN}`
- nginx-style welcome page for all other browser visits
- Virtual `sk-gw-...` style client keys
- Manual upstream model cache refresh

## Current Endpoints

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /{ADMIN_TOKEN}`
- `GET /{ADMIN_TOKEN}/api/config`
- `PUT /{ADMIN_TOKEN}/api/config`
- `POST /{ADMIN_TOKEN}/api/refresh`
- `GET /{ADMIN_TOKEN}/api/clients`
- `POST /{ADMIN_TOKEN}/api/clients`
- `DELETE /{ADMIN_TOKEN}/api/clients/:id`

## Configuration Model

The recommended setup is now "environment variables + KV":

- env vars hold only the root-level settings
- the actual upstream pool config lives in KV
- saving from the admin dashboard overwrites the KV config directly

Notes:

- the Cloudflare KV namespace itself may have any name
- but the Worker binding name must be `KV`
- the code reads from `env.KV`

Minimum env vars:

```env
API_KEY_CRYPT_SECRET=change-me-32-bytes-or-longer
REQUEST_TIMEOUT_MS=90000
UPSTREAM_COOLDOWN_TTL=60
MODEL_CACHE_TTL=3600
```

`ADMIN_TOKEN` is now optional.

- if omitted, the default value is `llmmerge-admin`
- the admin page path becomes `/<default>`, which means `/llmmerge-admin`
- overriding it with your own random value is still strongly recommended

Optional static seed config:

```env
UPSTREAMS_JSON=[{"name":"nim-primary","base_url":"https://integrate.api.nvidia.com/v1","api_key":"nvapi-xxxxxxxx","models":["meta/llama-3.1-8b-instruct"],"paths":["/v1/chat/completions"],"weight":1}]
CLIENTS_JSON=[{"name":"default-client","key":"sk-gw-demo-please-change","models":["*"],"upstreams":["nim-primary"]}]
```

## Admin Dashboard

Access:

```text
https://your-domain.example/{ADMIN_TOKEN}
```

The admin page supports:

- add, edit, and delete upstream entries
- choose preset templates
- fill note, internal name, Base URL, and API key
- configure model allowlist, path allowlist, weight, priority, enabled or disabled state
- toggle `load_balance` / `failover`
- refresh model cache
- create and delete virtual client keys

## Built-in Presets

- NVIDIA NIM
- DeepInfra
- Together AI
- Generic OpenAI-Compatible

## KV Keys Used

- `gateway:config`
- `client:index`
- `client:id:*`
- `client:token:*`
- `cache:models:*`
- `cooldown:upstream:*`

## Routing Strategy

Two switches are supported and can be combined:

- `load_balance`
  distributes traffic across healthy upstreams by weight
- `failover`
  retries the next candidate when an upstream fails

If `load_balance` is disabled, upstreams are attempted by ascending `priority`.

Retryable status codes by default:

- `408`
- `409`
- `425`
- `429`
- `500`
- `502`
- `503`
- `504`

## Local Development

1. Create `.dev.vars`
2. Fill it based on [.dev.vars.example](D:/迁移文件/新建文件夹%20(3)/LLM-merge/.dev.vars.example)
3. Create and bind a KV namespace named `KV` in Cloudflare
4. Run:

```bash
wrangler dev
```

## Deployment

Create KV:

```bash
wrangler kv namespace create KV
```

Then bind that KV namespace to your Cloudflare Workers or Pages project with the binding name `KV`.

In other words:

- the namespace display name can be anything
- the binding variable name must be `KV`

Set secrets:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
wrangler secret put UPSTREAMS_JSON
wrangler secret put CLIENTS_JSON
```

If you do not want to set `ADMIN_TOKEN` explicitly, you may skip it, and the default admin path will be:

```text
/llmmerge-admin
```

Deploy:

```bash
wrangler deploy
```

## OpenAI SDK Example

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});
```

## Intentionally Not Included Yet

- full login system
- fine-grained RBAC
- precise billing and quota tracking
- audit logs
- Responses API
- image, audio, and file endpoints
- dedicated Claude / Anthropic protocol gateway

These are possible later, but intentionally excluded from the minimal version.
