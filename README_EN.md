# LLM-merge

[中文 README](./README.md)

LLM-merge is an OpenAI-compatible LLM gateway for Cloudflare Workers and Pages Advanced Mode. It combines multiple upstreams and client keys behind one `/v1` endpoint while fetching the model directly from the serving Cloudflare edge.

The current release favors predictable behavior: one request uses one upstream at a time. It only switches to the next candidate when a clear failure occurs before the first visible output.

## Use Cases

- Build a pool of NVIDIA NIM or other OpenAI-compatible keys.
- Give Codex, agents, OpenAI SDKs, and Anthropic Messages one endpoint.
- Restrict upstreams by client key, model, and path.
- Inject system prompts, global context, and on-demand reference material.
- Use Cloudflare edge ingress while connecting directly to the upstream from the serving edge.

## Features

- OpenAI Chat Completions, Completions, Embeddings, and Responses.
- Anthropic Messages compatibility.
- Responses storage, retrieval, cancellation, and `/v1/responses/compact`.
- Generic OpenAI-compatible upstream adapters, including NVIDIA NIM parameter handling.
- Upstream model/path allowlists, priority, weight, cooldown, emergency upstreams, and first-byte timeout overrides.
- Prompt / Context injection with client scopes, model scopes, keyword matching, force-all injection, truncation, and history trimming.
- Admin model refresh, health checks, model speed tests, client-key management, import/export, logs, and statistics.
- Client-scoped `/v1/gateway/status` endpoint for connection and daily token totals.

## Deployment

### Workers

```bash
wrangler deploy --config wrangler.worker.toml
```

### Pages Advanced Mode

Use `_worker.js` as the Pages Advanced Mode entry. No build step is required. Configure production Variables, Secrets, and Bindings in the Pages project settings.

Bindings:

- `llmerge`: primary state storage; D1 is recommended.
- `ROUTE_COORDINATOR`: optional Durable Object for short cross-edge staggering advice.
- `KV`: compatibility reads and degraded mirrors, not the default primary store.
- `ANALYTICS`: optional Analytics Engine statistics.

Do not enable Smart Placement. Users should enter through a nearby edge and the serving edge should fetch the model upstream directly.

## Storage

The primary backend is selected in this order: `llmerge` Durable Object > `llmerge` D1 > `KV`.

For D1, use binding name `llmerge` and apply:

```bash
wrangler d1 migrations apply <D1_DATABASE_NAME> --remote
```

`ROUTE_COORDINATOR` does not proxy model traffic or store prompts, context, or upstream tokens. Coordination waits for about 50ms at most; timeout, rejection, or errors fail open to local routing. The gateway works without the DO.

## Required Configuration

```txt
ADMIN_TOKEN=replace-with-a-random-value
API_KEY_CRYPT_SECRET=replace-with-a-long-random-secret
```

Admin panel:

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

Use a random admin token in production.

Common variables:

| Variable | Default | Description |
| --- | --- | --- |
| `REQUEST_TIMEOUT_MS` | `180000` | Base upstream timeout; non-streaming requests also have a global response budget |
| `STREAM_IDLE_TIMEOUT_MS` | `900000` | Streaming idle timeout |
| `SSE_KEEPALIVE_MS` | `5000` | SSE comment keepalive interval |
| `UPSTREAM_COOLDOWN_TTL` | `60` | Upstream failure cooldown in seconds |
| `MODEL_CACHE_TTL` | `3600` | Dynamic model-list cache in seconds |
| `UPSTREAMS_JSON` | empty | Initial upstream JSON |
| `CLIENTS_JSON` | empty | Initial client JSON |
| `ANALYTICS_ACCOUNT_ID` | empty | Account ID for Analytics Engine queries |
| `ANALYTICS_API_TOKEN` | empty | Requires Account Analytics Read |
| `ANALYTICS_DATASET` | `llmmerge_requests` | Analytics Engine dataset |

## Adding Upstreams

Configure an upstream in the admin panel or seed it with `UPSTREAMS_JSON`:

```json
[
  {
    "name": "nim-primary",
    "preset": "nvidia-nim",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "your-nim-api-key",
    "models": ["deepseek-ai/deepseek-v4-flash-0731"],
    "paths": ["/v1/chat/completions"],
    "priority": 1,
    "weight": 1,
    "enabled": true,
    "emergency": false
  }
]
```

Key fields:

- `base_url`: upstream OpenAI-compatible API root.
- `api_key`: upstream key, encrypted after save.
- `models`: models allowed on the upstream; `*` matches all.
- `paths`: gateway paths supported by the upstream.
- `priority`: lower values are preferred.
- `weight`: stable spreading among same-priority candidates; it never creates parallel requests.
- `emergency`: tried only after ordinary candidates fail.
- `first_byte_timeout_ms`: optional first-byte override.
- `failover_budget_ms`: total failover budget, default `30000` ms, shared by all candidate keys.

When multiple candidates are available, the default first-byte probe is capped at `8000` ms so an unresponsive key is handed off quickly. Single-upstream requests and explicit `first_byte_timeout_ms` values keep their configured timeout, while the total failover budget still applies.

Client permissions, model/path matching, and `enabled` are always enforced. The gateway does not replace the model requested by the client.

Built-in templates cover NVIDIA NIM, DeepInfra, Together AI, DeepSeek, Kimi/Moonshot, MiniMax, OpenRouter, Groq, GLM/Zhipu, Cloudflare Workers AI REST, and custom OpenAI-compatible upstreams.

### NVIDIA NIM Protocol

The gateway follows NVIDIA's official LLM API contract:

- The usual root is `https://integrate.api.nvidia.com/v1`; requests use `POST /v1/chat/completions` with a Bearer token.
- Bodies use OpenAI Chat Completions. `stream: true` uses SSE and normally ends with `data: [DONE]`. Tools, sampling fields, and reasoning fields are sent only when the model bridge supports them.
- DeepSeek V4 accepts `reasoning_effort` values `none`, `high`, and `max`; GLM, Qwen, Kimi, and other families are translated to their documented NIM fields.
- Some NIM models return `202` with `NVCF-REQID` first. The gateway polls `/v1/status/{requestId}` on the same upstream until a final result or the request budget is reached, instead of returning the temporary `202` to the client.
- Model IDs must be configured using the actual NIM model names. The gateway maps aliases but never silently replaces the client's requested model.

See NVIDIA's official [Models](https://docs.api.nvidia.com/nim/reference/models-1) and [LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis) references.

## Client Keys And Injection

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

Empty or `*` model/upstream lists allow all matching values. Prompt and context scopes accept `*`, `__all__`, `__none__`, client IDs, names, or full keys.

Each Chat, Messages, and Responses request builds a fresh injection snapshot. Model changes, client scopes, or character limits do not reuse an old snapshot. Actual model calls never request the current time.

Responses uses `instructions` for injection instead of pretending gateway context is a user message. On-demand context can match keywords, models, and clients; force-all injection skips keyword filtering but still obeys the maximum character limit.

## Stable Routing

Routing is now a single-upstream sequential policy:

```text
auth and model/path matching
-> ordinary healthy candidates
-> ordinary cooling candidates
-> emergency healthy candidates
-> emergency cooling candidates
-> priority, model specificity, pressure, and recent first-byte ordering
-> one upstream request from the serving edge
```

Failover rules:

- Up to 3 sequential candidates by default, capped at 5.
- Switch only before visible text, tool calls, or a normal completion event.
- `[DONE]`, `response.completed`, and valid completion events are normal endings.
- Client disconnect cancels only the current upstream and never starts another attempt.
- NIM 429s, 5xx responses, first-byte timeouts, empty streams, and clear connection failures update short cooldown state.
- Health checks inform ordering and diagnostics but do not hard-block real requests.

Legacy `hedge_enabled`, `fast_routing`, `hedge_max`, `load_balance`, `coordination_level`, and `soft_interval_ms` fields remain readable for compatibility, but experimental parallel routing is never re-enabled. Requests remain single-upstream.

When `ROUTE_COORDINATOR` is bound, concurrent requests from different edges first use one shared DO candidate pool to select the least-recently reserved eligible key, then connect to the model directly from the serving edge. Coordination is capped at about 50ms and fails open to local ordering when unavailable, slow, or running older code.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, storage, and binding status |
| `GET` | `/v1/models` | Models available to the current client |
| `GET` | `/v1/gateway/status` | Current client connection and daily token totals |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | Completions or prompt fallback |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/responses` | Responses |
| `POST` | `/v1/responses/compact` | Compact Responses history |
| `GET` | `/v1/responses/{id}` | Read a stored response |
| `POST` | `/v1/responses/{id}/cancel` | Cancel a streaming response |
| `POST` | `/v1/messages` | Anthropic Messages |

The status endpoint uses the same client key:

```bash
curl https://your-domain.example/v1/gateway/status \
  -H "Authorization: Bearer sk-gw-..."
```

It returns no full key, upstream key, upstream URL, or other client data.

## Performance And Troubleshooting

- Cloudflare edge handles user ingress nearby.
- The serving edge connects directly to the upstream; model traffic does not pass through the DO.
- SSE sends a comment keepalive every five seconds; keepalives are not model output.
- DO coordination waits about 50ms at most and then fails open. `/health` reports `has_route_coordinator` for the cross-edge binding, while `has_do` only describes the primary state backend.
- Failure state and statistics are recorded in the isolate first and persisted asynchronously.
- First-byte timeout adapts to ordinary and reasoning models, with per-upstream overrides.

Diagnostic headers include `x-llm-gateway-trace-id`, `x-llm-gateway-upstream`, `x-llm-gateway-attempts`, `x-llm-gateway-route-ms`, `x-llm-gateway-dispatch-ms`, and `x-llm-gateway-upstream-start-ms`.

## Agent Helpers

Experimental helpers live in the outer workspace `agent-helpers` directory. They show connection and client token totals only when an Agent explicitly uses the gateway. They require an explicit `/v1` base URL and client key, do not inspect agent configuration or other processes, do not proxy requests, and never use an admin token.

## Security

- Never commit real upstream or client keys.
- `ADMIN_TOKEN` protects the admin path; it is not a complete identity system.
- Keep `API_KEY_CRYPT_SECRET` stable in production.
- Upstream exports contain plaintext keys and must be protected.
- In-memory statistics disappear when an isolate is recycled; use Analytics Engine for history.

## Files

- `_worker.js`: Workers/Pages Advanced Mode entry.
- `gateway-worker.js`: protocol handlers, auth, stable routing, upstream transport, streaming finalization, storage, and admin API.
- `gateway-context.js`: Prompt / Context injection and history trimming.
- `gateway-observability.js`: tracing and failure classification.
- `provider-bridges.js`: generic and NVIDIA NIM adapters.
- `admin-page.js`: admin panel.
- `presets.js`: upstream templates.
- `wrangler.worker.toml`: Worker deployment configuration.
- `wrangler.toml`: Pages/local reference configuration.
