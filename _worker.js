const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
};

// ponytail: add max-age so browsers cache preflight for 1h (fewer round-trips)
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-admin-token",
  "access-control-max-age": "3600",
};

const RETRYABLE_STATUSES = new Set([402, 408, 409, 425, 429, 500, 502, 503, 504]);
const MODEL_PATH = "/v1/models";
const CHAT_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const EMBEDDINGS_PATH = "/v1/embeddings";
const MESSAGES_PATH = "/v1/messages";
const GATEWAY_CONFIG_KEY = "gateway:config";
const LOG_KEY = "gateway:logs";
const STATS_PREFIX = "gateway:stats:";
const STATS_WINDOW_HOURS = 24;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MODEL_CACHE_TTL = 3600;
const DEFAULT_COOLDOWN_TTL = 60;
const HK_TIME_ZONE = "Asia/Hong_Kong";
const HK_TIME_ZONE_LABEL = "Hong Kong Standard Time (UTC+8)";
const HK_UTC_OFFSET_MS = 8 * 3600 * 1000;
const STDTIME_URL = "https://stdtime.gov.hk/";
const STDTIME_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const NVIDIA_NIM_RPM_LIMIT = 40;
const NVIDIA_NIM_RPM_WINDOW_MS = 60000;
const CLOUDFLARE_MODEL_SEARCH_PER_PAGE = 100;
const CLOUDFLARE_MODEL_SEARCH_MAX_PAGES = 20;
const VERSION = "v26-07-05-reasoning-compat";
const DEFAULT_ADMIN_TOKEN = "llmmerge-admin";

const PRESET_TEMPLATES = [
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    base_url: "https://integrate.api.nvidia.com/v1",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: false,
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    base_url: "https://api.deepinfra.com/v1/openai",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: false,
  },
  {
    id: "together",
    name: "Together AI",
    base_url: "https://api.together.xyz/v1",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: false,
  },
  {
    id: "workers-ai",
    name: "Cloudflare Workers AI (REST)",
    base_url: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1",
    paths: [CHAT_PATH],
    requires_base_url: false,
    requires_account_id: true,
    headers: { "cf-aig-gateway-id": "default" },
  },
  {
    id: "custom",
    name: "\u81ea\u5b9a\u4e49",
    base_url: "",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: true,
  },
];

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = normalizePathname(url.pathname);
      const pathnameLower = pathname.toLowerCase();
      const app = createApp(env);
      scheduleStdTimeSync(app, ctx);
      const adminRoute = matchAdminRoute(pathnameLower, app);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      if (pathname === "/health") {
        return withCorsResponse(
          json(
            {
              ok: true,
              mode: "openai-compatible-gateway",
              has_kv: Boolean(app.kv),
              now: hkNowIso(),
              time_zone: HK_TIME_ZONE_LABEL,
            },
            200,
          ),
        );
      }

      if (request.method === "GET" && adminRoute?.kind === "page") {
        // ponytail: ETag-based conditional request — CDN caches, revalidates with 304
        var inm = request.headers.get("if-none-match") || ""; if (inm.includes(VERSION)) {
          return new Response(null, { status: 304, headers: { etag: '"'+VERSION+'"', "cache-control": "public, max-age=0, must-revalidate" } });
        }
        const pageBody = renderAdminPage(url.origin);
        const pageHdrs = new Headers(HTML_HEADERS);
        pageHdrs.set("cache-control", "public, max-age=0, must-revalidate");
        pageHdrs.set("etag", '"'+VERSION+'"');
        return new Response(pageBody, { status: 200, headers: pageHdrs });
      }

      if (adminRoute?.kind === "api") {
        return await handleAdminApi(request, url, pathnameLower, app, adminRoute.basePath);
      }

      if (pathname === MODEL_PATH && request.method === "GET") {
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        const res = await listModels(client, runtime);
        const hdrs = new Headers(res.headers);
        hdrs.set("cache-control", "public, max-age=30");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: hdrs });
      }

      if (
        (pathname === CHAT_PATH || pathname === EMBEDDINGS_PATH) &&
        request.method === "POST"
      ) {
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        const bodyText = await request.text();
        const payload = parseJsonBody(bodyText);
        const requestedModel = payload.model;

        if (!requestedModel || typeof requestedModel !== "string") {
          return withCorsResponse(
            json(openAiError("`model` is required.", "invalid_request_error"), 400),
          );
        }
        const model = await resolveClientModelAlias(client, runtime, requestedModel);
        const proxyBodyText = model === requestedModel ? bodyText : JSON.stringify({ ...payload, model });

        const started = Date.now();
        var pt = Math.max(1, Math.round(proxyBodyText.length / 4));
        let proxyResponse;
        try {
          proxyResponse = await proxyRequest({
            client,
            model,
            pathname,
            request,
            bodyText: proxyBodyText,
            runtime,
            search: url.search,
          });
        } catch (error) {
          recordRequestLog(app, {
            ts: hkNowIso(),
            client: client.name || client.id || "client",
            upstream: error.upstreamName || "none",
            model,
            path: pathname,
            status: error.statusCode || 502,
            latency_ms: Date.now() - started,
            prompt_tokens: pt,
            completion_tokens: 0,
          }, ctx);
          throw error;
        }

        const upstreamResp = proxyResponse.response;
        const headers = new Headers(upstreamResp.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
        headers.set("x-llm-gateway-upstream", proxyResponse.upstream.name);
        headers.set("x-llm-gateway-client", client.name || client.id || "client");
        headers.set("x-llm-gateway-attempts", String(proxyResponse.attempts));

        return await buildLoggedProxyResponse({
          app,
          bodyText: proxyBodyText,
          client,
          ctx,
          headers,
          model,
          pathname,
          requestPayload: payload,
          proxyResponse,
          started,
          upstreamResp,
        });
      }

      if (pathname === RESPONSES_PATH && request.method === "POST") {
        return await handleResponsesRequest(request, url, app, ctx);
      }

      // ponytail: translate Anthropic messages <-> OpenAI chat.completions for Claude Code compatibility.
      if (pathname === MESSAGES_PATH && request.method === "POST") {
        const started = Date.now();
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        const bodyText = await request.text();
        const anthropicPayload = parseJsonBody(bodyText);
        const requestedModel = anthropicPayload.model;

        if (!requestedModel || typeof requestedModel !== "string") {
          return withCorsResponse(
            json({ type: "error", error: { type: "invalid_request_error", message: "`model` is required." } }, 400),
          );
        }
        const model = await resolveClientModelAlias(client, runtime, requestedModel);

        // Anthropic -> OpenAI request translation
        const openaiMessages = [];
        if (anthropicPayload.system && typeof anthropicPayload.system === "string") {
          openaiMessages.push({ role: "system", content: anthropicPayload.system });
        }
        for (const msg of (anthropicPayload.messages || [])) {
          openaiMessages.push({ role: msg.role, content: typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.map((b) => b.text || "").join("") : "") });
        }

        const openaiBody = JSON.stringify({
          model,
          messages: openaiMessages,
          max_tokens: anthropicPayload.max_tokens,
          temperature: anthropicPayload.temperature,
          top_p: anthropicPayload.top_p,
          stop: anthropicPayload.stop_sequences,
        });

        let proxyResponse;
        try {
          proxyResponse = await proxyRequest({
            client, model,
            pathname: CHAT_PATH,
            request,
            bodyText: openaiBody,
            runtime,
            search: url.search,
          });
        } catch (error) {
          recordRequestLog(app, {
            ts: hkNowIso(),
            client: client.name || client.id || "client",
            upstream: error.upstreamName || "none",
            model,
            path: MESSAGES_PATH,
            status: error.statusCode || 502,
            latency_ms: Date.now() - started,
            prompt_tokens: Math.max(1, Math.round(openaiBody.length / 4)),
            completion_tokens: 0,
          }, ctx);
          throw error;
        }

        const openaiResp = proxyResponse.response;
        const respBody = await openaiResp.text();
        const openaiPayload = parseJsonBody(respBody);
        const choice = (openaiPayload.choices || [])[0] || {};
        const finish = choice.finish_reason || "stop";

        // OpenAI -> Anthropic response translation
        const anthropicResp = {
          id: "msg_" + (openaiPayload.id || crypto.randomUUID()),
          type: "message",
          role: "assistant",
          model: openaiPayload.model || model,
          content: [{ type: "text", text: (choice.message || {}).content || "" }],
          stop_reason: finish === "stop" ? "end_turn" : finish === "length" ? "max_tokens" : "end_turn",
          stop_sequence: null,
          usage: openaiPayload.usage ? {
            input_tokens: openaiPayload.usage.prompt_tokens || 0,
            output_tokens: openaiPayload.usage.completion_tokens || 0,
          } : { input_tokens: 0, output_tokens: 0 },
        };

        const headers = new Headers(openaiResp.headers);
        headers.set("content-type", "application/json; charset=utf-8");
        headers.set("x-llm-gateway-upstream", proxyResponse.upstream.name);
        headers.set("x-llm-gateway-client", client.name || client.id || "client");
        headers.set("x-llm-gateway-attempts", String(proxyResponse.attempts));
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
          headers.set(k, v);
        }

        const loggedStatusMsg = openaiResp.ok ? openaiResp.status : (openaiResp.status || 502);
        var msgLogEntry = {
          ts: hkNowIso(),
          client: client.name || client.id || "client",
          upstream: proxyResponse.upstream.name,
          model,
          path: MESSAGES_PATH,
          status: loggedStatusMsg,
          latency_ms: Date.now() - started,
          prompt_tokens: anthropicResp.usage ? anthropicResp.usage.input_tokens || 0 : 0,
          completion_tokens: anthropicResp.usage ? anthropicResp.usage.output_tokens || 0 : 0,
        };
        recordRequestLog(app, msgLogEntry, ctx);

        return new Response(JSON.stringify(anthropicResp), {
          status: openaiResp.ok ? 200 : openaiResp.status,
          headers,
        });
      }

      if (env.ASSETS && request.method === "GET" && pathname !== "/") {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      }

      if (request.method === "GET") {
        return html(renderNginxWelcomePage());
      }

      return withCorsResponse(json(openAiError("Not found.", "not_found_error"), 404));
    } catch (error) {
      return withCorsResponse(
        json(
          openAiError(error.message || "Internal error.", mapErrorType(error.statusCode)),
          error.statusCode || 500,
        ),
      );
    }
  },
};

// ponytail: cache createApp result per-isolate since env is stable across requests
var _cachedApp = null;
var _cachedEnvRef = null;
// ponytail: per-isolate EWMA, KV-backed global scores only if cross-edge routing matters
var _upstreamLatency = {};
// ponytail: per-isolate NIM RPM window starts on first request; KV not worth it for provider-side soft guard
var _nimMinuteCounters = {};
// ponytail: short runtime cache saves KV + decrypt on hot path; config save invalidates it
var _runtimeCache = null;
var _runtimeCacheTs = 0;
var RUNTIME_CACHE_TTL_MS = 30000;
var _stdTimeOffsetMs = 0;
var _stdTimeSyncedAt = 0;
var _stdTimeSyncing = null;

function createApp(env) {
  if (_cachedApp && _cachedEnvRef === env) return _cachedApp;
  const adminToken = pickAdminToken(env);

  if (!/^[A-Za-z0-9._~-]+$/.test(adminToken)) {
    throw badConfig("ADMIN_TOKEN may only contain URL-safe characters.");
  }

  _cachedApp = {
    adminPath: "/" + adminToken,
    adminPaths: buildAdminPathAliases(adminToken),
    adminToken,
    defaultCooldownTtl: parsePositiveInt(env.UPSTREAM_COOLDOWN_TTL, DEFAULT_COOLDOWN_TTL),
    defaultModelCacheTtl: parsePositiveInt(env.MODEL_CACHE_TTL, DEFAULT_MODEL_CACHE_TTL),
    defaultTimeoutMs: parsePositiveInt(env.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    encryptionSecret: String(env.API_KEY_CRYPT_SECRET || adminToken || ""),
    env,
    envClients: parseJsonEnvArray(env.CLIENTS_JSON, "CLIENTS_JSON"),
    envUpstreams: parseJsonEnvArray(env.UPSTREAMS_JSON, "UPSTREAMS_JSON"),
    kv: env.KV || null,
    stdTimeUrl: String(env.STDTIME_URL || STDTIME_URL),
  };
  _cachedEnvRef = env;
  return _cachedApp;
}

function scheduleStdTimeSync(app, ctx) {
  if (!ctx || typeof ctx.waitUntil !== "function") return;
  if (_stdTimeSyncing || Date.now() - _stdTimeSyncedAt < STDTIME_SYNC_INTERVAL_MS) return;
  _stdTimeSyncing = syncStdTime(app).finally(() => { _stdTimeSyncing = null; });
  ctx.waitUntil(_stdTimeSyncing);
}

async function syncStdTime(app) {
  const localStart = Date.now();
  try {
    const resp = await fetch(app.stdTimeUrl, {
      method: "HEAD",
      headers: { "cache-control": "no-cache" },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(1500) : undefined,
    });
    const serverMs = Date.parse(resp.headers.get("date") || "");
    if (Number.isFinite(serverMs)) {
      _stdTimeOffsetMs = serverMs + Math.round((Date.now() - localStart) / 2) - Date.now();
    }
  } catch {}
  _stdTimeSyncedAt = Date.now();
}

function hkNowMs() {
  return Date.now() + _stdTimeOffsetMs;
}

function hkNowIso(ms = hkNowMs()) {
  const d = new Date(ms + HK_UTC_OFFSET_MS);
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0") + "T" +
    String(d.getUTCHours()).padStart(2, "0") + ":" +
    String(d.getUTCMinutes()).padStart(2, "0") + ":" +
    String(d.getUTCSeconds()).padStart(2, "0") + "." +
    String(d.getUTCMilliseconds()).padStart(3, "0") + "+08:00";
}

function hkHourKey(value) {
  const ms = typeof value === "number" ? value : Date.parse(value || hkNowIso());
  const d = new Date((Number.isFinite(ms) ? ms : hkNowMs()) + HK_UTC_OFFSET_MS);
  return d.getUTCFullYear() + "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(d.getUTCDate()).padStart(2, "0") + ":" +
    String(d.getUTCHours()).padStart(2, "0");
}

// ponytail: in-memory batch for stats + logs, flush every 90s to KV
var _pendingLogs = [];
var _pendingStats = {}; // hourKey -> bucket
var _lastFlush = Date.now();
var FLUSH_INTERVAL_MS = 15 * 60 * 1000;
var FLUSH_PENDING_LIMIT = 200;

// ponytail: appendLog just pushes; caller calls flushBatch after log+stats
function appendLog(app, entry) {
  _pendingLogs.push(entry);
  if (_pendingLogs.length > 200) _pendingLogs.splice(0, _pendingLogs.length - 200);
}

function recordStats(app, entry) {
  var hour = hkHourKey(entry.ts);
  if (!_pendingStats[hour]) {
    _pendingStats[hour] = emptyStatsBucket();
  }
  addStatsEntry(_pendingStats[hour], entry);
}

function recordRequestLog(app, entry, ctx) {
  appendLog(app, entry);
  recordStats(app, entry);
  scheduleLogFlush(app, ctx);
}

function scheduleLogFlush(app, ctx) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(flushBatch(app, true));
  } else {
    flushBatch(app);
  }
}

async function flushBatch(app, force = false) {
  if (!app.kv) return;
  var now = Date.now();
  // ponytail: Free KV has tight write limits; dashboard reads merge pending memory instead.
  if (!force && now - _lastFlush < FLUSH_INTERVAL_MS && _pendingLogs.length < FLUSH_PENDING_LIMIT) return;
  _lastFlush = now;
  try { await _doFlush(app); } catch { /* flush failures must not break */ }
}

// ponytail: parallel log+stats flush instead of sequential blocks
async function _doFlush(app) {
  var logPromise = Promise.resolve();
  if (_pendingLogs.length > 0) {
    var logsToFlush = _pendingLogs.splice(0);
    logPromise = (async () => {
      var raw = await app.kv.get(LOG_KEY, "json");
      var existing = Array.isArray(raw) ? raw : [];
      existing.push(...logsToFlush);
      if (existing.length > 50) existing.splice(0, existing.length - 50);
      await app.kv.put(LOG_KEY, JSON.stringify(existing));
    })();
  }
  var statsPromise = Promise.resolve();
  var keys = Object.keys(_pendingStats);
  if (keys.length > 0) {
    var deltas = {};
    for (var k of keys) { deltas[k] = _pendingStats[k]; delete _pendingStats[k]; }
    statsPromise = Promise.all(keys.map(async function(hourKey) {
      var delta = deltas[hourKey];
      var raw = await app.kv.get(STATS_PREFIX + hourKey, "json");
      var bucket = mergeStatsBucket(raw, delta);
      await app.kv.put(STATS_PREFIX + hourKey, JSON.stringify(bucket), { expirationTtl: STATS_WINDOW_HOURS * 3600 + 3600 });
    }));
  }
  await Promise.all([logPromise, statsPromise]);
}

function emptyStatsBucket() {
  return { total: 0, success: 0, fail: 0, prompt_tokens: 0, completion_tokens: 0, upstreams: {}, models: {}, model_statuses: {} };
}

function addStatsEntry(bucket, entry) {
  bucket.total += 1;
  if (entry.status >= 200 && entry.status < 400) bucket.success += 1;
  else bucket.fail += 1;
  bucket.prompt_tokens += entry.prompt_tokens || 0;
  bucket.completion_tokens += entry.completion_tokens || 0;
  var up = entry.upstream || "unknown";
  bucket.upstreams[up] = (bucket.upstreams[up] || 0) + 1;
  var mdl = entry.model || "unknown";
  bucket.models[mdl] = (bucket.models[mdl] || 0) + 1;
  if (!bucket.model_statuses) bucket.model_statuses = {};
  var status = entry.status >= 200 && entry.status < 400 ? "success" : "fail";
  var modelStatus = bucket.model_statuses[mdl] || { success: 0, fail: 0 };
  modelStatus[status] += 1;
  bucket.model_statuses[mdl] = modelStatus;
}

function mergeStatsBucket(base, delta) {
  var bucket = (base && typeof base === "object") ? {
    total: base.total || 0,
    success: base.success || 0,
    fail: base.fail || 0,
    prompt_tokens: base.prompt_tokens || 0,
    completion_tokens: base.completion_tokens || 0,
    upstreams: { ...(base.upstreams || {}) },
    models: { ...(base.models || {}) },
    model_statuses: { ...(base.model_statuses || {}) },
  } : emptyStatsBucket();
  if (!delta || typeof delta !== "object") return bucket;
  bucket.total += delta.total || 0;
  bucket.success += delta.success || 0;
  bucket.fail += delta.fail || 0;
  bucket.prompt_tokens += delta.prompt_tokens || 0;
  bucket.completion_tokens += delta.completion_tokens || 0;
  for (var u in (delta.upstreams || {})) bucket.upstreams[u] = (bucket.upstreams[u] || 0) + delta.upstreams[u];
  for (var m in (delta.models || {})) bucket.models[m] = (bucket.models[m] || 0) + delta.models[m];
  for (var sm in (delta.model_statuses || {})) {
    var next = delta.model_statuses[sm] || {};
    var prev = bucket.model_statuses[sm] || { success: 0, fail: 0 };
    bucket.model_statuses[sm] = {
      success: (prev.success || 0) + (next.success || 0),
      fail: (prev.fail || 0) + (next.fail || 0),
    };
  }
  return bucket;
}

async function getMergedLogs(app) {
  const raw = app.kv ? await app.kv.get(LOG_KEY, "json") : [];
  return (Array.isArray(raw) ? raw : []).concat(_pendingLogs).slice(-50).reverse();
}

async function buildLoggedProxyResponse({ app, bodyText, client, ctx, headers, model, pathname, requestPayload, proxyResponse, started, upstreamResp }) {
  const fallbackPrompt = Math.max(1, Math.round(bodyText.length / 4));
  const log = (usage) => recordRequestLog(app, {
    ts: hkNowIso(),
    client: client.name || client.id || "client",
    upstream: proxyResponse.upstream.name,
    model,
    path: pathname,
    status: upstreamResp.ok ? upstreamResp.status : (upstreamResp.status || 502),
    latency_ms: Date.now() - started,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
  }, ctx);

  if (!upstreamResp.ok) {
    log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 });
    return new Response(upstreamResp.body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  const contentType = upstreamResp.headers.get("content-type") || "";
  if (pathname === CHAT_PATH && requestPayload.stream === true && upstreamResp.body) {
    const body = trackOpenAiStreamUsage(upstreamResp.body, fallbackPrompt, log);
    return new Response(body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  if (contentType.includes("application/json")) {
    const textBody = await upstreamResp.text();
    const payload = safeJson(textBody);
    const usage = normalizeOpenAiLogUsage(payload?.usage, fallbackPrompt, estimateOpenAiCompletionTokens(payload));
    log(usage);
    return new Response(textBody, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 });
  return new Response(upstreamResp.body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
}

function trackOpenAiStreamUsage(body, fallbackPrompt, onDone) {
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let outputText = "";
  let logged = false;
  const finish = () => {
    if (logged) return;
    logged = true;
    onDone(normalizeOpenAiLogUsage(usage, fallbackPrompt, estimateTokens(outputText)));
  };

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          readOpenAiStreamBlocks(buffer, (rest) => { buffer = rest; }, (chunk) => {
            usage = chunk.usage || usage;
            outputText += chatContentToText((chunk.choices || [])[0]?.delta?.content || "");
          });
          controller.enqueue(value);
        }
        if (buffer) readOpenAiStreamBlocks(buffer + "\n\n", (rest) => { buffer = rest; }, (chunk) => {
          usage = chunk.usage || usage;
          outputText += chatContentToText((chunk.choices || [])[0]?.delta?.content || "");
        });
        finish();
        controller.close();
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
  });
}

function readOpenAiStreamBlocks(text, setRest, onChunk) {
  const blocks = text.split(/\r?\n\r?\n/);
  setRest(blocks.pop() || "");
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") continue;
    const chunk = safeJson(data);
    if (chunk) onChunk(chunk);
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeOpenAiLogUsage(usage, fallbackPrompt, fallbackCompletion) {
  return {
    prompt_tokens: Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens ?? fallbackPrompt) || 0),
    completion_tokens: Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens ?? fallbackCompletion) || 0),
  };
}

function estimateOpenAiCompletionTokens(payload) {
  const text = (payload?.choices || []).map((choice) => chatContentToText(choice?.message?.content || choice?.text || "")).join("");
  return estimateTokens(text);
}

function estimateTokens(text) {
  return Math.max(0, Math.round(String(text || "").length / 4));
}

async function handleAdminApi(request, url, pathname, app, adminBasePath) {
  if (!app.kv) {
    throw badConfig("A KV binding named `KV` is required for the admin page.");
  }

  const apiPath = pathname.slice(adminBasePath.length);

  if (apiPath === "/api/config" && request.method === "GET") {
    const stored = await getEditableConfig(app);
    return withCorsResponse(
      json(
        {
          ok: true,
          gateway: {
            base_url: `${url.origin}/v1`,
          },
          presets: PRESET_TEMPLATES,
          config: toPublicGatewayConfig(stored),
        },
        200,
      ),
    );
  }

  if (apiPath === "/api/config" && request.method === "PUT") {
    const payload = parseJsonBody(await request.text());
    // ponytail: merge into existing so a partial payload never wipes upstreams
    const existing = await getEditableConfig(app);
    const hasUpstreams = Object.prototype.hasOwnProperty.call(payload, "upstreams");
    const merged = {
      settings: { ...existing.settings, ...(payload.settings || {}) },
      routing: { ...existing.routing, ...(payload.routing || {}) },
      upstreams: hasUpstreams && Array.isArray(payload.upstreams)
        ? payload.upstreams
        : (existing.upstreams || []),
    };
    const normalized = await normalizeGatewayConfigPayload(merged, app);
    await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(normalized));
    invalidateRuntimeCache();

    return withCorsResponse(
      json(
        {
          ok: true,
          message: "Configuration saved.",
          config: toPublicGatewayConfig(normalized),
        },
        200,
      ),
    );
  }

  if (apiPath === "/api/refresh" && request.method === "POST") {
    const runtime = await loadRuntimeConfig(app);
    const result = await refreshModelCache(runtime);
    return withCorsResponse(json({ ok: true, result }, 200));
  }

  if (apiPath === "/api/clients" && request.method === "GET") {
    return withCorsResponse(json(await listClientIndex(app.kv), 200));
  }

  if (apiPath === "/api/clients" && request.method === "POST") {
    const payload = parseJsonBody(await request.text());
    const record = buildClientRecord(payload);
    await saveClientRecord(app.kv, record);

    return withCorsResponse(
      json(
        {
          ok: true,
          client: {
            ...publicClientRecord(record),
            api_key: record.key,
            base_url: `${url.origin}/v1`,
          },
        },
        201,
      ),
    );
  }

  const clientMatch = apiPath.match(/^\/api\/clients\/([^/]+)$/);
  if (clientMatch && request.method === "DELETE") {
    const id = decodeURIComponent(clientMatch[1]);
    await deleteClientRecord(app.kv, id);
    return withCorsResponse(json({ ok: true, id }, 200));
  }

  if (apiPath === "/api/logs" && request.method === "GET") {
    const logs = await getMergedLogs(app);
    return withCorsResponse(json({ ok: true, logs }, 200));
  }

  // ponytail: parallel KV reads for 24h stats instead of sequential loop
  if (apiPath === "/api/stats" && request.method === "GET") {
    const now = hkNowMs();
    const hourKeys = [];
    for (let h = STATS_WINDOW_HOURS - 1; h >= 0; h -= 1) {
      hourKeys.push(hkHourKey(now - h * 3600000));
    }
    const raws = app.kv ? await Promise.all(hourKeys.map((k) => app.kv.get(STATS_PREFIX + k, "json"))) : hourKeys.map(() => null);
    const logs = await getMergedLogs(app);
    const buckets = hourKeys.map((hour, i) => {
      const raw = raws[i];
      return { hour, ...mergeStatsBucket(raw, _pendingStats[hour]) };
    });
    return withCorsResponse(json({ ok: true, buckets, last_model: logs[0]?.model || "", now: hkNowIso(), time_zone: HK_TIME_ZONE_LABEL }, 200));
  }

  if (apiPath === "/api/runtime" && request.method === "GET") {
    return withCorsResponse(json({ ok: true, nim_rpm: getNimRpmSnapshot() }, 200));
  }

      // ponytail: fetch model list from a saved or draft upstream for picker
  if (apiPath === "/api/fetch-models" && request.method === "POST") {
    const payload = parseJsonBody(await request.text());
    let ups = null;
    const uName = payload.name || "";
    if (uName) {
      const runtime = await loadRuntimeConfig(app);
      ups = runtime.upstreams.find((u) => u.name === uName);
      if (!ups) return withCorsResponse(json({ ok: false, error: "Upstream not found" }, 404));
      ups = {
        ...ups,
        account_id: String(payload.account_id || ups.account_id || "").trim(),
        api_key: String(payload.api_key || payload.api_key_value || ups.api_key || "").trim(),
        base_url: String(payload.base_url || ups.base_url || "").trim(),
        headers: { ...normalizeHeaders(ups.headers), ...normalizeHeaders(payload.headers) },
        preset: String(payload.preset || ups.preset || inferPresetId(payload.base_url || ups.base_url)).trim(),
      };
    } else {
      const baseUrl = String(payload.base_url || "").trim();
      const apiKey = String(payload.api_key || payload.api_key_value || "").trim();
      if (!baseUrl || !apiKey) return withCorsResponse(json({ ok: false, error: "Base URL and API Key are required" }, 400));
      ups = {
        name: "draft",
        account_id: String(payload.account_id || "").trim(),
        base_url: baseUrl,
        api_key: apiKey,
        headers: normalizeHeaders(payload.headers),
        preset: String(payload.preset || inferPresetId(baseUrl)).trim(),
      };
    }
    try {
      const models = await fetchUpstreamModelIds(ups, 15000);
      return withCorsResponse(json({ ok: true, models }, 200));
    } catch (err) {
      const status = err.status && err.status < 500 ? err.status : 502;
      return withCorsResponse(json({ ok: false, status: err.status || status, error: err.message }, status));
    }
  }

  if (apiPath === "/api/upstreams/export" && request.method === "GET") {
    const exported = await exportUpstreamGroup(app);
    return withCorsResponse(json({ ok: true, ...exported }, 200));
  }

// ponytail: parallel health checks instead of sequential loop
  if (apiPath === "/api/health" && request.method === "POST") {
    const upstreams = await loadHealthUpstreams(app);
    const results = await Promise.all(
      upstreams.map((upstream) => checkUpstreamHealth(upstream, 10000))
    );
    return withCorsResponse(json({ ok: true, results }, 200));
  }

  if (apiPath === "/api/speed-test" && request.method === "POST") {
    const runtime = await loadRuntimeConfig(app);
    const payload = parseJsonBody(await request.text());
    const model = String(payload.model || "").trim();
    if (!model) {
      return withCorsResponse(json(openAiError("Model is required for speed test.", "invalid_request_error"), 400));
    }
    const upstreamNames = new Set(normalizeStringArray(payload.upstreams));
    const targets = runtime.upstreams
      .filter((upstream) =>
        upstream.enabled !== false &&
        (!upstreamNames.size || upstreamNames.has(upstream.name)) &&
        upstreamSupportsModel(upstream, model) &&
        upstreamSupportsPath(upstream, CHAT_PATH)
      );
    const results = await Promise.all(targets.map((upstream) => speedTestUpstream(runtime, upstream, model)));
    return withCorsResponse(json({ ok: true, results }, 200));
  }

// ponytail: detect uses single getEditableConfig call, not loadRuntimeConfig + getEditableConfig
  const detectMatch = apiPath.match(/^\/api\/upstreams\/([^/]+)\/detect$/);
  if (detectMatch && request.method === "POST") {
    const upstreamName = decodeURIComponent(detectMatch[1]);
    const config = await getEditableConfig(app);
    const upstream = config.upstreams.find((u) => u.name === upstreamName);
    if (!upstream) {
      return withCorsResponse(json(openAiError("Upstream not found.", "not_found_error"), 404));
    }
    const apiKey = await decryptValue(upstream.api_key_encrypted, app.encryptionSecret);
    const started = Date.now();
    try {
      const resp = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, EMBEDDINGS_PATH, ""),
        {
          method: "POST",
          headers: { "authorization": "Bearer " + apiKey, "content-type": "application/json", "accept": "application/json", "user-agent": "cf-llm-gateway/0.3" },
          body: JSON.stringify({ model: "detect", input: "test" }),
        },
        10000,
      );
      const latency = Date.now() - started;
      const ok = resp.ok || resp.status === 400;
      const capability = ok ? "openai" : "claude";
      const paths = ok ? [CHAT_PATH, EMBEDDINGS_PATH] : [CHAT_PATH];
      const target = config.upstreams.find((u) => u.name === upstreamName);
      if (target) {
        target.capability = capability;
        target.paths = paths;
        await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(config));
        invalidateRuntimeCache();
      }
      return withCorsResponse(json({ ok: true, capability, paths, latency_ms: latency }, 200));
    } catch (err) {
      return withCorsResponse(json({ ok: true, capability: "claude", paths: [CHAT_PATH], latency_ms: Date.now() - started }, 200));
    }
  }

  return withCorsResponse(json(openAiError("Admin route not found.", "not_found_error"), 404));
}

async function getEditableConfig(app) {
  const stored = app.kv ? await app.kv.get(GATEWAY_CONFIG_KEY, "json") : null;
  // ponytail: KV data is already normalized; skip re-normalization
  if (stored && typeof stored === "object" && Array.isArray(stored.upstreams)) {
    return stored;
  }

  return buildGatewayConfigFromEnv(app);
}

async function buildGatewayConfigFromEnv(app) {
  const upstreams = [];

  for (let index = 0; index < app.envUpstreams.length; index += 1) {
    const upstream = app.envUpstreams[index];
    const presetId = String(upstream.preset || inferPresetId(upstream.base_url)).trim() || "custom";
    const plaintextKey = upstream.api_key || app.env[upstream.api_key_env] || "";
    const accountId = String(upstream.account_id || "").trim();

    upstreams.push({
      api_key_encrypted: plaintextKey
        ? await ensureEncryptedValue(plaintextKey, app.encryptionSecret)
        : "",
      base_url: resolveBaseUrl(
        presetId,
        upstream.base_url,
        presetById(presetId)?.base_url,
        accountId,
      ),
      enabled: upstream.enabled !== false,
      headers: { ...presetDefaultHeaders(presetId), ...normalizeHeaders(upstream.headers) },
      account_id: accountId,
      id: String(upstream.id || crypto.randomUUID()),
      models: normalizeStringArray(upstream.models),
      name: String(upstream.name || `upstream-${index + 1}`),
      note: String(upstream.note || upstream.name || ""),
      paths: normalizeStringArray(upstream.paths).length
        ? normalizeStringArray(upstream.paths)
        : [...(presetById(presetId)?.paths || [CHAT_PATH, EMBEDDINGS_PATH])],
      preset: presetId,
      priority: parsePriority(upstream.priority, index + 1),
      weight: parsePositiveInt(upstream.weight, 1),
      capability: upstream.capability || null,
    });
  }

  return {
    routing: {
      failover: true,
      hedge_enabled: false,
      hedge_max: 2,
      load_balance: true,
    },
    settings: {
      model_cache_ttl: app.defaultModelCacheTtl,
      request_timeout_ms: app.defaultTimeoutMs,
      system_prompt: String(app.env.SYSTEM_PROMPT || app.env.GLOBAL_SYSTEM_PROMPT || ""),
      upstream_cooldown_ttl: app.defaultCooldownTtl,
    },
    upstreams,
    version: 1,
  };
}

async function normalizeGatewayConfigPayload(payload, app) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Gateway config payload must be a JSON object.");
  }

  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const routing = payload.routing && typeof payload.routing === "object" ? payload.routing : {};
  const upstreamEntries = Array.isArray(payload.upstreams) ? payload.upstreams : [];
  const upstreams = [];

  for (let index = 0; index < upstreamEntries.length; index += 1) {
    const item = upstreamEntries[index];
    if (!item || typeof item !== "object") continue;

    const preset = presetById(item.preset) ? item.preset : "custom";
    const defaults = presetById(preset) || presetById("custom");
    const apiKeyValue = String(item.api_key_value || item.api_key_encrypted || item.api_key || "").trim();
    const accountId = String(item.account_id || "").trim();
    const name = String(item.name || `upstream-${index + 1}`).trim();
    const baseUrl = resolveBaseUrl(preset, item.base_url, defaults.base_url, accountId);

    if (!name) throw httpError(400, "Each upstream needs a name.");
    if (!baseUrl) throw httpError(400, `Upstream ${name} is missing base_url.`);
    if (!apiKeyValue) throw httpError(400, `Upstream ${name} is missing api_key.`);
    if (presetById(preset)?.requires_account_id && !accountId && !String(item.base_url || "").trim()) {
      throw httpError(400, `Upstream ${name} is missing account_id.`);
    }

    upstreams.push({
      api_key_encrypted: await ensureEncryptedValue(apiKeyValue, app.encryptionSecret),
      base_url: baseUrl,
      account_id: accountId,
      enabled: item.enabled !== false,
      headers: { ...presetDefaultHeaders(preset), ...normalizeHeaders(item.headers) },
      id: String(item.id || crypto.randomUUID()),
      models: normalizeStringArray(item.models),
      name,
      note: String(item.note || "").trim(),
      paths: normalizeStringArray(item.paths).length
        ? normalizeStringArray(item.paths)
        : [...defaults.paths],
      preset,
      priority: parsePriority(item.priority, index + 1),
      weight: parsePositiveInt(item.weight, 1),
      capability: item.capability || null,
    });
  }

  return {
    routing: {
      failover: routing.failover !== false,
      hedge_enabled: routing.hedge_enabled === true,
      hedge_max: Math.max(1, Math.min(5, parsePositiveInt(routing.hedge_max, 2))),
      load_balance: routing.load_balance !== false,
    },
    settings: {
      model_cache_ttl: parsePositiveInt(settings.model_cache_ttl, app.defaultModelCacheTtl),
      request_timeout_ms: parsePositiveInt(settings.request_timeout_ms, app.defaultTimeoutMs),
      system_prompt: String(settings.system_prompt || ""),
      upstream_cooldown_ttl: parsePositiveInt(settings.upstream_cooldown_ttl, app.defaultCooldownTtl),
    },
    upstreams,
    version: 1,
  };
}

function toPublicGatewayConfig(config) {
  return {
    routing: config.routing,
    settings: config.settings,
    upstreams: config.upstreams.map((upstream) => ({
      ...upstream,
      capability: upstream.capability || null,
      api_key_value: upstream.api_key_encrypted || "",
    })),
    version: config.version || 1,
  };
}

async function exportUpstreamGroup(app) {
  const editable = await getEditableConfig(app);
  const aesKey = await deriveAesKey(app.encryptionSecret);
  const upstreams = await Promise.all(
    editable.upstreams.map(async (upstream) => ({
      account_id: String(upstream.account_id || "").trim(),
      api_key: await decryptValue(upstream.api_key_encrypted, app.encryptionSecret, aesKey),
      base_url: upstream.base_url,
      capability: upstream.capability || null,
      enabled: upstream.enabled !== false,
      headers: normalizeHeaders(upstream.headers),
      models: normalizeStringArray(upstream.models),
      name: upstream.name,
      note: String(upstream.note || "").trim(),
      paths: normalizeStringArray(upstream.paths),
      preset: upstream.preset || "custom",
      priority: parsePriority(upstream.priority, 1),
      weight: parsePositiveInt(upstream.weight, 1),
    }))
  );

  return {
    exported_at: hkNowIso(),
    upstreams,
    version: editable.version || 1,
  };
}

// ponytail: derive AES key once, decrypt all upstream keys in parallel
async function loadRuntimeConfig(app) {
  const now = Date.now();
  if (_runtimeCache && _runtimeCache.app === app && now - _runtimeCacheTs < RUNTIME_CACHE_TTL_MS) {
    return _runtimeCache.runtime;
  }

  const editable = await getEditableConfig(app);
  const aesKey = await deriveAesKey(app.encryptionSecret);

  const decrypted = await Promise.all(
    editable.upstreams
      .filter((upstream) => upstream.enabled !== false)
      .map(async (upstream) => ({
        ...upstream,
        api_key: await decryptValue(upstream.api_key_encrypted, app.encryptionSecret, aesKey),
      }))
  );

  const runtime = {
    clients: app.envClients.map(normalizeClient),
    kv: app.kv,
    modelCacheTtl: editable.settings.model_cache_ttl,
    requestTimeoutMs: editable.settings.request_timeout_ms,
    routing: editable.routing,
    settings: editable.settings,
    upstreamCooldownTtl: editable.settings.upstream_cooldown_ttl,
    upstreams: decrypted,
  };
  _runtimeCache = { app, runtime };
  _runtimeCacheTs = now;
  return runtime;
}

async function loadHealthUpstreams(app) {
  const editable = await getEditableConfig(app);
  const aesKey = await deriveAesKey(app.encryptionSecret);
  return Promise.all(editable.upstreams.map(async (upstream) => ({
    ...upstream,
    api_key: await decryptValue(upstream.api_key_encrypted, app.encryptionSecret, aesKey),
  })));
}

function invalidateRuntimeCache() {
  _runtimeCache = null;
  _runtimeCacheTs = 0;
}

// ponytail: LRU cache per-isolate for client tokens — saves KV read every proxy request
var _clientCache = {};
var _clientCacheTs = {};
var CLIENT_CACHE_TTL_MS = 60000;

async function requireClient(request, runtime) {
  const token = getBearerToken(request);
  if (!token) {
    throw httpError(401, "Missing bearer token.");
  }

  // ponytail: hit in-memory cache if fresh (<60s)
  var cached = _clientCache[token];
  if (cached && (Date.now() - (_clientCacheTs[token] || 0)) < CLIENT_CACHE_TTL_MS) {
    return cached;
  }

  if (runtime.kv) {
    const kvClient = await runtime.kv.get(clientTokenKey(token), "json");
    if (kvClient?.key) {
      var nc = normalizeClient(kvClient);
      _clientCache[token] = nc;
      _clientCacheTs[token] = Date.now();
      // ponytail: keep cache small, max 50 entries
      var keys = Object.keys(_clientCache);
      if (keys.length > 50) {
        var oldest = keys.reduce(function(a, b) { return _clientCacheTs[a] < _clientCacheTs[b] ? a : b; });
        delete _clientCache[oldest];
        delete _clientCacheTs[oldest];
      }
      return nc;
    }
  }

  const staticClient = runtime.clients.find((item) => item.key === token);
  if (staticClient) {
    _clientCache[token] = staticClient;
    _clientCacheTs[token] = Date.now();
    return staticClient;
  }

  throw httpError(401, "Invalid bearer token.");
}

async function listModels(client, runtime) {
  const allResults = runtime.upstreams
    .filter((upstream) => clientAllowsUpstream(client, upstream.name))
    .flatMap((upstream) => configuredUpstreamModels(upstream)
      .filter((model) => model && model !== "*" && clientAllowsModel(client, model))
      .map((model) => ({ model, upstream })));

  const rows = aliasRowsForModels(allResults).map((row) => ({
    id: row.alias,
    object: "model",
    owned_by: row.upstream.note || row.upstream.name || "gateway",
  }));

  rows.sort((a, b) => a.id.localeCompare(b.id));
  return json(
    {
      object: "list",
      data: rows,
    },
    200,
  );
}

async function resolveClientModelAlias(client, runtime, model) {
  const value = String(model || "").trim();
  if (!value || value.includes("@cf/")) return value;
  if (value.includes("/") || isQwenModel(value)) {
    const allResults = runtime.upstreams
      .filter((upstream) => clientAllowsUpstream(client, upstream.name))
      .flatMap((upstream) => configuredUpstreamModels(upstream)
        .filter((item) => item && item !== "*" && clientAllowsModel(client, item))
        .map((item) => ({ model: item, upstream })));
    const rows = aliasRowsForModels(allResults);
    const hit = rows.find((row) => row.alias === value || row.model === value);
    if (hit) return hit.model;
    const fuzzy = rows.filter((row) =>
      isQwenModel(row.model) && (modelsMatch(value, row.alias) || modelsMatch(value, row.model))
    );
    if (fuzzy.length === 1) return fuzzy[0].model;
  }
  return value;
}

function aliasRowsForModels(items) {
  const seenPairs = new Set();
  const normalized = items.filter((item) => {
    const key = aliasPresetId(item.upstream) + "\n" + item.model;
    if (seenPairs.has(key)) return false;
    seenPairs.add(key);
    return true;
  });
  const baseCounts = {};
  normalized.forEach((item) => {
    const base = modelAliasBase(item.upstream, item.model);
    baseCounts[base] = (baseCounts[base] || 0) + 1;
  });
  return normalized.map((item) => {
    const base = modelAliasBase(item.upstream, item.model);
    return {
      ...item,
      alias: baseCounts[base] > 1 ? modelAliasWithSource(item.upstream, item.model) : base,
    };
  });
}

function aliasPresetId(upstream) {
  return String(upstream?.preset || inferPresetId(upstream?.base_url) || "custom").trim() || "custom";
}

function modelAliasBase(upstream, model) {
  return aliasPresetId(upstream) + "/" + modelSuffix(model);
}

function modelAliasWithSource(upstream, model) {
  const clean = String(model || "").replace(/^@cf\//, "");
  const parts = clean.split("/").filter(Boolean);
  return aliasPresetId(upstream) + "/" + (parts.length > 1 ? parts.slice(-2).join("/") : modelSuffix(model));
}

function modelSuffix(model) {
  const clean = String(model || "").replace(/^@cf\//, "");
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] || clean;
}

function configuredUpstreamModels(upstream) {
  return Array.isArray(upstream.models) ? upstream.models : [];
}

function isQwenModel(model) {
  return String(model || "").toLowerCase().includes("qwen");
}

function modelsMatch(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!isQwenModel(a) && !isQwenModel(b)) return false;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  return lowerA === lowerB || modelSuffix(a).toLowerCase() === modelSuffix(b).toLowerCase();
}

// ponytail: parallel model refresh
async function refreshModelCache(runtime) {
  const results = await Promise.all(
    runtime.upstreams.map(async (upstream) => {
      const models = await getFreshModels(runtime, upstream);
      return { model_count: models.length, name: upstream.name };
    })
  );
  return results;
}

async function getFreshModels(runtime, upstream) {
  if (!runtime.kv) {
    return Array.isArray(upstream.models) ? upstream.models : [];
  }

  try {
    const models = await fetchUpstreamModelIds(upstream, runtime.requestTimeoutMs);

    await runtime.kv.put(
      modelsCacheKey(upstream.name),
      JSON.stringify({
        fetched_at: hkNowIso(),
        models,
      }),
      { expirationTtl: runtime.modelCacheTtl },
    );

    return models;
  } catch {
    return [];
  }
}

async function fetchUpstreamModelIds(upstream, timeoutMs) {
  const workersAi = isWorkersAiUpstream(upstream);
  if (workersAi) {
    return fetchWorkersAiModelIds(upstream, timeoutMs);
  }
  const url = buildUpstreamUrl(upstream.base_url, MODEL_PATH, "");
  const response = await fetchWithTimeout(
    url,
    { method: "GET", headers: buildUpstreamHeaders(null, upstream) },
    timeoutMs,
  );
  if (!response.ok) {
    throw await responseError(response, "OpenAI model list");
  }
  const payload = await response.json();
  return extractOpenAiModelIds(payload);
}

async function fetchWorkersAiModelIds(upstream, timeoutMs) {
  const seen = new Set();
  for (let page = 1; page <= CLOUDFLARE_MODEL_SEARCH_MAX_PAGES; page += 1) {
    const payload = await fetchWorkersAiModelPage(upstream, timeoutMs, page, CLOUDFLARE_MODEL_SEARCH_PER_PAGE);
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    extractWorkersAiModelIds(payload).forEach((model) => seen.add(model));
    const totalPages = Number(payload?.result_info?.total_pages || 0);
    if (rows.length < CLOUDFLARE_MODEL_SEARCH_PER_PAGE || (totalPages && page >= totalPages)) {
      break;
    }
  }
  return Array.from(seen).sort();
}

async function fetchWorkersAiModelPage(upstream, timeoutMs, page, perPage) {
  const response = await fetchWithTimeout(
    buildWorkersAiModelSearchUrl(upstream, page, perPage),
    { method: "GET", headers: buildUpstreamHeaders(null, upstream) },
    timeoutMs,
  );
  if (!response.ok) {
    throw await responseError(response, "Cloudflare Workers AI model search");
  }
  return response.json();
}

async function checkUpstreamHealth(upstream, timeoutMs) {
  const started = Date.now();
  try {
    if (isWorkersAiUpstream(upstream)) {
      const payload = await fetchWorkersAiModelPage(upstream, timeoutMs, 1, CLOUDFLARE_MODEL_SEARCH_PER_PAGE);
      const rows = Array.isArray(payload?.result) ? payload.result : [];
      const total = Number(payload?.result_info?.total_count || payload?.result_info?.count || rows.length);
      return { name: upstream.name, ok: true, status: 200, latency_ms: Date.now() - started, model_count: total };
    }

    let resp = await fetchWithTimeout(
      buildUpstreamUrl(upstream.base_url, MODEL_PATH, ""),
      { method: "GET", headers: buildUpstreamHeaders(null, upstream) },
      timeoutMs,
    );
    if (resp.status === 401 || resp.status === 403) {
      resp = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, CHAT_PATH, ""),
        {
          method: "POST",
          headers: buildUpstreamHeaders(null, upstream),
          body: JSON.stringify({ model: "health-check", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        },
        timeoutMs,
      );
    }
    return { name: upstream.name, ok: resp.ok || resp.status < 500, status: resp.status, latency_ms: Date.now() - started };
  } catch (err) {
    return { name: upstream.name, ok: false, status: err.status || 0, error: err.message, latency_ms: Date.now() - started };
  }
}

async function speedTestUpstream(runtime, upstream, model) {
  const started = Date.now();
  try {
    const resp = await fetchWithTimeout(
      buildUpstreamUrl(upstream.base_url, CHAT_PATH, ""),
      {
        method: "POST",
        headers: buildUpstreamHeaders(null, upstream),
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      },
      Math.min(runtime.requestTimeoutMs, 15000),
    );
    const latency = Date.now() - started;
    if (resp.ok) rememberUpstreamLatency(upstream, latency);
    return { name: upstream.name, ok: resp.ok, status: resp.status, latency_ms: latency };
  } catch (err) {
    return { name: upstream.name, ok: false, status: err.status || 0, error: err.message, latency_ms: Date.now() - started };
  }
}

async function responseError(response, label) {
  const message = await responseErrorMessage(response);
  const suffix = response.status === 401 || response.status === 403
    ? " Check the API token permissions."
    : "";
  const err = new Error(`${label} HTTP ${response.status}${message ? `: ${message}` : ""}.${suffix}`);
  err.status = response.status;
  return err;
}

async function responseErrorMessage(response) {
  try {
    const payload = await response.clone().json();
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      return payload.errors.map((item) => item?.message || item).filter(Boolean).join("; ");
    }
    return payload?.error?.message || payload?.message || "";
  } catch {
    return "";
  }
}

function isWorkersAiUpstream(upstream) {
  return String(upstream?.preset || "") === "workers-ai" || inferPresetId(upstream?.base_url) === "workers-ai";
}

function buildWorkersAiModelSearchUrl(upstream, page = 1, perPage = CLOUDFLARE_MODEL_SEARCH_PER_PAGE) {
  const accountId = String(upstream.account_id || accountIdFromCloudflareBaseUrl(upstream.base_url) || "").trim();
  if (!accountId) {
    throw httpError(400, "Cloudflare Account ID is required to fetch Workers AI models.");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?per_page=${perPage}&page=${page}`;
}

function accountIdFromCloudflareBaseUrl(baseUrl) {
  const match = String(baseUrl || "").match(/\/accounts\/([^/]+)\/ai(?:\/|$)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function extractOpenAiModelIds(payload) {
  return Array.isArray(payload?.data)
    ? Array.from(new Set(payload.data.map((item) => String(item?.id || "").trim()).filter(Boolean))).sort()
    : [];
}

function extractWorkersAiModelIds(payload) {
  const rows = Array.isArray(payload?.result) ? payload.result : [];
  const models = rows
    .map((item) => {
      if (typeof item === "string") return normalizeWorkersAiModelId(item);
      return normalizeWorkersAiModelId(item?.id || item?.name || item?.model || item?.model_id);
    })
    .filter(Boolean);
  return Array.from(new Set(models)).sort();
}

function normalizeWorkersAiModelId(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  if (raw.startsWith("@cf/")) return raw;
  if (raw.startsWith("cf/")) return `@${raw}`;
  return raw.includes("/") ? `@cf/${raw}` : "";
}

async function handleResponsesRequest(request, url, app, ctx) {
  const started = Date.now();
  const runtime = await loadRuntimeConfig(app);
  const client = await requireClient(request, runtime);
  const payload = parseJsonBody(await request.text());
  const translated = translateResponsesRequest(payload);
  const resolvedModel = await resolveClientModelAlias(client, runtime, translated.model);
  if (resolvedModel !== translated.model) {
    translated.model = resolvedModel;
    translated.bodyText = JSON.stringify({ ...parseJsonBody(translated.bodyText), model: resolvedModel });
  }

  try {
    const proxyResponse = await proxyRequest({
      client,
      model: translated.model,
      pathname: CHAT_PATH,
      request,
      bodyText: translated.bodyText,
      runtime,
      search: url.search,
    });

    const upstreamResp = proxyResponse.response;
    const headers = new Headers(upstreamResp.headers);
    headers.set("x-llm-gateway-upstream", proxyResponse.upstream.name);
    headers.set("x-llm-gateway-client", client.name || client.id || "client");
    headers.set("x-llm-gateway-attempts", String(proxyResponse.attempts));
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);

    if (!upstreamResp.ok) {
      recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated.bodyText, null, ctx);
      return new Response(await upstreamResp.text(), { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
    }

    if (translated.stream) {
      headers.set("content-type", "text/event-stream; charset=utf-8");
      headers.set("cache-control", "no-cache");
      recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated.bodyText, null, ctx);
      return new Response(streamResponsesFromChat(upstreamResp, translated.seed), { status: 200, headers });
    }

    const openaiPayload = parseJsonBody(await upstreamResp.text());
    const choice = (openaiPayload.choices || [])[0] || {};
    const text = chatContentToText((choice.message || {}).content || "");
    const responsePayload = makeResponsesPayload(translated.seed, text, openaiPayload.usage);
    headers.set("content-type", "application/json; charset=utf-8");
    recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, 200, translated.bodyText, responsePayload.usage, ctx);
    return new Response(JSON.stringify(responsePayload), { status: 200, headers });
  } catch (error) {
    recordRequestLog(app, {
            ts: hkNowIso(),
      client: client.name || client.id || "client",
      upstream: error.upstreamName || "none",
      model: translated.model,
      path: RESPONSES_PATH,
      status: error.statusCode || 502,
      latency_ms: Date.now() - started,
      prompt_tokens: Math.max(1, Math.round(translated.bodyText.length / 4)),
      completion_tokens: 0,
    }, ctx);
    throw error;
  }
}

function translateResponsesRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Request body must be a JSON object.");
  }
  const model = String(payload.model || "").trim();
  if (!model) {
    throw httpError(400, "`model` is required.");
  }
  if (payload.previous_response_id) {
    throw httpError(400, "`previous_response_id` is not supported by this gateway.");
  }
  if (payload.background === true) {
    throw httpError(400, "`background` is not supported by this gateway.");
  }
  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    throw httpError(400, "Responses tools are not supported by this gateway.");
  }

  const messages = responsesInputToMessages(payload.input, payload.instructions);
  if (messages.length === 0) {
    throw httpError(400, "`input` is required.");
  }

  const chat = { model, messages, stream: payload.stream === true };
  copyIfPresent(payload, chat, ["temperature", "top_p", "presence_penalty", "frequency_penalty", "stop", "seed", "user"]);
  copyIfPresent(payload, chat, ["reasoning", "reasoning_effort", "reasoningEffort", "reasoningSummary", "providerOptions", "provider_options"]);
  const maxTokens = payload.max_output_tokens ?? payload.max_tokens;
  if (maxTokens != null) chat.max_tokens = maxTokens;
  if (payload.text?.format?.type && payload.text.format.type !== "text") {
    chat.response_format = payload.text.format;
  }

  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "")}`;
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  return {
    bodyText: JSON.stringify(chat),
    model,
    stream: chat.stream,
    seed: {
      createdAt: Math.floor(hkNowMs() / 1000),
      id: responseId,
      instructions: typeof payload.instructions === "string" ? payload.instructions : null,
      maxOutputTokens: maxTokens ?? null,
      messageId,
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
      model,
      temperature: payload.temperature ?? null,
      topP: payload.top_p ?? null,
    },
  };
}

function responsesInputToMessages(input, instructions) {
  const messages = [];
  if (typeof instructions === "string" && instructions.trim()) {
    messages.push({ role: "system", content: instructions });
  }

  const rows = Array.isArray(input) ? input : (input == null ? [] : [input]);
  for (const item of rows) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    if (item.role || item.type === "message") {
      messages.push({
        role: normalizeChatRole(item.role || "user"),
        content: responsesContentToChatContent(item.content),
      });
      continue;
    }
    if (item.type === "input_text" || typeof item.text === "string") {
      messages.push({ role: "user", content: String(item.text || "") });
    }
  }

  return messages.filter((msg) => msg.content !== "" && msg.content != null);
}

function responsesContentToChatContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts = [];
  let hasMedia = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = String(part.type || "");
    if (type === "input_image" || part.image_url) {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (url) {
        hasMedia = true;
        parts.push({ type: "image_url", image_url: { url } });
      }
      continue;
    }
    const text = part.text ?? part.content;
    if (text != null) parts.push({ type: "text", text: String(text) });
  }

  return hasMedia ? parts : parts.map((part) => part.text || "").join("");
}

function normalizeChatRole(role) {
  const value = String(role || "user");
  return value === "developer" ? "system" : value;
}

function copyIfPresent(from, to, keys) {
  for (const key of keys) {
    if (from[key] != null) to[key] = from[key];
  }
}

function makeResponsesPayload(seed, text, usage, status = "completed") {
  const message = {
    id: seed.messageId,
    type: "message",
    status,
    role: "assistant",
    content: [{ type: "output_text", text: text || "", annotations: [] }],
  };
  return {
    id: seed.id,
    object: "response",
    created_at: seed.createdAt,
    status,
    error: null,
    incomplete_details: null,
    instructions: seed.instructions,
    max_output_tokens: seed.maxOutputTokens,
    model: seed.model,
    output: status === "completed" ? [message] : [],
    output_text: text || "",
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: seed.temperature,
    text: { format: { type: "text" } },
    tool_choice: "none",
    tools: [],
    top_p: seed.topP,
    truncation: "disabled",
    usage: normalizeResponsesUsage(usage),
    metadata: seed.metadata || {},
  };
}

function normalizeResponsesUsage(usage) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0);
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0);
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: Number(usage?.prompt_tokens_details?.cached_tokens || usage?.input_tokens_details?.cached_tokens || 0) || 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: Number(usage?.completion_tokens_details?.reasoning_tokens || usage?.output_tokens_details?.reasoning_tokens || 0) || 0 },
    total_tokens: Math.max(0, Number(usage?.total_tokens || input + output) || 0),
  };
}

function chatContentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : String(part?.text || part?.content || "")).join("");
}

function recordResponsesLog(app, client, upstreamName, model, started, status, bodyText, usage, ctx) {
  recordRequestLog(app, {
          ts: hkNowIso(),
    client: client.name || client.id || "client",
    upstream: upstreamName,
    model,
    path: RESPONSES_PATH,
    status: status || 200,
    latency_ms: Date.now() - started,
    prompt_tokens: usage?.input_tokens || Math.max(1, Math.round(bodyText.length / 4)),
    completion_tokens: usage?.output_tokens || 1,
  }, ctx);
}

function streamResponsesFromChat(openaiResp, seed) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const write = (event) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const baseMessage = { id: seed.messageId, type: "message", status: "in_progress", role: "assistant", content: [] };

  (async () => {
    let buffer = "";
    let text = "";
    let usage = null;
    try {
      await write({ type: "response.created", response: makeResponsesPayload(seed, "", null, "in_progress") });
      await write({ type: "response.output_item.added", output_index: 0, item: baseMessage });
      await write({ type: "response.content_part.added", item_id: seed.messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });

      const reader = openaiResp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!data || data === "[DONE]") continue;
          let chunk;
          try { chunk = JSON.parse(data); } catch { continue; }
          usage = chunk.usage || usage;
          const delta = chatContentToText((chunk.choices || [])[0]?.delta?.content || "");
          if (!delta) continue;
          text += delta;
          await write({ type: "response.output_text.delta", item_id: seed.messageId, output_index: 0, content_index: 0, delta });
        }
      }

      const donePart = { type: "output_text", text, annotations: [] };
      await write({ type: "response.output_text.done", item_id: seed.messageId, output_index: 0, content_index: 0, text });
      await write({ type: "response.content_part.done", item_id: seed.messageId, output_index: 0, content_index: 0, part: donePart });
      await write({ type: "response.output_item.done", output_index: 0, item: { ...baseMessage, status: "completed", content: [donePart] } });
      await write({ type: "response.completed", response: makeResponsesPayload(seed, text, usage) });
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (error) {
      await write({ type: "error", error: { message: error.message || "Stream error.", type: "server_error" } });
    } finally {
      await writer.close();
    }
  })();

  return readable;
}

async function proxyRequest({ client, model, pathname, request, bodyText, runtime, search }) {
  if (pathname === CHAT_PATH) {
    bodyText = applyGlobalSystemPrompt(bodyText, runtime.settings?.system_prompt);
  }

  const candidates = runtime.upstreams.filter((upstream) => {
    if (!clientAllowsUpstream(client, upstream.name)) {
      return false;
    }
    if (!clientAllowsModel(client, model)) {
      return false;
    }
    if (!upstreamSupportsModel(upstream, model)) {
      return false;
    }
    if (!upstreamSupportsPath(upstream, pathname)) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    throw httpError(404, `No upstream available for model: ${model}`);
  }

  const attempts = await orderUpstreams(runtime, candidates);
  const maxAttempts = runtime.routing.failover === false ? 1 : attempts.length;
  if (runtime.routing.hedge_enabled === true && maxAttempts > 1) {
    return hedgedProxyRequest({ attempts: attempts.slice(0, Math.min(maxAttempts, runtime.routing.hedge_max || 2)), bodyText, pathname, request, runtime, search });
  }
  let lastError = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const upstream = attempts[index];
    const isLast = index === maxAttempts - 1;

    try {
      if (!takeNimMinuteSlot(upstream)) {
        lastError = new Error(`NVIDIA NIM RPM limit reached for ${upstream.name}`);
        lastError.upstreamName = upstream.name;
        continue;
      }
      const upstreamStarted = Date.now();
      const response = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, pathname, search),
        {
          method: request.method,
          headers: buildUpstreamHeaders(request, upstream),
          body: sanitizeProxyBody(bodyText, upstream),
        },
        runtime.requestTimeoutMs,
      );
      const upstreamLatency = Date.now() - upstreamStarted;

      const shouldRetry = runtime.routing.failover !== false && await isRetryableUpstreamResponse(response);
      if (shouldRetry) {
        lastError = new Error(`HTTP ${response.status}`);
        lastError.upstreamName = upstream.name;
        await markUpstreamFailure(runtime, upstream, response.status);
      } else {
        await clearUpstreamFailure(runtime, upstream);
        rememberUpstreamLatency(upstream, upstreamLatency);
      }

      if (!shouldRetry || isLast) {
        return {
          attempts: index + 1,
          response,
          upstream,
        };
      }
    } catch (error) {
      lastError = error;
      lastError.upstreamName = upstream.name;
      await markUpstreamFailure(runtime, upstream, 599);
      if (isLast) {
        break;
      }
    }
  }

  const err = httpError(502, lastError?.message || "All upstreams failed.");
  err.upstreamName = lastError?.upstreamName || "none";
  throw err;
}

function applyGlobalSystemPrompt(bodyText, prompt) {
  const text = String(prompt || "");
  if (!text.trim() || !bodyText) return bodyText;

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  if (!Array.isArray(payload.messages)) return bodyText;
  payload.messages = payload.messages.concat([{ role: "system", content: text }]);
  return JSON.stringify(payload);
}

async function isRetryableUpstreamResponse(response) {
  if (RETRYABLE_STATUSES.has(response.status)) return true;
  if (response.ok) return false;
  try {
    const body = await response.clone().text();
    return body.includes("DEGRADED function cannot be invoked") ||
      /Function id ['"][^'"]+['"].*Specified function .* is not found/i.test(body);
  } catch {
    return false;
  }
}

async function hedgedProxyRequest({ attempts, bodyText, pathname, request, runtime, search }) {
  const controllers = attempts.map(() => new AbortController());
  const hedgeDelayMs = Math.max(100, Math.floor(runtime.requestTimeoutMs / Math.max(2, attempts.length + 1)));
  let done = false;

  function launchLater(index) {
    const upstream = attempts[index];
    return sleep(index * hedgeDelayMs).then(async () => {
      if (done) return { cancelled: true, upstream, index };
      if (!takeNimMinuteSlot(upstream)) {
        return { limited: true, error: new Error(`NVIDIA NIM RPM limit reached for ${upstream.name}`), upstream, index };
      }
      const started = Date.now();
      try {
        const response = await fetchWithTimeout(
          buildUpstreamUrl(upstream.base_url, pathname, search),
          {
            method: request.method,
            headers: buildUpstreamHeaders(request, upstream),
            body: sanitizeProxyBody(bodyText, upstream),
            signal: controllers[index].signal,
          },
          runtime.requestTimeoutMs,
        );
        return { response, upstream, index, latency: Date.now() - started };
      } catch (error) {
        return { error, upstream, index, latency: Date.now() - started };
      }
    });
  }

  const pending = attempts.map((_, index) => ({ index, promise: launchLater(index) }));
  let lastResult = null;
  while (pending.length) {
    const raced = await Promise.race(pending.map((entry) => entry.promise.then((result) => ({ entry, result }))));
    pending.splice(pending.indexOf(raced.entry), 1);
    const result = raced.result;
    if (result.cancelled) continue;
    lastResult = result;
    if (result.limited) continue;
    const retryable = result.response && await isRetryableUpstreamResponse(result.response);
    if (result.response && !retryable) {
      done = true;
      controllers.forEach((controller, i) => { if (i !== result.index) controller.abort(); });
      await clearUpstreamFailure(runtime, result.upstream);
      rememberUpstreamLatency(result.upstream, result.latency);
      return { attempts: result.index + 1, response: result.response, upstream: result.upstream };
    }
    await markUpstreamFailure(runtime, result.upstream, result.response ? result.response.status : 599);
  }

  const err = httpError(502, lastResult?.error?.message || "All hedged upstreams failed.");
  err.upstreamName = lastResult?.upstream?.name || attempts[attempts.length - 1]?.name || "none";
  throw err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function takeNimMinuteSlot(upstream) {
  if (!isNvidiaNimUpstream(upstream)) return true;
  const now = Date.now();
  for (const key of Object.keys(_nimMinuteCounters)) {
    if ((_nimMinuteCounters[key]?.resetAt || 0) <= now) delete _nimMinuteCounters[key];
  }
  const key = String(upstream.name || "").trim();
  const bucket = _nimMinuteCounters[key] || { count: 0, resetAt: now + NVIDIA_NIM_RPM_WINDOW_MS };
  if (bucket.count >= NVIDIA_NIM_RPM_LIMIT) return false;
  bucket.count += 1;
  _nimMinuteCounters[key] = bucket;
  return true;
}

function getNimRpmSnapshot() {
  const now = Date.now();
  const result = {};
  for (const key of Object.keys(_nimMinuteCounters)) {
    const bucket = _nimMinuteCounters[key];
    if (!bucket || bucket.resetAt <= now) {
      delete _nimMinuteCounters[key];
      continue;
    }
    result[key] = {
      count: bucket.count,
      limit: NVIDIA_NIM_RPM_LIMIT,
      reset_in_ms: bucket.resetAt - now,
    };
  }
  return result;
}

function isNvidiaNimUpstream(upstream) {
  return String(upstream?.preset || "") === "nvidia-nim" || String(upstream?.base_url || "").toLowerCase().includes("integrate.api.nvidia.com");
}

async function orderUpstreams(runtime, candidates) {
  if (candidates.length <= 1) {
    return candidates;
  }

  const statuses =
    runtime.kv && runtime.routing.failover !== false
      ? await Promise.all(
          candidates.map((upstream) => runtime.kv.get(upstreamCooldownKey(upstream.name), "json")),
        )
      : candidates.map(() => null);

  const now = Date.now();
  const healthy = [];
  const cooling = [];

  candidates.forEach((upstream, index) => {
    const status = statuses[index];
    if (status && Number(status.until) > now) {
      cooling.push(upstream);
      return;
    }
    healthy.push(upstream);
  });

  const orderedHealthy = runtime.routing.load_balance === false
    ? latencySort(prioritySort(healthy))
    : latencySort(weightedShuffle(healthy));

  const orderedCooling = runtime.routing.load_balance === false
    ? latencySort(prioritySort(cooling))
    : latencySort(weightedShuffle(cooling));

  const preferred = orderedHealthy.length > 0 ? orderedHealthy : orderedCooling;
  if (runtime.routing.failover === false) {
    return preferred.length > 0 ? preferred : candidates;
  }

  const fallback = orderedHealthy.length > 0 ? orderedCooling : [];
  return preferred.concat(fallback);
}

function prioritySort(items) {
  return [...items].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function latencySort(items) {
  return [...items].sort((a, b) => upstreamLatencyScore(a) - upstreamLatencyScore(b));
}

function upstreamLatencyScore(upstream) {
  const score = Number(_upstreamLatency[upstream.name]);
  return Number.isFinite(score) && score > 0 ? score : Number.POSITIVE_INFINITY;
}

function rememberUpstreamLatency(upstream, latencyMs) {
  const name = String(upstream.name || "").trim();
  const latency = Number(latencyMs);
  if (!name || !Number.isFinite(latency) || latency < 0) return;
  const previous = Number(_upstreamLatency[name]);
  _upstreamLatency[name] = Number.isFinite(previous)
    ? Math.round(previous * 0.7 + latency * 0.3)
    : Math.max(1, Math.round(latency));
}

function weightedShuffle(items) {
  return [...items]
    .map((item) => ({
      item,
      sortKey: Math.pow(Math.random(), 1 / Math.max(1, Number(item.weight) || 1)),
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((entry) => entry.item);
}

async function markUpstreamFailure(runtime, upstream, status) {
  if (!runtime.kv || runtime.routing.failover === false) {
    return;
  }

  await runtime.kv.put(
    upstreamCooldownKey(upstream.name),
    JSON.stringify({
      status,
      until: Date.now() + runtime.upstreamCooldownTtl * 1000,
      updated_at: hkNowIso(),
    }),
    { expirationTtl: runtime.upstreamCooldownTtl },
  );
}

async function clearUpstreamFailure(runtime, upstream) {
  if (!runtime.kv) {
    return;
  }

  await runtime.kv.delete(upstreamCooldownKey(upstream.name));
}

function buildUpstreamUrl(baseUrl, pathname, search) {
  const base = String(baseUrl).replace(/\/+$/, "");
  let path = pathname;

  if (base.endsWith("/v1") && path.startsWith("/v1/")) {
    path = path.slice(3);
  }

  return `${base}${path}${search}`;
}

function sanitizeProxyBody(bodyText, upstream) {
  if (!bodyText) return bodyText;

  const baseUrl = String(upstream.base_url || "").toLowerCase();
  const isNvidia = baseUrl.includes("integrate.api.nvidia.com");
  if (
    !bodyText.includes('"thinking"') &&
    !bodyText.includes('"reasoning"') &&
    !bodyText.includes('"reasoningEffort"') &&
    !bodyText.includes('"reasoningSummary"') &&
    !bodyText.includes('"providerOptions"') &&
    !bodyText.includes('"provider_options"') &&
    (!isNvidia || (!bodyText.includes('"reasoning_split"') && !bodyText.includes('"enable_thinking"')))
  ) {
    return bodyText;
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  let changed = false;
  const providerOptions = payload.providerOptions || payload.provider_options;
  const openaiOptions = providerOptions && typeof providerOptions === "object"
    ? providerOptions.openai || providerOptions.openAI || providerOptions.gateway
    : null;
  if (openaiOptions && typeof openaiOptions === "object") {
    if (openaiOptions.reasoningEffort != null && !("reasoning_effort" in payload)) {
      payload.reasoning_effort = openaiOptions.reasoningEffort;
      changed = true;
    }
    if (openaiOptions.reasoning_effort != null && !("reasoning_effort" in payload)) {
      payload.reasoning_effort = openaiOptions.reasoning_effort;
      changed = true;
    }
    if (openaiOptions.reasoning != null && !("reasoning" in payload)) {
      payload.reasoning = openaiOptions.reasoning;
      changed = true;
    }
    if (openaiOptions.reasoningSummary != null && !payload.reasoning?.summary) {
      payload.reasoning = {
        ...(payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning : {}),
        summary: openaiOptions.reasoningSummary,
      };
      changed = true;
    }
  }
  if ("providerOptions" in payload) {
    delete payload.providerOptions;
    changed = true;
  }
  if ("provider_options" in payload) {
    delete payload.provider_options;
    changed = true;
  }
  if (payload.reasoning && typeof payload.reasoning === "object" && payload.reasoning.effort != null && !("reasoning_effort" in payload)) {
    payload.reasoning_effort = payload.reasoning.effort;
    changed = true;
  }
  if ("reasoningSummary" in payload && !payload.reasoning?.summary) {
    payload.reasoning = {
      ...(payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning : {}),
      summary: payload.reasoningSummary,
    };
    changed = true;
  }
  if ("reasoningEffort" in payload && !("reasoning_effort" in payload)) {
    payload.reasoning_effort = payload.reasoningEffort;
    changed = true;
  }
  if ("reasoningEffort" in payload) {
    delete payload.reasoningEffort;
    changed = true;
  }
  if ("reasoningSummary" in payload) {
    delete payload.reasoningSummary;
    changed = true;
  }
  if ("thinking" in payload) {
    delete payload.thinking;
    changed = true;
  }

  if (!isNvidia) return changed ? JSON.stringify(payload) : bodyText;

  if ("reasoning_split" in payload) {
    delete payload.reasoning_split;
    changed = true;
  }

  if ("enable_thinking" in payload) {
    const enableThinking = payload.enable_thinking;
    delete payload.enable_thinking;
    const model = String(payload.model || "").toLowerCase();
    if (model.includes("qwen")) {
      payload.chat_template_kwargs = {
        ...(payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object"
          ? payload.chat_template_kwargs
          : {}),
        enable_thinking: enableThinking,
      };
    }
    changed = true;
  }

  return changed ? JSON.stringify(payload) : bodyText;
}

function buildUpstreamHeaders(request, upstream) {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${upstream.api_key}`);
  headers.set(
    "content-type",
    request?.headers.get("content-type") || "application/json; charset=utf-8",
  );
  headers.set("accept", request?.headers.get("accept") || "application/json");
  headers.set("user-agent", "cf-llm-gateway/0.3");

  if (upstream.headers && typeof upstream.headers === "object") {
    for (const [key, value] of Object.entries(upstream.headers)) {
      headers.set(key, String(value));
    }
  }

  return headers;
}

function clientAllowsUpstream(client, upstreamName) {
  if (!Array.isArray(client.upstreams) || client.upstreams.length === 0) {
    return true;
  }
  return client.upstreams.includes(upstreamName);
}

function clientAllowsModel(client, model) {
  if (!Array.isArray(client.models) || client.models.length === 0) {
    return true;
  }
  return client.models.includes("*") || client.models.some((item) => modelsMatch(item, model));
}

function upstreamSupportsModel(upstream, model) {
  if (!Array.isArray(upstream.models) || upstream.models.length === 0) {
    return true;
  }
  return upstream.models.includes("*") || upstream.models.includes(model);
}

function upstreamSupportsPath(upstream, pathname) {
  if (!Array.isArray(upstream.paths) || upstream.paths.length === 0) {
    return true;
  }
  return upstream.paths.includes(pathname);
}

function normalizeClient(client) {
  if (!client || typeof client !== "object" || !client.key) {
    throw badConfig("Each client needs `key`.");
  }

  return {
    id: client.id || client.name || client.key,
    metadata: client.metadata || {},
    models: normalizeStringArray(client.models),
    name: client.name || client.id || "client",
    key: client.key,
    upstreams: normalizeStringArray(client.upstreams),
    created_at: client.created_at || hkNowIso(),
    updated_at: client.updated_at || hkNowIso(),
  };
}

function buildClientRecord(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Client payload must be a JSON object.");
  }

  const key = payload.key || generateClientKey();
  if (!key.startsWith("sk-")) {
    throw httpError(400, "Client key must start with `sk-`.");
  }

  const now = hkNowIso();
  return normalizeClient({
    id: payload.id || crypto.randomUUID(),
    key,
    metadata: payload.metadata || {},
    models: payload.models || ["*"],
    name: payload.name || "generated-client",
    upstreams: payload.upstreams || [],
    created_at: payload.created_at || now,
    updated_at: now,
  });
}

async function saveClientRecord(kv, record) {
  const existing = await kv.get(clientIdKey(record.id), "json");
  const createdAt = existing?.created_at || record.created_at;
  const stored = {
    ...record,
    created_at: createdAt,
    updated_at: hkNowIso(),
  };

  await kv.put(clientIdKey(stored.id), JSON.stringify(stored));
  await kv.put(clientTokenKey(stored.key), JSON.stringify(stored));

  const index = await listClientIndex(kv);
  const next = index.filter((item) => item.id !== stored.id);
  next.push(publicClientRecord(stored));
  next.sort((a, b) => a.name.localeCompare(b.name));

  // ponytail: rewrite the full index in KV; move to D1 only if admin writes become frequent.
  await kv.put(clientIndexKey(), JSON.stringify(next));
}

async function deleteClientRecord(kv, id) {
  const record = await kv.get(clientIdKey(id), "json");
  if (!record || !record.key) {
    throw httpError(404, "Client not found.");
  }

  await kv.delete(clientIdKey(id));
  await kv.delete(clientTokenKey(record.key));

  const index = await listClientIndex(kv);
  await kv.put(
    clientIndexKey(),
    JSON.stringify(index.filter((item) => item.id !== id)),
  );
}

async function listClientIndex(kv) {
  return (await kv.get(clientIndexKey(), "json")) || [];
}

function publicClientRecord(record) {
  return {
    id: record.id,
    name: record.name,
    key_preview: maskKey(record.key),
    models: record.models,
    upstreams: record.upstreams,
    metadata: record.metadata,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

async function ensureEncryptedValue(value, secret) {
  if (!secret) {
    throw badConfig("Missing API_KEY_CRYPT_SECRET or ADMIN_TOKEN for encryption.");
  }

  if (value.startsWith("enc::")) {
    return value;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return `enc::${base64UrlEncode(joinBytes(iv, new Uint8Array(cipher)))}`;
}

// ponytail: decryptValue accepts optional pre-derived AES key to avoid per-upstream re-derivation
async function decryptValue(value, secret, preDerivedKey) {
  if (!value) {
    return "";
  }

  if (!value.startsWith("enc::")) {
    return value;
  }

  const raw = base64UrlDecode(value.slice("enc::".length));
  const iv = raw.slice(0, 12);
  const payload = raw.slice(12);
  const key = preDerivedKey || (await deriveAesKey(secret));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return new TextDecoder().decode(plain);
}

async function deriveAesKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function joinBytes(first, second) {
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function inferPresetId(baseUrl) {
  const value = String(baseUrl || "").toLowerCase();
  if (value.includes("nvidia.com")) {
    return "nvidia-nim";
  }
  if (value.includes("deepinfra.com")) {
    return "deepinfra";
  }
  if (value.includes("together.xyz")) {
    return "together";
  }
  if (value.includes("api.cloudflare.com/client/v4/accounts/") && value.includes("/ai/v1")) {
    return "workers-ai";
  }
  if (value.includes("anthropic") || value.includes("claude")) {
    return "custom";
  }
  return "custom";
}

function presetById(id) {
  return PRESET_TEMPLATES.find((item) => item.id === id) || null;
}

function parseJsonEnvArray(value, name) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw badConfig(`${name} must be a JSON array.`);
  }
}

function parseJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function normalizePathname(pathname) {
  const value = String(pathname || "").trim();
  if (!value || value === "/") {
    return "/";
  }

  return value.replace(/\/+$/, "") || "/";
}

function pickAdminToken(env) {
  const candidates = [
    env.ADMIN_TOKEN,
    env.ADMIN,
    env.admin,
    env.TOKEN,
    env.token,
  ];

  for (const value of candidates) {
    const token = String(value || "").trim();
    if (token) {
      return token;
    }
  }

  return DEFAULT_ADMIN_TOKEN;
}

function buildAdminPathAliases(adminToken) {
  const raw = `/${adminToken}`;
  const variants = new Set([raw.toLowerCase()]);
  const normalized = adminToken.toLowerCase();

  if (normalized.includes("-")) {
    variants.add(`/${normalized.replace(/-/g, "")}`);
    variants.add(`/${normalized.replace(/-/g, "_")}`);
  }

  if (normalized.includes("_")) {
    variants.add(`/${normalized.replace(/_/g, "-")}`);
    variants.add(`/${normalized.replace(/_/g, "")}`);
  }

  return [...variants].map((value) => normalizePathname(value));
}

function matchAdminRoute(pathnameLower, app) {
  for (const basePath of app.adminPaths) {
    if (pathnameLower === basePath) {
      return { kind: "page", basePath };
    }
    if (pathnameLower.startsWith(`${basePath}/api/`)) {
      return { kind: "api", basePath };
    }
  }
  return null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parsePriority(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const headers = {};
  for (const [key, item] of Object.entries(value)) {
    const headerName = String(key || "").trim();
    if (!headerName) {
      continue;
    }
    headers[headerName] = String(item ?? "").trim();
  }
  return headers;
}

function presetDefaultHeaders(presetId) {
  const preset = presetById(presetId);
  return normalizeHeaders(preset?.headers || {});
}

function resolveBaseUrl(presetId, inputBaseUrl, defaultBaseUrl, accountId) {
  const preset = presetById(presetId);
  if (preset && preset.requires_account_id) {
    const manual = String(inputBaseUrl || "").trim();
    if (manual) {
      return manual;
    }
    const account = String(accountId || "").trim();
    return account
      ? String(defaultBaseUrl || preset.base_url || "").replace("{ACCOUNT_ID}", account).trim()
      : "";
  }

  if (preset && preset.requires_base_url === false) {
    return String(defaultBaseUrl || preset.base_url || "").trim();
  }

  return String(inputBaseUrl || defaultBaseUrl || "").trim();
}

function getBearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return null;
  }
  return auth.slice("Bearer ".length).trim();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abort = () => controller.abort(upstreamSignal?.reason || "timeout");
  if (upstreamSignal?.aborted) abort();
  else upstreamSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), timeout);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abort);
    return wrapIdleTimeout(response, timeout);
  } catch (error) {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abort);
    throw error;
  }
}

function wrapIdleTimeout(response, timeoutMs) {
  if (!response.body) return response;
  const stream = response.body;
  return new Response(new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let closed = false;
      let timer = null;
      const stop = () => { if (timer) clearTimeout(timer); timer = null; };
      const reset = () => {
        stop();
        timer = setTimeout(async () => {
          if (closed) return;
          closed = true;
          try { await reader.cancel("idle timeout"); } catch {}
          controller.error(new Error("Upstream idle timeout."));
        }, timeoutMs);
      };

      reset();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reset();
          controller.enqueue(value);
        }
        if (!closed) {
          closed = true;
          stop();
          controller.close();
        }
      } catch (error) {
        if (!closed) {
          closed = true;
          stop();
          controller.error(error);
        }
      }
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function generateClientKey() {
  return `sk-gw-${randomString(40)}`;
}

function randomString(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";

  for (const byte of bytes) {
    output += alphabet[byte % alphabet.length];
  }

  return output;
}

function maskKey(key) {
  if (!key || key.length < 12) {
    return key;
  }
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function clientTokenKey(token) {
  return `client:token:${token}`;
}

function clientIdKey(id) {
  return `client:id:${id}`;
}

function clientIndexKey() {
  return "client:index";
}

function modelsCacheKey(upstreamName) {
  return `cache:models:${upstreamName}`;
}

function upstreamCooldownKey(upstreamName) {
  return `cooldown:upstream:${upstreamName}`;
}

function openAiError(message, type) {
  return {
    error: {
      message,
      type,
    },
  };
}

function mapErrorType(statusCode) {
  if (statusCode === 401) {
    return "authentication_error";
  }
  if (statusCode === 403) {
    return "permission_error";
  }
  if (statusCode === 404) {
    return "not_found_error";
  }
  if (statusCode && statusCode < 500) {
    return "invalid_request_error";
  }
  return "server_error";
}

// ponytail: no pretty-print, smaller wire size for large responses
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

// ponytail: no-store on dynamic admin page to prevent stale cache
// ponytail: allow CDN cache with ETag revalidation (admin HTML is static, data loaded by JS)
function html(markup, status = 200) {
  const h = new Headers(HTML_HEADERS);
  h.set("cache-control", "public, max-age=86400");
  return new Response(markup, { status, headers: h });
}

function withCorsResponse(response) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) {
    headers.set("retry-after", "1");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function badConfig(message) {
  return httpError(500, message);
}

// ponytail: minimal nginx decoy — just enough to look real, ~60% smaller
function renderNginxWelcomePage() {
  return "<!doctype html><html lang=en><head><meta charset=utf-8><title>Welcome to nginx!</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fa;color:#111827;font:16px/1.6 Georgia,serif}main{width:min(600px,calc(100vw - 32px));background:#fff;border:1px solid #d1d5db;padding:32px}h1{margin:0 0 16px}p{margin:0 0 12px}</style></head><body><main><h1>Welcome to nginx!</h1><p>If you see this page, the web server is successfully installed and working.</p><p>Further configuration is required.</p></main></body></html>";
}

// ponytail: origin param lets us pre-fill gateway URL server-side (no API wait)
function renderAdminPage(origin) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Gateway</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d7c7aa;
      --accent: #a54d2d;
      --accent-2: #2f6f5e;
      --bg-raised: #fff9ef;
      --fg: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, rgba(165,77,45,.18), transparent 28%),
                  linear-gradient(180deg, #efe5d2 0%, var(--bg) 42%, #f8f4ec 100%);
      color: var(--ink);
      font: 15px/1.5 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    }
    html, body { overflow-x: hidden; }
    .wrap { width: min(960px, calc(100vw - 24px)); margin: 0 auto; padding: 24px 0 48px; }

    .hero, .panel {
      background: rgba(255,253,248,.94);
      border: 1px solid var(--line);
      box-shadow: 0 18px 40px rgba(38,28,18,.08);
      backdrop-filter: blur(8px);
      margin-bottom: 18px;
    }
    .hero { padding: 24px; }
    .hero h1 { margin: 0 0 10px; font: 700 30px/1.15 Georgia, serif; }
    .hero-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero code {
      background: #f2e7d3; padding: 4px 10px; border-radius: 8px;
      font-size: 14px; word-break: break-all;
    }
    .gateway-urls { margin-top: 12px; }
    .url-card {
      border: 1px solid var(--line);
      background: rgba(255,253,248,.7); border-radius: 14px; padding: 14px;
      max-width: 520px; overflow: hidden;
    }
    .url-card .url-card-head { font-weight: 600; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .url-card code { display: block; margin-bottom: 8px; }
    .url-card button { margin-right: 6px; }
    .panel { padding: 20px; }
    .panel h2 { margin: 0 0 14px; font: 700 20px/1.2 Georgia, serif; }

    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .toolbar h2 { margin: 0; }
    .toolbar > * { min-width: 0; }
    .toolbar-spacer { flex: 1; }
    .menu-wrap { position: relative; }
    .menu {
      position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
      display: none; min-width: 150px; padding: 6px;
      background: #fffdfa; border: 1px solid #cfbea0; border-radius: 12px;
      box-shadow: 0 12px 24px rgba(38,28,18,.12);
    }
    .menu-wrap.open .menu { display: grid; gap: 4px; }
    .menu button { width: 100%; text-align: left; border-radius: 8px; }

    button {
      border: 0; border-radius: 999px; padding: 9px 16px;
      font: 600 13px/1.1 inherit; cursor: pointer;
      background: var(--accent); color: white;
      transition: transform .16s,opacity .16s;
    }
    button:hover { filter: brightness(1.06); }
    button:active { transform: translateY(1px); }
    button[disabled] { opacity: .55; cursor: wait; }
    button.small { padding: 6px 12px; font-size: 12px; }
    button.secondary { background: #eadcc5; color: #3a2b1f; }
    button.good { background: var(--accent-2); }
    button.danger { background: #8d2f23; }

    input, textarea, select {
      width: 100%; border: 1px solid #cdbda2; background: #fffdfa;
      color: var(--ink); border-radius: 10px; padding: 9px 12px; font: inherit;
    }
    textarea { min-height: 72px; resize: vertical; }
    .note { color: var(--muted); font-size: 13px; }
    .mono { font-family: "Cascadia Code","Fira Code",Consolas,monospace; font-size: 13px; }

    .row { display: grid; gap: 12px; grid-template-columns: repeat(12, 1fr); margin-bottom: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; }
    .field label { color: var(--muted); font-size: 13px; }
    .span-12 { grid-column: span 12; }
    .span-6 { grid-column: span 6; }
    .span-4 { grid-column: span 4; }
    .span-3 { grid-column: span 3; }

    .upstream-card {
      border: 1px solid #cfbea0; background: #fff9ef;
      border-radius: 16px; margin-bottom: 10px; overflow: hidden;
    }
    .upstream-card.disabled { background: #f4efe7; border-color: #d8cbb8; opacity: .82; }
    .upstream-card summary {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 14px 16px; cursor: pointer; user-select: none;
      list-style: none;
    }
    .upstream-card summary::-webkit-details-marker { display: none; }
    .upstream-card summary::before {
      content: "\u25B6"; font-size: 10px; color: var(--muted);
      transition: transform .2s ease; flex-shrink: 0;
    }
    .upstream-card[open] summary::before { transform: rotate(90deg); }
    .upstream-card summary .card-badge {
      background: #eadcc5; color: #3a2b1f; padding: 3px 10px;
      border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    .upstream-card summary strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .health-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      background: #d1d5db; transition: background .3s ease;
    }
    .health-dot.ok { background: #22c55e; }
    .health-dot.fail { background: #ef4444; }
    .health-dot.checking { background: #f59e0b; animation: pulse .6s ease infinite alternate; }
    @keyframes pulse { to { opacity: .4; } }
    .capability-badge {
      background: #e0d5c0; color: #3a2b1f; padding: 2px 8px;
      border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .upstream-card summary .card-meta { color: var(--muted); font-size: 13px; white-space: nowrap; }
    .upstream-enable-toggle { padding: 5px 9px; }
    .nim-rpm-timer[hidden] { display: none; }
    .upstream-card .card-body { padding: 0 16px 14px; }

    .client-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 14px; border: 1px solid #cfbea0;
      background: #fff9ef; border-radius: 12px; margin-bottom: 8px;
    }
    .client-item .client-meta { flex: 1; min-width: 0; }
    .client-item .client-meta strong { display: block; }
    .client-item .client-meta .mono { color: var(--muted); word-break: break-all; }
    .client-create { display: flex; gap: 10px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    .client-create input { flex: 1; min-width: 160px; }

    .key-output {
      margin-top: 12px; padding: 14px; background: #f2e7d3;
      border-radius: 12px; border: 1px solid #cfbea0;
    }
    .key-output pre {
      margin: 0 0 8px; font-size: 13px; word-break: break-all; white-space: pre-wrap;
      font-family: "Cascadia Code","Fira Code",Consolas,monospace;
    }
    .key-output .key-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    .settings-panel summary {
      cursor: pointer; user-select: none; list-style: none;
      display: flex; align-items: center; gap: 8px;
    }
    .settings-panel summary::-webkit-details-marker { display: none; }
    .settings-panel summary::before {
      content: "\u25B6"; font-size: 10px; color: var(--muted);
      transition: transform .2s ease;
    }
    .settings-panel[open] summary::before { transform: rotate(90deg); }
    .settings-panel summary h2 { margin: 0; }
    .settings-body { padding-top: 14px; }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(33,24,15,.55);
      display: none; align-items: center; justify-content: center;
      padding: 16px; z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal-card {
      width: min(680px, 100%); max-height: calc(100vh - 32px); overflow: auto;
      background: #fffaf2; border: 1px solid #cfbea0;
      border-radius: 24px; padding: 20px; box-shadow: 0 26px 60px rgba(0,0,0,.18);
    }
    .modal-card h3 { margin: 0 0 14px; font: 700 18px/1.2 Georgia, serif; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
    .system-prompt-textarea { min-height: min(55vh, 520px); font-family: "Cascadia Code","Fira Code",Consolas,monospace; }
    .model-picker-backdrop { z-index: 80; }
    .model-picker-card { width: min(1216px, calc(100vw - 48px)); }
    .picker-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .picker-head h3 { margin: 0; }
    .model-picker-grid {
      display: grid; grid-template-columns: 220px 260px minmax(0, 1fr); gap: 12px;
      min-height: min(68vh, 722px);
    }
    .model-picker-groups, .model-picker-subgroups, .model-picker-list {
      border: 1px solid #cfbea0; border-radius: 8px; background: #fffdfa;
      overflow: auto; max-height: min(68vh, 722px);
    }
    .model-picker-groups, .model-picker-subgroups { padding: 8px; }
    .model-group-btn {
      width: 100%; display: flex; justify-content: space-between; gap: 8px;
      border-radius: 8px; padding: 8px 10px; margin-bottom: 4px;
      background: transparent; color: var(--ink); text-align: left;
    }
    .model-group-btn.active { background: #eadcc5; }
    .model-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 0; border-bottom: 1px solid #f1e6d6; background: transparent; color: var(--ink); text-align: left; font-size: 13px; }
    .model-row:last-child { border-bottom: 0; }
    .model-row input { width: auto; }
    .model-row.active { background: #f2e7d3; }
    .model-row .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .model-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; justify-content: flex-end; }
    .model-tag { border: 1px solid #cfbea0; border-radius: 999px; padding: 1px 6px; color: var(--muted); font-size: 11px; white-space: nowrap; background: #fffdfa; }
    .model-tag-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .model-tag-filter button { padding: 5px 8px; font-size: 12px; }
    .model-tag-filter button.active { background: #eadcc5; }
    .picker-actions { display: flex; gap: 10px; justify-content: flex-end; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    .picker-actions button.small { padding: 7px 13px; font-size: 13px; }
    @media (max-width: 760px) {
      .model-picker-grid { grid-template-columns: 1fr; }
      .model-picker-groups, .model-picker-subgroups { max-height: 150px; }
      .model-row { align-items: flex-start; flex-wrap: wrap; }
      .model-tags { margin-left: 26px; justify-content: flex-start; }
    }

    #toast {
      position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
      background: #1f2937; color: #f9fafb; padding: 12px 28px;
      border-radius: 999px; font-size: 14px; font-weight: 600;
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
      z-index: 100;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(-6px); }
    #log-list { max-width: 100%; overflow-x: auto; }
    .log-table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 13px; }
    .log-table th, .log-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--line); }
    .log-table th { color: var(--muted); font-weight: 600; font-size: 12px; }
    .log-table .ok { color: var(--accent-2); }
    .log-table .err { color: #8d2f23; }
    .chart-bar { display: flex; align-items: flex-end; gap: 2px; height: 110px; padding: 4px 0; border-bottom: 1px solid var(--line); margin-bottom: 10px; }
    .chart-bar .bar { flex: 1; min-width: 8px; background: var(--accent); border-radius: 2px 2px 0 0; position: relative; cursor: default; }
    .chart-bar .bar.fail { background: #8d2f23; }
    .chart-bar .bar::after { content: attr(data-h); display: none; position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); font-size: 9px; color: var(--muted); }
    .chart-bar .bar:nth-child(6n)::after { display: block; }
    .chart-label { font-size: 12px; font-weight: 600; color: var(--muted); margin: 8px 0 2px; } .chart-label:first-of-type { margin-top: 0; }
    .stat-tip {
      position: fixed; z-index: 120; width: min(260px, calc(100vw - 24px)); max-height: 260px; overflow: auto;
      padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--panel); box-shadow: 0 12px 28px #00000022; pointer-events: none;
      font-size: 12px; line-height: 1.35;
    }
    .stat-tip[hidden] { display: none; }
    .stat-tip-title { font-weight: 700; color: var(--fg); margin-bottom: 6px; }
    .stat-tip-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 2px 0; }
    .stat-tip-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stat-tip-value { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .stats-grid-2col { grid-template-columns: repeat(2, 1fr); }
    .stat-box { background: var(--bg-raised); border-radius: 8px; padding: 10px 12px; text-align: center; }
    .stat-num { display: block; font-size: 22px; font-weight: 700; color: var(--fg); }
    .stat-label { font-size: 11px; color: var(--muted); }
    .live-log { max-height: 200px; overflow-y: auto; }
    .log-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
    .log-badge { display: inline-block; width: 28px; text-align: center; border-radius: 4px; font-size: 11px; font-weight: 700; padding: 2px 0; }
    .log-badge.ok { background: #065f4620; color: var(--accent-2); }
    .log-badge.err { background: #8d2f2320; color: #8d2f23; }
    @media (max-width: 700px) {
      .wrap { width: min(100%, calc(100vw - 12px)); padding: 8px 0 28px; }
      .hero, .panel { margin-bottom: 10px; }
      .hero, .panel, .modal-card { padding: 14px; }
      .hero h1 { font-size: 24px; }
      .url-card { max-width: 100%; }
      .toolbar { align-items: stretch; }
      .toolbar h2 { flex-basis: 100%; }
      .toolbar-spacer { display: none; }
      .menu-wrap { position: static; width: 100%; }
      .menu-wrap > button { width: 100%; }
      .menu { position: static; width: 100%; margin-top: 6px; box-shadow: none; }
      .row { grid-template-columns: 1fr; }
      .span-3, .span-4, .span-6, .span-12 { grid-column: 1; }
      .stats-grid, .stats-grid-2col { grid-template-columns: 1fr; }
      .upstream-card summary { align-items: flex-start; gap: 8px; }
      .upstream-card summary strong { flex-basis: calc(100% - 32px); white-space: normal; }
      .upstream-card summary .card-meta { white-space: normal; }
      .upstream-card .card-body { padding: 0 12px 12px; }
      .client-item, .live-log .log-row { align-items: flex-start; flex-wrap: wrap; }
      .client-create input { flex-basis: 100%; }
      .chart-bar .bar { min-width: 0; }
      .chart-bar .bar::after { display: none; }
      .chart-bar .bar:nth-child(8n)::after { display: block; }
      .stat-tip { max-height: 220px; }
      .modal-backdrop { align-items: stretch; }
      .modal-card { width: 100%; border-radius: 14px; }
      .picker-actions { justify-content: stretch; }
      .picker-actions button, .picker-actions label { flex: 1 1 140px; }
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>LLM Gateway</h1>
    <div class="gateway-urls">
      <div class="url-card">
        <div class="url-card-head">Gateway URL <span class="note">(OpenAI + Claude Compatible)</span></div>
        <code id="gateway-url-pill">${origin}/v1</code>
        <button class="small secondary" id="copy-gateway-url">\u590d\u5236</button>
      </div>
    </div>
  </div>

  <div class="panel" id="stats-panel">
    <div class="toolbar">
      <h2>统计</h2>
      <span class="note" id="stat-current-model"></span>
      <span class="note" id="stat-updated"></span>
      <button class="small secondary" id="load-stats">加载统计</button>
    </div>
    <div class="chart-label">请求量</div>
    <div class="chart-bar" id="chart-requests"></div>
    <div class="stats-grid">
      <div class="stat-box"><span class="stat-num" id="stat-total">-</span><span class="stat-label">24h 请求</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-success">-</span><span class="stat-label">成功</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-fail">-</span><span class="stat-label">失败</span></div>
    </div>
    <div class="chart-label">Tokens</div>
    <div class="chart-bar" id="chart-tokens"></div>
    <div class="stats-grid stats-grid-2col">
      <div class="stat-box"><span class="stat-num" id="stat-pt">-</span><span class="stat-label">Input</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-ct">-</span><span class="stat-label">Output</span></div>
    </div>
    <div class="stats-grid stats-grid-2col" style="margin-top:4px">
      <div class="stat-box"><span class="stat-num" id="stat-pt-session">0</span><span class="stat-label">会话 Input</span></div>
      <div class="stat-box"><span class="stat-num" id="stat-ct-session">0</span><span class="stat-label">会话 Output</span></div>
    </div>
  </div>

  <div class="panel">
    <h2>\u5ba2\u6237\u7aef Keys</h2>
    <p class="note" style="margin:4px 0 8px;font-size:12px">提示：客户端 models 设 ["*"] 可见所有模型，改为 ["deepseek-chat","deepseek-reasoner"] 等具体列表可精简可见模型，不影响实际调用。</p>
    <div id="client-list"></div>
    <div class="client-create">
      <input id="client-name" placeholder="\u540d\u79f0 (\u53ef\u9009)">
      <button class="good" id="create-client">\u751f\u6210 Key</button>
      <button class="small secondary" id="refresh-client-key" hidden>\u5237\u65b0</button>
    </div>
    <div class="key-output" id="client-output" hidden>
      <pre id="client-output-text" class="mono"></pre>
      <div class="key-actions">
        <button class="small good" id="copy-client-key">\u590d\u5236 Key</button>
        <button class="small secondary" id="copy-client-json">\u590d\u5236 JSON</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <h2>\u4e0a\u6e38\u914d\u7f6e</h2>
      <button id="open-vendor-modal">+ \u6dfb\u52a0\u4e0a\u6e38</button>
      <button class="good" id="save-config">\u4fdd\u5b58\u914d\u7f6e</button>
      <span class="toolbar-spacer"></span>
      <div class="menu-wrap" id="upstream-actions">
        <button type="button" class="secondary" id="upstream-actions-toggle">\u66f4\u591a\u64cd\u4f5c</button>
        <div class="menu">
          <button type="button" class="secondary small" id="refresh-models">\u5237\u65b0\u6a21\u578b\u7f13\u5b58</button>
          <button type="button" class="secondary small" id="check-health">\u68c0\u67e5\u5065\u5eb7\u5ea6</button>
          <button type="button" class="secondary small" id="speed-test">\u6a21\u578b\u6d4b\u901f</button>
          <button type="button" class="secondary small" id="export-upstreams">\u5bfc\u51fa\u914d\u7f6e</button>
          <button type="button" class="secondary small" id="import-upstreams">\u5bfc\u5165\u914d\u7f6e</button>
        </div>
      </div>
      <span class="note" id="config-status"></span>
    </div>
    <div id="upstream-list"></div>
    <input type="file" id="import-upstreams-file" accept=".json,application/json" hidden>
  </div>

  <div class="panel" id="log-panel">
    <div class="toolbar">
      <h2>\u8c03\u7528\u65e5\u5fd7</h2>
      <button class="small secondary" id="refresh-logs">\u5237\u65b0</button>
      <span class="note" id="token-total"></span>
    </div>
    <div id="log-list"><div class="note">\u52a0\u8f7d\u4e2d...</div></div>
  </div>


  <details class="panel settings-panel">
    <summary><h2>\u9ad8\u7ea7\u8bbe\u7f6e</h2></summary>
    <div class="settings-body">
      <div class="row">
        <div class="field span-4"><label>\u8bf7\u6c42\u8d85\u65f6 (ms, \u9ed8\u8ba4180000)</label><input id="request-timeout" type="number" min="1000" placeholder="180000"></div>
        <div class="field span-4"><label>\u51b7\u5374 TTL (s, \u9ed8\u8ba460)</label><input id="cooldown-ttl" type="number" min="1" placeholder="60"></div>
        <div class="field span-4"><label>\u6a21\u578b\u7f13\u5b58 TTL (s, \u9ed8\u8ba43600)</label><input id="model-cache-ttl" type="number" min="1" placeholder="3600"></div>
      </div>
      <div class="row">
        <div class="field span-3">
          <label><input type="checkbox" id="routing-load-balance"> \u8d1f\u8f7d\u5747\u8861 (\u9ed8\u8ba4\u5f00)</label>
        </div>
        <div class="field span-3">
          <label><input type="checkbox" id="routing-failover"> \u6545\u969c\u8f6c\u79fb (\u9ed8\u8ba4\u5f00)</label>
        </div>
        <div class="field span-3">
          <label><input type="checkbox" id="routing-hedge"> Hedged Request</label>
        </div>
        <div class="field span-3"><label>\u6700\u9ad8\u8bf7\u6c42\u4e0a\u6e38\u6570</label><input id="routing-hedge-max" type="number" min="1" max="5" placeholder="2"></div>
      </div>
      <div class="row">
        <div class="field span-12"><label>\u9884\u7559\u9644\u52a0\u7cfb\u7edf\u63d0\u793a\u8bcd</label><button type="button" class="secondary small" id="open-system-prompt-modal">\u7f16\u8f91\u7cfb\u7edf\u63d0\u793a\u8bcd</button><span class="note" id="system-prompt-status"></span></div>
      </div>
      <button class="good small" id="save-settings">\u4fdd\u5b58\u8bbe\u7f6e</button>
      <span class="note" id="settings-status"></span>
    </div>
  </details>

  <div class="panel">
    <div class="toolbar">
      <h2>请求日志</h2>
      <button class="small secondary" id="load-logs">刷新</button>
    </div>
    <div class="live-log" id="live-log"></div>
  </div>

  <footer style="text-align:center;padding:24px 0;color:var(--muted);font-size:13px;">
    ${VERSION} ·
    <a href="https://github.com/FisheeHei/Cloudflare-Workers-LLMmerge" style="color:var(--accent);">FisheeHei/Cloudflare-Workers-LLMmerge</a>
    · by FisheeHei
  </footer>
</div>

<div id="toast"></div>
<div class="stat-tip" id="stat-tip" hidden></div>

<div class="modal-backdrop model-picker-backdrop" id="model-picker-modal">
  <div class="modal-card model-picker-card">
    <div class="picker-head">
      <h3 id="model-picker-title">\u9009\u62e9\u6a21\u578b</h3>
      <button type="button" class="secondary small" id="model-picker-close">\u5173\u95ed</button>
    </div>
    <input id="model-picker-search" placeholder="\u641c\u7d22\u6a21\u578b">
    <div class="model-tag-filter" id="model-tag-filter"></div>
    <div class="model-picker-grid" style="margin-top:12px">
      <div class="model-picker-groups" id="model-picker-groups"></div>
      <div class="model-picker-subgroups" id="model-picker-subgroups"></div>
      <div class="model-picker-list" id="model-picker-list"></div>
    </div>
    <div class="picker-actions">
      <span class="note" id="picker-count">\u5df2\u9009 0</span>
      <label class="note" id="picker-same-preset-wrap" hidden><input type="checkbox" id="picker-apply-same-preset"> \u5e94\u7528\u5230\u540c\u7c7b\u578b\u5168\u90e8\u4e0a\u6e38</label>
      <button type="button" class="small secondary" id="picker-select-visible">\u9009\u4e2d\u5f53\u524d</button>
      <button type="button" class="small secondary" id="picker-clear-visible">\u6e05\u7a7a\u5f53\u524d</button>
      <button type="button" class="small secondary" id="picker-cancel">\u53d6\u6d88</button>
      <button type="button" class="small good" id="picker-apply">\u5e94\u7528</button>
    </div>
  </div>
</div>
<div class="modal-backdrop model-picker-backdrop" id="speed-picker-modal">
  <div class="modal-card model-picker-card">
    <div class="picker-head">
      <h3>\u6a21\u578b\u6d4b\u901f</h3>
      <button type="button" class="secondary small" id="speed-picker-close">\u5173\u95ed</button>
    </div>
    <input id="speed-picker-search" placeholder="\u641c\u7d22\u6a21\u578b">
    <div class="model-picker-grid" style="margin-top:12px">
      <div class="model-picker-groups" id="speed-picker-upstreams"></div>
      <div class="model-picker-subgroups" id="speed-picker-groups"></div>
      <div class="model-picker-list" id="speed-picker-models"></div>
    </div>
    <div class="picker-actions">
      <span class="note" id="speed-picker-status"></span>
      <button type="button" class="small secondary" id="speed-picker-cancel">\u53d6\u6d88</button>
      <button type="button" class="small good" id="speed-picker-run">\u5f00\u59cb\u6d4b\u901f</button>
    </div>
  </div>
</div>
<div class="modal-backdrop" id="vendor-modal">
  <div class="modal-card">
    <h3>\u6dfb\u52a0\u4e0a\u6e38</h3>
    <div class="row">
      <div class="field span-12"><label>\u6a21\u677f</label><select id="vendor-preset"></select></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>\u5907\u6ce8</label><input id="vendor-note" placeholder="\u4f8b\u5982: \u4e3b\u529b Key"></div>
      <div class="field span-6"><label>\u5185\u90e8\u540d\u79f0</label><input id="vendor-name" placeholder="my-upstream (\u53ef\u7701\u7565)"></div>
    </div>
    <div class="row">
      <div class="field span-12" id="vendor-account-id-wrap" style="display:none"><label>Account ID</label><input id="vendor-account-id" class="mono" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>Base URL</label><input id="vendor-base-url" placeholder="https://..."></div>
      <div class="field span-6"><label>API Key</label><input id="vendor-api-key" class="mono" placeholder="nvapi-... \u6216 sk-..."></div>
    </div>
    <div class="row">
      <div class="field span-4"><label>\u6a21\u578b (\u9017\u53f7\u5206\u9694, \u7559\u7a7a=\u81ea\u52a8)</label><input id="vendor-models" placeholder="model-a, model-b"><button type="button" class="small secondary" id="vendor-fetch-models">\u4ece\u5f53\u524d\u4e0a\u6e38\u5bfc\u5165</button></div>
      <div class="field span-4"><label>\u8def\u5f84 (\u9017\u53f7\u5206\u9694)</label><input id="vendor-paths" value="/v1/chat/completions, /v1/embeddings"></div>
      <div class="field span-2"><label>\u6743\u91cd</label><input id="vendor-weight" type="number" min="1" value="1"></div>
      <div class="field span-2"><label>\u542f\u7528</label><select id="vendor-enabled"><option value="true">\u662f</option><option value="false">\u5426</option></select></div>
    </div>
    <div class="modal-actions">
      <button class="secondary" id="close-vendor-modal">\u53d6\u6d88</button>
      <button class="good" id="create-vendor">\u6dfb\u52a0</button>
    </div>
  </div>
</div>
<div class="modal-backdrop" id="system-prompt-modal">
  <div class="modal-card">
    <h3>\u9884\u7559\u9644\u52a0\u7cfb\u7edf\u63d0\u793a\u8bcd</h3>
    <textarea id="system-prompt-input" class="system-prompt-textarea" placeholder="\u7559\u7a7a\u5219\u4e0d\u6ce8\u5165\u3002\u6709\u5185\u5bb9\u65f6\uff0c\u6240\u6709 Chat/Responses/Messages \u8bf7\u6c42\u90fd\u4f1a\u8ffd\u52a0\u8fd9\u6bb5\u7cfb\u7edf\u63d0\u793a\u8bcd\u3002"></textarea>
    <div class="modal-actions">
      <button class="secondary" id="close-system-prompt-modal">\u5173\u95ed</button>
      <button class="good" id="apply-system-prompt-modal">\u5e94\u7528</button>
    </div>
  </div>
</div>

<script>
    const API_BASE = location.pathname.replace(new RegExp("/+$"), "") + "/api";
  const state = { config: null, presets: [], clients: [], gateway: null, draftPresetId: null, lastCreatedClient: null, sessionInputTokens: 0, sessionOutputTokens: 0, modelPicker: null, speedPicker: null, logs: [], logExpanded: false };
  const byId = (id) => document.getElementById(id);
  const text = (value) => String(value ?? "");

  function splitList(value) { return text(value).split(/[,\\n]/).map((s) => s.trim()).filter(Boolean); }
  function esc(value) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function presetById(id) { return state.presets.find((p) => p.id === id) || state.presets.find((p) => p.id === "custom") || state.presets[0]; }
  function baseUrlLocked(presetId) { const p = presetById(presetId); return !!p && p.requires_base_url === false; }
  function presetNeedsAccountId(presetId) { const p = presetById(presetId); return !!p && p.requires_account_id; }
  function presetBaseUrl(presetId, accountId) {
    const preset = presetById(presetId);
    if (!preset) return "";
    if (preset.requires_account_id) {
      const account = text(accountId).trim();
      return account
        ? text(preset.base_url || "").replace("{ACCOUNT_ID}", account).trim()
        : text(preset.base_url || "").replace("{ACCOUNT_ID}", "ACCOUNT_ID").trim();
    }
    return text(preset.base_url || "").trim();
  }
  function presetHeaders(presetId) {
    const preset = presetById(presetId);
    return preset && preset.headers && typeof preset.headers === "object" && !Array.isArray(preset.headers) ? preset.headers : {};
  }

  let toastTimer = null;
  function showToast(message) {
    const t = byId("toast"); t.textContent = message; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  async function copyText(value, successMessage) {
    if (!value) throw new Error("\u6ca1\u6709\u53ef\u590d\u5236\u7684\u5185\u5bb9");
    await navigator.clipboard.writeText(value);
    showToast(successMessage || "\u5df2\u590d\u5236");
  }

  async function withButtonBusy(button, label, task) {
    const orig = button.textContent; button.disabled = true; button.textContent = label;
    try { return await task(); }
    finally { button.disabled = false; button.textContent = orig; }
  }

  async function parseApiResponse(response) {
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("application/json")) return response.json();
    const body = await response.text().catch(() => "(unreadable)"); throw new Error("Admin API \u8fd4\u56de\u7684\u4e0d\u662f JSON (status " + response.status + ", body=" + body.slice(0, 200) + ")");
  }

  function normalizeImportList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => text(item).trim()).filter(Boolean);
    }
    return splitList(value);
  }

  function normalizeImportedUpstreams(payload) {
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray(payload && payload.upstreams)
        ? payload.upstreams
        : [];

    return raw.map(function(item, index) {
      const headers = item && typeof item.headers === "object" && !Array.isArray(item.headers) ? item.headers : {};
      return {
        account_id: text(item && item.account_id).trim(),
        api_key_value: text(item && (item.api_key || item.api_key_value)).trim(),
        base_url: text(item && item.base_url).trim(),
        capability: item && item.capability ? item.capability : null,
        enabled: item && item.enabled !== false,
        headers: headers,
        models: normalizeImportList(item && item.models),
        name: text(item && item.name).trim() || "upstream-" + (index + 1),
        note: text(item && item.note).trim(),
        paths: normalizeImportList(item && item.paths),
        preset: text(item && item.preset).trim() || "custom",
        priority: Number(item && item.priority || index + 1),
        weight: Number(item && item.weight || 1),
      };
    }).filter((item) => item.base_url && item.api_key_value);
  }

  function downloadJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportUpstreams() {
    const resp = await fetch(API_BASE + "/upstreams/export");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "导出上游配置失败");
    return payload;
  }

  async function importUpstreamsFromFile(file) {
    const textValue = await file.text();
    const payload = JSON.parse(textValue);
    const upstreams = normalizeImportedUpstreams(payload);
    if (!upstreams.length) {
      throw new Error("导入文件里没有可用的上游配置");
    }
    const currentUpstreams = Array.isArray(state.config && state.config.upstreams) ? state.config.upstreams : [];
    if (currentUpstreams.length && !confirm("导入会覆盖当前上游配置，继续吗？")) {
      return;
    }
    state.config.upstreams = upstreams;
    renderUpstreams();
    await saveConfig();
    showToast("已导入 " + upstreams.length + " 个上游");
  }

  function showError(error) {
    console.error(error);
    showToast(error.message || "Error");
  }

  /* ---- Modal ---- */
  function openVendorModal() {
    if (!state.draftPresetId && state.presets.length) state.draftPresetId = state.presets[0].id;
    ["vendor-note","vendor-name","vendor-api-key","vendor-models","vendor-account-id"].forEach((id) => byId(id).value = "");
    byId("vendor-weight").value = "1"; byId("vendor-enabled").value = "true";
    renderPresets();
    applyVendorPreset();
    byId("vendor-modal").classList.add("open");
  }
  function closeVendorModal() { byId("vendor-modal").classList.remove("open"); }

  function renderPresets() {
    const sel = byId("vendor-preset");
    sel.innerHTML = state.presets.map((p) =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + (
        p.requires_account_id ? ' (REST + Account ID)' :
        p.requires_base_url === false ? ' (\u9884\u8bbe ' + esc(p.base_url || "") + ')' :
        ' (\u81ea\u5b9a\u4e49)'
      ) + '</option>'
    ).join("");
    sel.value = state.draftPresetId || (state.presets[0] ? state.presets[0].id : "custom");
    if (!sel._wired) {
      sel._wired = true;
      sel.addEventListener("change", () => { state.draftPresetId = sel.value; applyVendorPreset(); });
    }
  }

  function applyVendorPreset() {
    const baseInput = byId("vendor-base-url");
    const pathsInput = byId("vendor-paths");
    const accountWrap = byId("vendor-account-id-wrap");
    const accountInput = byId("vendor-account-id");
    const preset = presetById(state.draftPresetId);
    if (!preset) return;
    const locked = preset.requires_base_url === false;
    const needsAccountId = !!preset.requires_account_id;
    accountWrap.style.display = needsAccountId ? "" : "none";
    baseInput.readOnly = locked;
    baseInput.value = presetBaseUrl(preset.id, accountInput.value);
    if (!needsAccountId) accountInput.value = "";
    pathsInput.value = (preset.paths || []).join(", ");
  }

  function createVendorFromModal() {
    const presetId = state.draftPresetId || "custom";
    const note = byId("vendor-note").value.trim();
    const name = byId("vendor-name").value.trim();
    const baseUrl = byId("vendor-base-url").value.trim();
    const apiKey = byId("vendor-api-key").value.trim();
    const accountId = byId("vendor-account-id").value.trim();
    const suffix = Math.random().toString(36).slice(2, 7);
    const preset = presetById(presetId);

    if (!apiKey) throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
    if (preset && preset.requires_account_id && !accountId) throw new Error("Account ID \u4e0d\u80fd\u4e3a\u7a7a");
    if (!baseUrl) throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");

    state.config.upstreams.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "u-" + suffix,
      preset: presetId,
      note, name: name || presetId + "-" + suffix,
      base_url: baseUrl, api_key_value: apiKey,
      account_id: accountId,
      headers: presetHeaders(presetId),
      models: splitList(byId("vendor-models").value),
      paths: splitList(byId("vendor-paths").value),
      weight: Number(byId("vendor-weight").value || 1),
      priority: 100, enabled: byId("vendor-enabled").value === "true",
    });

    renderUpstreams(); closeVendorModal();
    ["vendor-note","vendor-name","vendor-api-key","vendor-models"].forEach((id) => byId(id).value = "");
    byId("vendor-account-id").value = "";
    byId("vendor-weight").value = "1"; byId("vendor-enabled").value = "true";
    renderPresets();
  }

  /* ---- Upstreams ---- */
  function renderUpstreams() {
    const host = byId("upstream-list");
    if (!state.config.upstreams.length) {
      host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u4e0a\u6e38\uff0c\u70b9\u4e0a\u65b9\u201c+ \u6dfb\u52a0\u4e0a\u6e38\u201d\u5f00\u59cb\u3002</div>';
      return;
    }

    host.innerHTML = state.config.upstreams.map((item) => {
      const p = presetById(item.preset);
      const badge = p ? p.name : (item.preset || "generic");
      const locked = baseUrlLocked(item.preset);
      const needsAccountId = presetNeedsAccountId(item.preset);
      const accountIdValue = text(item.account_id).trim();
      const presetOptions = state.presets.map((pr) =>
        '<option value="' + esc(pr.id) + '"' + (pr.id === item.preset ? ' selected' : '') + '>' + esc(pr.name) + '</option>'
      ).join("");
      const accountRow = needsAccountId
        ? '<div class="row"><div class="field span-12"><label>Account ID</label><input data-field="account_id" class="mono" value="' + esc(accountIdValue) + '" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div></div>'
        : '<div class="row" style="display:none"><div class="field span-12"><label>Account ID</label><input data-field="account_id" class="mono" value="' + esc(accountIdValue) + '" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div></div>';

      return '<details class="upstream-card' + (item.enabled ? '' : ' disabled') + '" data-id="' + esc(item.id) + '">' +
        '<summary>' +
          '<span class="card-badge">' + esc(badge) + '</span>' +
          '<strong>' + esc(item.note || item.name || "\u672a\u547d\u540d") + '</strong>' +
          '<span class="health-dot" data-upstream="' + esc(item.name) + '"></span>' +
          (["custom","generic-openai","claude-openai"].includes(item.preset) ? '<span class="capability-badge" data-upstream="' + esc(item.name) + '">' + (item.capability === "openai" ? '\u2713 OpenAI' : item.capability === "claude" ? 'Claude' : '\u672a\u68c0\u6d4b') + '</span>' : '') +
          '<span class="card-meta">\u6743\u91cd:' + esc(item.weight) + ' | \u4f18\u5148:' + esc(item.priority) + ' | ' + (item.enabled ? '\u5df2\u542f\u7528' : '\u5df2\u505c\u7528') + '</span>' +
          (isNimConfig(item) ? '<span class="card-meta nim-rpm" data-upstream="' + esc(item.name) + '"><span class="nim-rpm-count">NIM 0/40</span><span class="nim-rpm-timer" hidden> · 60s</span></span>' : '') +
          '<button type="button" class="small upstream-enable-toggle ' + (item.enabled ? 'secondary' : 'good') + '" data-enabled="' + (item.enabled ? 'true' : 'false') + '">' + (item.enabled ? '\u505c\u7528' : '\u542f\u7528') + '</button>' +
        '</summary>' +
        '<div class="card-body">' +
          '<div class="row">' +
            '<div class="field span-4"><label>\u6a21\u677f</label><select data-field="preset">' + presetOptions + '</select></div>' +
            '<div class="field span-4"><label>\u5907\u6ce8</label><input data-field="note" value="' + esc(item.note) + '"></div>' +
            '<div class="field span-4"><label>\u5185\u90e8\u540d\u79f0</label><input data-field="name" value="' + esc(item.name) + '"></div>' +
          '</div>' +
          accountRow +
          '<div class="row">' +
            '<div class="field span-6"><label>Base URL' + (locked ? ' (\u9884\u8bbe)' : '') + '</label><input data-field="base_url" value="' + esc(item.base_url || presetBaseUrl(item.preset, accountIdValue)) + '"' + (locked ? ' readonly' : '') + '></div>' +
            '<div class="field span-6"><label>API Key (\u4fdd\u5b58\u540e\u663e\u793a\u5bc6\u6587)</label><input class="mono" data-field="api_key_value" value="' + esc(item.api_key_value) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-3"><label>\u6743\u91cd</label><input data-field="weight" type="number" min="1" value="' + esc(item.weight) + '"></div>' +
            '<div class="field span-3"><label>\u4f18\u5148\u7ea7</label><input data-field="priority" type="number" value="' + esc(item.priority) + '"></div>' +
            '<div class="field span-3"><label>\u542f\u7528</label><select data-field="enabled"><option value="true"' + (item.enabled ? ' selected' : '') + '>\u662f</option><option value="false"' + (!item.enabled ? ' selected' : '') + '>\u5426</option></select></div>' +
            '<div class="field span-3"><label>\u8def\u5f84</label><input data-field="paths" value="' + esc((item.paths || []).join(", ")) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-12"><label>\u6a21\u578b (\u6bcf\u884c\u4e00\u4e2a, \u7559\u7a7a=\u81ea\u52a8)</label><textarea data-field="models">' + esc((item.models || []).join("\\n")) + '</textarea><button type="button" class="small secondary fetch-models-btn" data-upstream="' + esc(item.name) + '" style="margin-top:4px">\u4ece\u4e0a\u6e38\u5bfc\u5165\u6a21\u578b</button></div>' +
          '</div>' +
          '<button type="button" class="danger small delete-upstream">\u5220\u9664\u4e0a\u6e38</button>' +
          (["custom","generic-openai","claude-openai"].includes(item.preset) ? '<button type="button" class="secondary small detect-upstream" data-upstream="' + esc(item.name) + '">\u68c0\u6d4b\u80fd\u529b</button>' : '') +
        '</div>' +
      '</details>';
    }).join("");

    host.querySelectorAll(".detect-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        await withButtonBusy(btn, "\u68c0\u6d4b\u4e2d...", () => detectCapability(btn.dataset.upstream));
      });
    });
    host.querySelectorAll(".upstream-enable-toggle").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const card = btn.closest(".upstream-card");
        const enabled = btn.dataset.enabled !== "true";
        card.querySelector('[data-field="enabled"]').value = enabled ? "true" : "false";
        await withButtonBusy(btn, enabled ? "\u542f\u7528\u4e2d..." : "\u505c\u7528\u4e2d...", saveConfig).catch(showError);
      });
    });
    host.querySelectorAll(".delete-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        const card = btn.closest(".upstream-card");
        await withButtonBusy(btn, "\u5220\u9664\u4e2d...", async () => {
          state.config.upstreams = state.config.upstreams.filter((u) => u.id !== card.dataset.id);
          renderUpstreams();
          await saveConfig();
          showToast("\u5df2\u5220\u9664\u5e76\u4fdd\u5b58");
        });
      });
    });
    host.querySelectorAll(".fetch-models-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        var name = btn.dataset.upstream;
        var card = btn.closest(".upstream-card");
        var textarea = card ? card.querySelector('[data-field="models"]') : null;
        await withButtonBusy(btn, "\u5bfc\u5165\u4e2d...", async function() {
          var models = await fetchUpstreamModels(name, card);
          if (!models.length) throw new Error("\u8be5\u4e0a\u6e38\u65e0\u53ef\u7528\u6a21\u578b");
          showModelPicker(name, models, textarea, card);
        });
      });
    });

    host.querySelectorAll('select[data-field="preset"]').forEach((sel) => {
      sel.addEventListener("change", () => {
        const card = sel.closest(".upstream-card");
        const p = presetById(sel.value);
        const needsAccountId = !!p && p.requires_account_id;
        const baseInput = card.querySelector('[data-field="base_url"]');
        const pathsInput = card.querySelector('[data-field="paths"]');
        const accountRow = card.querySelector('[data-field="account_id"]')?.closest(".row");
        const accountInput = card.querySelector('[data-field="account_id"]');
        if (accountRow) accountRow.style.display = needsAccountId ? "" : "none";
        baseInput.readOnly = !!p && (p.requires_base_url === false || needsAccountId);
        baseInput.value = presetBaseUrl(sel.value, accountInput ? accountInput.value : "");
        pathsInput.value = (p?.paths || []).join(", ");
      });
    });
    host.querySelectorAll('[data-field="account_id"]').forEach((input) => {
      input.addEventListener("input", () => {
        const card = input.closest(".upstream-card");
        const presetSel = card.querySelector('select[data-field="preset"]');
        const p = presetById(presetSel.value);
        if (!p || !p.requires_account_id) return;
        const baseInput = card.querySelector('[data-field="base_url"]');
        baseInput.value = presetBaseUrl(presetSel.value, input.value);
      });
    });
  }

  function collectConfig() {
    const existingUpstreams = Array.isArray(state.config && state.config.upstreams) ? state.config.upstreams : [];
    const cards = [...document.querySelectorAll(".upstream-card")];
    const upstreams = cards.map((card, index) => {
      const prev = existingUpstreams.find((item) => String(item && item.id) === String(card.dataset.id)) || existingUpstreams[index] || {};
      return {
        capability: prev.capability || null,
        account_id: card.querySelector('[data-field="account_id"]')?.value.trim() || prev.account_id || "",
        id: card.dataset.id || prev.id,
        headers: prev.headers || {},
        preset: card.querySelector('[data-field="preset"]').value,
        note: card.querySelector('[data-field="note"]').value.trim(),
        name: card.querySelector('[data-field="name"]').value.trim(),
        base_url: card.querySelector('[data-field="base_url"]').value.trim(),
        api_key_value: card.querySelector('[data-field="api_key_value"]').value.trim(),
        weight: Number(card.querySelector('[data-field="weight"]').value || 1),
        priority: Number(card.querySelector('[data-field="priority"]').value || 100),
        enabled: card.querySelector('[data-field="enabled"]').value === "true",
        paths: splitList(card.querySelector('[data-field="paths"]').value),
        models: splitList(card.querySelector('[data-field="models"]').value),
      };
    });
    return {
      settings: {
        request_timeout_ms: Number(byId("request-timeout").value || 180000),
        upstream_cooldown_ttl: Number(byId("cooldown-ttl").value || 60),
        model_cache_ttl: Number(byId("model-cache-ttl").value || 3600),
        system_prompt: byId("system-prompt-input").value,
      },
      routing: {
        load_balance: byId("routing-load-balance").checked,
        failover: byId("routing-failover").checked,
        hedge_enabled: byId("routing-hedge").checked,
        hedge_max: Number(byId("routing-hedge-max").value || 2),
      },
      upstreams,
    };
  }

  function isNimConfig(upstream) {
    return upstream && (upstream.preset === "nvidia-nim" || text(upstream.base_url).toLowerCase().includes("integrate.api.nvidia.com"));
  }

  /* ---- Settings ---- */
  function renderSettings() {
    var s = state.config && state.config.settings || {};
    var r = state.config && state.config.routing || {};
    byId("request-timeout").value = s.request_timeout_ms || "";
    byId("cooldown-ttl").value = s.upstream_cooldown_ttl || "";
    byId("model-cache-ttl").value = s.model_cache_ttl || "";
    byId("system-prompt-input").value = s.system_prompt || "";
    byId("system-prompt-status").textContent = s.system_prompt ? "\u5df2\u542f\u7528 (" + s.system_prompt.length + " \u5b57\u7b26)" : "\u672a\u542f\u7528";
    byId("routing-load-balance").checked = r.load_balance !== false;
    byId("routing-failover").checked = r.failover !== false;
    byId("routing-hedge").checked = r.hedge_enabled === true;
    byId("routing-hedge-max").value = r.hedge_max || 2;
    byId("gateway-url-pill").textContent = (state.gateway && state.gateway.base_url) || "loading...";
  }

  async function loadConfig() {
    const resp = await fetch(API_BASE + "/config");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u8bfb\u53d6\u914d\u7f6e\u5931\u8d25");
    state.config = payload.config || {};
    state.presets = payload.presets || [];
    state.gateway = payload.gateway || {};
    renderSettings();
    renderUpstreams();
    loadRuntimeStatus().catch(function(){});
  }

  async function saveConfig() {
    const resp = await fetch(API_BASE + "/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(collectConfig()),
    });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u4fdd\u5b58\u5931\u8d25");
    state.config = payload.config;
    renderSettings(); renderUpstreams();
    loadRuntimeStatus().catch(function(){});
    showToast("\u914d\u7f6e\u5df2\u4fdd\u5b58");
    byId("config-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("config-status").textContent = "", 3000);
  }

  async function saveSettings() {
    await saveConfig();
    byId("settings-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("settings-status").textContent = "", 3000);
  }

  function openSystemPromptModal() {
    byId("system-prompt-modal").classList.add("open");
    byId("system-prompt-input").focus();
  }

  function closeSystemPromptModal() {
    byId("system-prompt-modal").classList.remove("open");
  }

  async function refreshModels() {
    const resp = await fetch(API_BASE + "/refresh", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5237\u65b0\u5931\u8d25");
    const summary = (payload.result || []).map((r) => r.name + ":" + r.model_count).join(", ");
    showToast("\u6a21\u578b\u7f13\u5b58\u5df2\u5237\u65b0");
    byId("config-status").textContent = "\u2713 \u5df2\u5237\u65b0 " + summary;
    setTimeout(() => byId("config-status").textContent = "", 5000);
  }

  async function checkHealth() {
    const dots = document.querySelectorAll(".health-dot");
    dots.forEach((d) => { d.className = "health-dot checking"; d.title = "\u68c0\u67e5\u4e2d..."; });
    const resp = await fetch(API_BASE + "/health", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5065\u5eb7\u5ea6\u68c0\u67e5\u5931\u8d25");
    (payload.results || []).forEach((r) => {
      const dot = document.querySelector('.health-dot[data-upstream="' + r.name + '"]');
      if (!dot) return;
      dot.className = "health-dot " + (r.ok ? "ok" : "fail");
      dot.title = r.ok ? ("HTTP " + r.status + ", " + r.latency_ms + "ms") : ("\u5931\u8d25: " + (r.error || ("HTTP " + r.status)) + ", " + r.latency_ms + "ms");
    });
    const ok = (payload.results || []).filter((r) => r.ok).length;
    const total = (payload.results || []).length;
    showToast("\u5065\u5eb7\u5ea6: " + ok + "/" + total + " \u6b63\u5e38");
  }

  async function loadRuntimeStatus() {
    const resp = await fetch(API_BASE + "/runtime");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) return;
    const nim = payload.nim_rpm || {};
    document.querySelectorAll(".nim-rpm").forEach(function(el) {
      const item = nim[el.dataset.upstream];
      const countEl = el.querySelector(".nim-rpm-count");
      const timerEl = el.querySelector(".nim-rpm-timer");
      if (!item) {
        if (countEl) countEl.textContent = "NIM 0/40";
        if (timerEl) timerEl.hidden = true;
        el.title = "\u5c1a\u672a\u5f00\u59cb\u8ba1\u65f6";
        return;
      }
      const seconds = Math.max(0, Math.ceil(Number(item.reset_in_ms || 0) / 1000));
      if (countEl) countEl.textContent = "NIM " + item.count + "/" + item.limit;
      if (timerEl) {
        timerEl.hidden = false;
        timerEl.textContent = " · " + seconds + "s";
      }
      el.title = seconds + "s \u540e\u6e05\u96f6";
    });
  }

  async function speedTest() {
    const picker = state.speedPicker;
    if (!picker || !picker.model || !picker.upstream) return;
    const resp = await fetch(API_BASE + "/speed-test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: picker.model, upstreams: [picker.upstream] }),
    });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u6d4b\u901f\u5931\u8d25");
    (payload.results || []).forEach((r) => {
      const dot = document.querySelector('.health-dot[data-upstream="' + r.name + '"]');
      if (!dot) return;
      dot.className = "health-dot " + (r.ok ? "ok" : "fail");
      dot.title = (r.ok ? "\u6d4b\u901f " : "\u6d4b\u901f\u5931\u8d25 ") + (r.error || ("HTTP " + r.status)) + ", " + r.latency_ms + "ms";
    });
    const best = (payload.results || []).filter((r) => r.ok).sort((a,b) => a.latency_ms - b.latency_ms)[0];
    showToast(best ? ("\u6700\u5feb: " + best.name + " " + best.latency_ms + "ms") : "\u6ca1\u6709\u4e0a\u6e38\u901a\u8fc7\u6d4b\u901f");
    if (best) byId("speed-picker-status").textContent = best.name + " · " + best.latency_ms + "ms";
  }

  async function detectCapability(upstreamName) {
    const resp = await fetch(API_BASE + "/upstreams/" + encodeURIComponent(upstreamName) + "/detect", { method: "POST" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u68c0\u6d4b\u5931\u8d25");
    const badge = document.querySelector('.capability-badge[data-upstream="' + upstreamName + '"]');
    if (badge) {
      badge.textContent = payload.capability === "openai" ? "\u2713 OpenAI" : "Claude";
    }
    showToast(upstreamName + ": " + (payload.capability === "openai" ? "OpenAI Compatible (chat+embeddings)" : "Claude Compatible (chat only)") + ", " + payload.latency_ms + "ms");
  }

  async function fetchModels(payload) {
    const resp = await fetch(API_BASE + "/fetch-models", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(data?.error?.message || data?.error || "\u83b7\u53d6\u6a21\u578b\u5931\u8d25");
    return data.models || [];
  }

  async function fetchUpstreamModels(upstreamName, card) {
    const payload = { name: upstreamName };
    if (card) {
      payload.account_id = card.querySelector('[data-field="account_id"]')?.value.trim() || "";
      payload.api_key = card.querySelector('[data-field="api_key_value"]')?.value.trim() || "";
      payload.base_url = card.querySelector('[data-field="base_url"]')?.value.trim() || "";
      payload.preset = card.querySelector('[data-field="preset"]')?.value || "";
    }
    return fetchModels(payload);
  }

  async function fetchDraftUpstreamModels() {
    const baseUrl = byId("vendor-base-url").value.trim();
    const apiKey = byId("vendor-api-key").value.trim();
    const presetId = state.draftPresetId || "custom";
    const accountId = byId("vendor-account-id").value.trim();
    if (presetNeedsAccountId(presetId) && !accountId) throw new Error("Account ID \u4e0d\u80fd\u4e3a\u7a7a");
    if (!baseUrl) throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");
    if (!apiKey) throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
    return fetchModels({ account_id: accountId, base_url: baseUrl, api_key: apiKey, preset: presetId });
  }

  function titleParts(parts) {
    return parts.filter(Boolean).map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(" ") || "Other";
  }

  function modelDisplayName(model) {
    const value = text(model);
    return value.startsWith("@cf/") ? value.slice(4) : value;
  }

  function statModelSuffix(model) {
    const value = modelDisplayName(model);
    const parts = value.split("/");
    return parts[parts.length - 1] || value;
  }

  function statTipHtml(bucket, kind) {
    const hour = esc(bucket.hour || "");
    if (kind === "tokens") {
      return '<div class="stat-tip-title">时间段 ' + hour + '</div>' +
        '<div class="stat-tip-row"><span>总 Input</span><span class="stat-tip-value">' + esc((bucket.prompt_tokens || 0).toLocaleString()) + '</span></div>' +
        '<div class="stat-tip-row"><span>总 Output</span><span class="stat-tip-value">' + esc((bucket.completion_tokens || 0).toLocaleString()) + '</span></div>';
    }

    const statuses = bucket.model_statuses || {};
    const statusEntries = Object.entries(statuses).sort(function(a, b) {
      const av = (a[1]?.success || 0) + (a[1]?.fail || 0);
      const bv = (b[1]?.success || 0) + (b[1]?.fail || 0);
      return bv - av;
    });
    const fallbackEntries = Object.entries(bucket.models || {}).sort(function(a, b) { return b[1] - a[1]; });
    const entries = (statusEntries.length ? statusEntries : fallbackEntries).slice(0, 8);
    const more = (statusEntries.length || fallbackEntries.length) - entries.length;
    const rows = entries.length ? entries.map(function(entry) {
      const value = statusEntries.length
        ? ((entry[1]?.success || 0) + ' 成 / ' + (entry[1]?.fail || 0) + ' 败')
        : (entry[1] + ' 次');
      return '<div class="stat-tip-row"><span class="stat-tip-model">' + esc(statModelSuffix(entry[0])) + '</span><span class="stat-tip-value">' + esc(value) + '</span></div>';
    }).join("") : '<div class="stat-tip-row"><span>暂无模型</span><span class="stat-tip-value">-</span></div>';
    return '<div class="stat-tip-title">时间段 ' + hour + '</div>' +
      '<div class="stat-tip-row"><span>总成功/失败</span><span class="stat-tip-value">' + esc(bucket.success || 0) + ' / ' + esc(bucket.fail || 0) + '</span></div>' +
      rows +
      (more > 0 ? '<div class="stat-tip-row"><span>其他模型</span><span class="stat-tip-value">+' + esc(more) + '</span></div>' : '');
  }

  function placeStatTip(event, anchor) {
    const tip = byId("stat-tip");
    if (!tip || tip.hidden) return;
    const rect = anchor ? anchor.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const point = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? { x: event.clientX, y: event.clientY }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const gap = 12;
    const tipRect = tip.getBoundingClientRect();
    let x = point.x + gap;
    let y = point.y + gap;
    if (x + tipRect.width + gap > window.innerWidth) x = Math.max(gap, window.innerWidth - tipRect.width - gap);
    if (y + tipRect.height + gap > window.innerHeight) y = Math.max(gap, point.y - tipRect.height - gap);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function showStatTip(event, bucket, kind, anchor) {
    const tip = byId("stat-tip");
    if (!tip || !bucket) return;
    tip.innerHTML = statTipHtml(bucket, kind);
    tip.hidden = false;
    placeStatTip(event, anchor);
  }

  function hideStatTip() {
    const tip = byId("stat-tip");
    if (tip) tip.hidden = true;
  }

  function bindStatBars(buckets) {
    document.querySelectorAll(".chart-bar .bar[data-stat-kind]").forEach(function(bar) {
      const bucket = buckets[Number(bar.dataset.statIndex)];
      const kind = bar.dataset.statKind;
      bar.addEventListener("mouseenter", function(event) { showStatTip(event, bucket, kind, bar); });
      bar.addEventListener("mousemove", function(event) { placeStatTip(event, bar); });
      bar.addEventListener("mouseleave", hideStatTip);
      bar.addEventListener("focus", function(event) { showStatTip(event, bucket, kind, bar); });
      bar.addEventListener("blur", hideStatTip);
      bar.addEventListener("click", function(event) {
        event.stopPropagation();
        showStatTip(event, bucket, kind, bar);
      });
    });
  }

  function modelSourceName(model) {
    const value = modelDisplayName(model);
    const raw = value.includes("/") ? value.split("/")[0] : "";
    if (!raw) return "Other";
    const cleaned = raw.replace(/[-_](ai|labs?|inc|org)$/i, "");
    return titleParts(cleaned.split(/[-_.]+/));
  }

  function modelFamilyName(model) {
    const value = modelDisplayName(model);
    const raw = value.includes("/") ? value.split("/").slice(1).join("/") : value;
    const parts = raw.split(/[\/_-]+/).filter(Boolean);
    if (!parts.length) return "Other";
    const second = parts[1] || "";
    const family = second && !/^\d+(?:\.\d+)?[bkmt]?$/i.test(second) ? parts.slice(0, 2) : parts.slice(0, 1);
    return titleParts(family);
  }

  const MODEL_TAGS = [
    { id: "chat", label: "\u804a\u5929" },
    { id: "text", label: "\u5355\u6a21\u6001" },
    { id: "vision", label: "\u591a\u6a21\u6001" },
    { id: "tools", label: "\u5de5\u5177" },
    { id: "thinking", label: "\u63a8\u7406" },
  ];
  const EXCLUSIVE_MODEL_TAGS = [["text", "vision"]];

  function modelTags(model) {
    const value = modelDisplayName(model).toLowerCase();
    const tags = ["chat"];
    const vision = /(^|[\/_.-])(vl|vision|visual|image|multimodal|omni|pixtral|gemini|gpt-4o|qwen2(?:\.5)?-vl)([\/_.-]|$)/i.test(value);
    tags.push(vision ? "vision" : "text");
    if (/(function|tool|fc|tools?|gpt-|claude|gemini|qwen|llama-3|mistral|mixtral|deepseek)/i.test(value)) tags.push("tools");
    if (/(^|[\/_.-])(r1|r1t|reason|reasoning|reasoner|think|thinking|qwq|marco|o1|o3|o4|grok-4|sonar-reasoning|deepseek-v3\.1|deepseek-v4|deepseek-r1|deepseek-reasoner|qwen3)([\/_.-]|$)/i.test(value)) tags.push("thinking");
    return tags;
  }

  function renderModelTags(model) {
    const tags = modelTags(model);
    return '<span class="model-tags">' + MODEL_TAGS.filter(function(tag) {
      return tags.includes(tag.id);
    }).map(function(tag) {
      return '<span class="model-tag">' + esc(tag.label) + '</span>';
    }).join("") + '</span>';
  }

  function showModelPicker(upstreamName, models, target, sourceCard) {
    const unique = Array.from(new Set((models || []).filter(Boolean))).sort();
    state.modelPicker = {
      title: upstreamName || "\u5f53\u524d\u4e0a\u6e38",
      models: unique,
      group: "__all__",
      family: "__all__",
      tags: new Set(),
      selected: new Set(splitList(target.value)),
      sourceCard: sourceCard || null,
      target,
      visible: unique,
    };
    byId("model-picker-search").value = "";
    byId("picker-apply-same-preset").checked = false;
    byId("model-picker-modal").classList.add("open");
    renderModelPicker();
  }

  function toggleModelTag(picker, tag) {
    if (tag === "__all__") {
      picker.tags.clear();
      return;
    }
    if (picker.tags.has(tag)) {
      picker.tags.delete(tag);
      return;
    }
    EXCLUSIVE_MODEL_TAGS.forEach(function(group) {
      if (group.includes(tag)) group.forEach(function(item) { picker.tags.delete(item); });
    });
    picker.tags.add(tag);
  }

  function renderModelPicker() {
    const picker = state.modelPicker;
    if (!picker) return;
    if (!picker.tags) picker.tags = new Set();
    const query = byId("model-picker-search").value.trim().toLowerCase();
    const groups = {};
    picker.models.forEach(function(model) {
      const group = modelSourceName(model);
      const family = modelFamilyName(model);
      if (!groups[group]) groups[group] = { models: [], families: {} };
      groups[group].models.push(model);
      if (!groups[group].families[family]) groups[group].families[family] = [];
      groups[group].families[family].push(model);
    });

    const groupNames = Object.keys(groups).sort();
    if (picker.group !== "__all__" && !groups[picker.group]) picker.group = "__all__";
    const families = picker.group === "__all__" ? {} : groups[picker.group].families;
    const familyNames = Object.keys(families).sort();
    if (picker.family !== "__all__" && !families[picker.family]) picker.family = "__all__";
    const sourceModels = picker.group === "__all__"
      ? picker.models
      : (picker.family === "__all__" ? groups[picker.group].models : families[picker.family]);
    picker.visible = sourceModels.filter(function(model) {
      const tags = modelTags(model);
      const tagOk = !picker.tags.size || Array.from(picker.tags).every(function(tag) { return tags.includes(tag); });
      const queryOk = !query || model.toLowerCase().includes(query) || modelDisplayName(model).toLowerCase().includes(query);
      return tagOk && queryOk;
    });

    byId("model-picker-title").textContent = "\u9009\u62e9\u6a21\u578b - " + picker.title;
    byId("picker-count").textContent = "\u5df2\u9009 " + picker.selected.size + " / " + picker.models.length;
    byId("picker-same-preset-wrap").hidden = !picker.sourceCard;
    byId("model-tag-filter").innerHTML =
      '<button type="button" class="small secondary' + (!picker.tags.size ? ' active' : '') + '" data-tag="__all__">\u5168\u90e8\u6807\u7b7e</button>' +
      MODEL_TAGS.map(function(tag) {
        return '<button type="button" class="small secondary' + (picker.tags.has(tag.id) ? ' active' : '') + '" data-tag="' + esc(tag.id) + '">' + esc(tag.label) + '</button>';
      }).join("");
    byId("model-picker-groups").innerHTML =
      '<button type="button" class="model-group-btn' + (picker.group === "__all__" ? ' active' : '') + '" data-group="__all__"><span>\u5168\u90e8</span><span>' + picker.models.length + '</span></button>' +
      groupNames.map(function(name) {
        return '<button type="button" class="model-group-btn' + (picker.group === name ? ' active' : '') + '" data-group="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + groups[name].models.length + '</span></button>';
      }).join("");
    byId("model-picker-subgroups").innerHTML = picker.group === "__all__"
      ? '<div class="note" style="padding:8px">\u9009\u62e9\u6765\u6e90\u540e\u7ec6\u5206</div>'
      : '<button type="button" class="model-group-btn' + (picker.family === "__all__" ? ' active' : '') + '" data-family="__all__"><span>\u5168\u90e8</span><span>' + groups[picker.group].models.length + '</span></button>' +
        familyNames.map(function(name) {
          return '<button type="button" class="model-group-btn' + (picker.family === name ? ' active' : '') + '" data-family="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + families[name].length + '</span></button>';
        }).join("");

    byId("model-picker-list").innerHTML = picker.visible.length
      ? picker.visible.map(function(model) {
          return '<label class="model-row" title="' + esc(model) + '"><input type="checkbox" class="model-pick" value="' + esc(model) + '"' + (picker.selected.has(model) ? ' checked' : '') + '><span class="mono">' + esc(modelDisplayName(model)) + '</span>' + renderModelTags(model) + '</label>';
        }).join("")
      : '<div class="note" style="padding:12px">\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b</div>';

    byId("model-tag-filter").querySelectorAll("[data-tag]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        toggleModelTag(picker, btn.dataset.tag);
        renderModelPicker();
      });
    });
    byId("model-picker-groups").querySelectorAll(".model-group-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.group = btn.dataset.group;
        picker.family = "__all__";
        renderModelPicker();
      });
    });
    byId("model-picker-subgroups").querySelectorAll(".model-group-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.family = btn.dataset.family;
        renderModelPicker();
      });
    });
    byId("model-picker-list").querySelectorAll(".model-pick").forEach(function(cb) {
      cb.addEventListener("change", function() {
        if (cb.checked) picker.selected.add(cb.value);
        else picker.selected.delete(cb.value);
        byId("picker-count").textContent = "\u5df2\u9009 " + picker.selected.size + " / " + picker.models.length;
      });
    });
  }

  function closeModelPicker() {
    state.modelPicker = null;
    byId("model-picker-modal").classList.remove("open");
  }

  function selectVisibleModels(selected) {
    const picker = state.modelPicker;
    if (!picker) return;
    picker.visible.forEach(function(model) {
      if (selected) picker.selected.add(model);
      else picker.selected.delete(model);
    });
    renderModelPicker();
  }

  function applyModelPicker() {
    const picker = state.modelPicker;
    if (!picker || !picker.target) return;
    const picked = Array.from(picker.selected).sort();
    picker.target.value = picked.join(picker.target.tagName === "TEXTAREA" ? "\\n" : ", ");
    if (picker.sourceCard && byId("picker-apply-same-preset").checked) {
      const preset = picker.sourceCard.querySelector('[data-field="preset"]')?.value || "";
      document.querySelectorAll(".upstream-card").forEach(function(card) {
        if (card.querySelector('[data-field="preset"]')?.value === preset) {
          card.querySelector('[data-field="models"]').value = picked.join("\\n");
        }
      });
    }
    closeModelPicker();
    showToast("\u5df2\u5bfc\u5165 " + picked.length + " \u4e2a\u6a21\u578b");
  }

  function openSpeedPicker() {
    const upstreams = collectConfig().upstreams
      .filter((upstream) => upstream.enabled !== false)
      .map((upstream) => ({ ...upstream, models: (upstream.models || []).filter((model) => model && model !== "*") }))
      .filter((upstream) => upstream.models.length);
    if (!upstreams.length) throw new Error("\u6ca1\u6709\u53ef\u6d4b\u901f\u7684\u4e0a\u6e38\u6a21\u578b\uff0c\u5148\u7ed9\u4e0a\u6e38\u5bfc\u5165\u6216\u586b\u5199\u6a21\u578b");
    state.speedPicker = {
      upstreams,
      upstream: upstreams[0].name,
      group: "__all__",
      model: upstreams[0].models[0],
      visible: upstreams[0].models,
    };
    byId("speed-picker-search").value = "";
    byId("speed-picker-status").textContent = "";
    byId("speed-picker-modal").classList.add("open");
    renderSpeedPicker();
  }

  function closeSpeedPicker() {
    state.speedPicker = null;
    byId("speed-picker-modal").classList.remove("open");
  }

  function renderSpeedPicker() {
    const picker = state.speedPicker;
    if (!picker) return;
    const upstream = picker.upstreams.find((item) => item.name === picker.upstream) || picker.upstreams[0];
    picker.upstream = upstream.name;
    const groups = {};
    upstream.models.forEach(function(model) {
      const group = modelSourceName(model);
      if (!groups[group]) groups[group] = [];
      groups[group].push(model);
    });
    const groupNames = Object.keys(groups).sort();
    if (picker.group !== "__all__" && !groups[picker.group]) picker.group = "__all__";
    const sourceModels = picker.group === "__all__" ? upstream.models : groups[picker.group];
    const query = byId("speed-picker-search").value.trim().toLowerCase();
    picker.visible = sourceModels.filter(function(model) {
      return !query || model.toLowerCase().includes(query) || modelDisplayName(model).toLowerCase().includes(query);
    });
    if (!picker.visible.includes(picker.model)) picker.model = picker.visible[0] || "";

    byId("speed-picker-upstreams").innerHTML = picker.upstreams.map(function(item) {
      return '<button type="button" class="model-group-btn' + (picker.upstream === item.name ? ' active' : '') + '" data-upstream="' + esc(item.name) + '"><span>' + esc(item.note || item.name) + '</span><span>' + item.models.length + '</span></button>';
    }).join("");
    byId("speed-picker-groups").innerHTML =
      '<button type="button" class="model-group-btn' + (picker.group === "__all__" ? ' active' : '') + '" data-group="__all__"><span>\u5168\u90e8</span><span>' + upstream.models.length + '</span></button>' +
      groupNames.map(function(name) {
        return '<button type="button" class="model-group-btn' + (picker.group === name ? ' active' : '') + '" data-group="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + groups[name].length + '</span></button>';
      }).join("");
    byId("speed-picker-models").innerHTML = picker.visible.length
      ? picker.visible.map(function(model) {
          return '<button type="button" class="model-row' + (picker.model === model ? ' active' : '') + '" data-model="' + esc(model) + '" title="' + esc(model) + '"><span class="mono">' + esc(modelDisplayName(model)) + '</span></button>';
        }).join("")
      : '<div class="note" style="padding:12px">\u6ca1\u6709\u5339\u914d\u7684\u6a21\u578b</div>';

    byId("speed-picker-upstreams").querySelectorAll("[data-upstream]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.upstream = btn.dataset.upstream;
        picker.group = "__all__";
        const next = picker.upstreams.find((item) => item.name === picker.upstream);
        picker.model = next && next.models[0] || "";
        renderSpeedPicker();
      });
    });
    byId("speed-picker-groups").querySelectorAll("[data-group]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.group = btn.dataset.group;
        renderSpeedPicker();
      });
    });
    byId("speed-picker-models").querySelectorAll("[data-model]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        picker.model = btn.dataset.model;
        renderSpeedPicker();
      });
    });
  }

  async function loadStats() {
    const resp = await fetch(API_BASE + "/stats");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "读取统计失败");
    const buckets = payload.buckets || [];

    const skeleton = buckets;

    // Aggregate totals
    var total = 0, success = 0, fail = 0, pt = 0, ct = 0;
    skeleton.forEach(function(b) { total += b.total; success += b.success; fail += b.fail; pt += b.prompt_tokens; ct += b.completion_tokens; });
    byId("stat-total").textContent = total;
    byId("stat-success").textContent = success;
    byId("stat-fail").textContent = fail;
    byId("stat-pt").textContent = pt.toLocaleString();
    byId("stat-ct").textContent = ct.toLocaleString();
    // ponytail: track session cumulative (what this page load has seen)
    state.sessionInputTokens = Math.max(state.sessionInputTokens, pt);
    state.sessionOutputTokens = Math.max(state.sessionOutputTokens, ct);
    byId("stat-pt-session").textContent = state.sessionInputTokens.toLocaleString();
    byId("stat-ct-session").textContent = state.sessionOutputTokens.toLocaleString();

    // Last model
    var currentModel = payload.last_model || "";
    var lastBucket = skeleton.slice().reverse().find(function(b) { return b.total > 0; });
    if (!currentModel && lastBucket && lastBucket.models) {
      var topModel = Object.entries(lastBucket.models).sort(function(a,b){return b[1]-a[1];})[0];
      currentModel = topModel ? topModel[0] : "";
    }
    byId("stat-current-model").textContent = currentModel;

    // Chart 1: Requests (green=success, red=fail)
    var maxReq = 1;
    skeleton.forEach(function(b) { if (b.total > maxReq) maxReq = b.total; });
    byId("chart-requests").innerHTML = skeleton.map(function(b, i) {
      var barH = Math.max(2, Math.round(b.total / maxReq * 100));
      var seg = "";
      if (b.total > 0) {
        var okH = Math.max(1, Math.round(b.success / b.total * barH));
        var failH = barH - okH;
        seg = '<div style="height:' + okH + 'px;background:var(--accent);border-radius:2px 2px 0 0"></div>';
        if (failH > 0) seg += '<div style="height:' + failH + 'px;background:#8d2f23"></div>';
      }
      return '<div class="bar' + (b.fail > 0 && b.success === 0 ? ' fail' : '') + '" style="height:' + barH + 'px;flex-direction:column;display:flex;justify-content:flex-end" data-h="' + esc((b.hour || "").slice(-2)) + '" data-stat-kind="requests" data-stat-index="' + i + '" tabindex="0" aria-label="' + esc((b.hour || "") + ': ' + b.success + ' success / ' + b.fail + ' fail') + '">' + seg + '</div>';
    }).join("");

    // Chart 2: Tokens (indigo=input, violet=output)
    var maxTok = 1;
    skeleton.forEach(function(b) { var t = b.prompt_tokens + b.completion_tokens; if (t > maxTok) maxTok = t; });
    byId("chart-tokens").innerHTML = skeleton.map(function(b, i) {
      var tok = b.prompt_tokens + b.completion_tokens;
      var barH = Math.max(2, Math.round(tok / maxTok * 100));
      var seg = "";
      if (tok > 0) {
        var inH = Math.max(1, Math.round(b.prompt_tokens / tok * barH));
        var outH = barH - inH;
        seg = '<div style="height:' + inH + 'px;background:#6366f1;border-radius:2px 2px 0 0"></div>';
        if (outH > 0) seg += '<div style="height:' + outH + 'px;background:#a78bfa"></div>';
      }
      return '<div class="bar" style="height:' + barH + 'px;flex-direction:column;display:flex;justify-content:flex-end" data-h="' + esc((b.hour || "").slice(-2)) + '" data-stat-kind="tokens" data-stat-index="' + i + '" tabindex="0" aria-label="' + esc((b.hour || "") + ': ' + b.prompt_tokens + ' input / ' + b.completion_tokens + ' output tokens') + '">' + seg + '</div>';
    }).join("");
    bindStatBars(skeleton);

    byId("stat-updated").textContent = (payload.now || "").slice(11, 19) + " HKT";
    showToast("统计已加载");
  }

  async function loadLogs() {
    const resp = await fetch(API_BASE + "/logs");
    const payload = await parseApiResponse(resp);
    const logs = payload.logs || [];
    state.logs = logs;
    byId("live-log").innerHTML = logs.length
      ? logs.slice(0, 20).map((l) =>
          '<div class="log-row">' +
            '<span class="log-badge ' + (l.status < 400 ? 'ok' : 'err') + '">' + esc(l.status) + '</span>' +
            '<strong>' + esc(l.upstream) + '</strong>' +
            '<span class="note">' + esc(l.model) + '</span>' +
            '<span class="note">' + esc(l.latency_ms + "ms") + '</span>' +
            '<span class="note">' + esc((l.prompt_tokens || 0) + (l.completion_tokens || 0) + " tk") + '</span>' +
            '</div>'
        ).join("")
      : '<div class="note">\u6682\u65e0\u8bf7\u6c42\u8bb0\u5f55</div>';
    renderLogs(logs);
  }

  /* ---- Logs ---- */
  

  function renderLogs(logs) {
    if (!logs.length) {
      byId("log-list").innerHTML = '<div class="note">\u6682\u65e0\u8c03\u7528\u8bb0\u5f55\u3002</div>';
      byId("token-total").textContent = "";
      return;
    }
    const visibleLogs = state.logExpanded ? logs : logs.slice(0, 5);
    const toggle = logs.length > 5
      ? '<button type="button" class="small secondary" id="toggle-log-expanded">' + (state.logExpanded ? '\u6536\u8d77' : '\u5c55\u5f00\u5168\u90e8 ' + logs.length + ' \u6761') + '</button>'
      : "";
    const totalPrompt = logs.reduce((s, l) => s + (l.prompt_tokens || 0), 0);
    const totalCompletion = logs.reduce((s, l) => s + (l.completion_tokens || 0), 0);
    byId("token-total").textContent = "\u603b\u8ba1: " + totalPrompt + " input + " + totalCompletion + " output = " + (totalPrompt + totalCompletion) + " tokens (" + logs.length + " \u8bf7\u6c42)";

    byId("log-list").innerHTML = toggle + '<table class="log-table"><thead><tr>' +
      '<th>\u65f6\u95f4</th><th>\u5ba2\u6237\u7aef</th><th>\u4e0a\u6e38</th><th>\u6a21\u578b</th><th>\u63a5\u53e3</th><th>\u72b6\u6001</th><th>\u5ef6\u8fdf</th><th>Tokens</th>' +
    '</tr></thead><tbody>' +
    visibleLogs.map((l) => '<tr>' +
      '<td>' + esc((l.ts || "").slice(11, 19)) + '</td>' +
      '<td>' + esc(l.client || "") + '</td>' +
      '<td>' + esc(l.upstream || "") + '</td>' +
      '<td class="mono">' + esc(l.model || "") + '</td>' +
      '<td class="mono">' + esc((l.path || "").replace("/v1/", "")) + '</td>' +
      '<td class="' + (l.status < 400 ? 'ok' : 'err') + '">' + esc(l.status) + '</td>' +
      '<td>' + esc(l.latency_ms) + 'ms</td>' +
      '<td>' + esc(l.prompt_tokens || 0) + '/' + esc(l.completion_tokens || 0) + '</td>' +
    '</tr>').join("") +
    '</tbody></table>';
    byId("toggle-log-expanded")?.addEventListener("click", () => {
      state.logExpanded = !state.logExpanded;
      renderLogs(state.logs);
    });
  }

  /* ---- Clients ---- */
  async function loadClients() {
    const resp = await fetch(API_BASE + "/clients");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u8bfb\u53d6\u5ba2\u6237\u7aef\u5931\u8d25");
    state.clients = payload;
    renderClients();
  }

  function renderClients() {
    const host = byId("client-list");
    if (!state.clients.length) {
      host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u5ba2\u6237\u7aef Key\uff0c\u70b9\u201c\u751f\u6210 Key\u201d\u521b\u5efa\u3002</div>';
      return;
    }
    host.innerHTML = state.clients.map((c) =>
      '<div class="client-item">' +
        '<div class="client-meta">' +
          '<strong>' + esc(c.name) + '</strong>' +
          '<span class="mono">' + esc(c.key_preview || "") + '</span>' +
          '<span class="note">\u6a21\u578b: ' + esc((c.models || []).join(", ") || "*") + '</span>' +
        '</div>' +
        '<button type="button" class="danger small" data-client-id="' + esc(c.id) + '">\u5220\u9664</button>' +
      '</div>'
    ).join("");
    host.querySelectorAll("button[data-client-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await withButtonBusy(btn, "\u5220\u9664\u4e2d...", async () => {
          await deleteClient(btn.dataset.clientId);
          showToast("\u5df2\u5220\u9664\u5ba2\u6237\u7aef");
        });
      });
    });
  }

  async function createClient() {
    const payload = {
      name: byId("client-name").value.trim() || "generated-client",
      models: ["*"],
      upstreams: [],
    };
    const resp = await fetch(API_BASE + "/clients", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(data?.error?.message || "\u521b\u5efa\u5931\u8d25");

    state.lastCreatedClient = data.client;
    byId("client-output").hidden = false;
    byId("client-output-text").textContent = JSON.stringify(data.client, null, 2);
    byId("refresh-client-key").hidden = false;
    showToast("\u5ba2\u6237\u7aef Key \u5df2\u751f\u6210");
    await loadClients();
  }

  async function deleteClient(id) {
    const resp = await fetch(API_BASE + "/clients/" + encodeURIComponent(id), { method: "DELETE" });
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u5220\u9664\u5931\u8d25");
    await loadClients();
  }

  /* ---- Boot ---- */
  async function boot() {
    try {
      byId("vendor-modal").addEventListener("click", (e) => { if (e.target === byId("vendor-modal")) closeVendorModal(); });
      byId("model-picker-modal").addEventListener("click", (e) => { if (e.target === byId("model-picker-modal")) closeModelPicker(); });
      byId("speed-picker-modal").addEventListener("click", (e) => { if (e.target === byId("speed-picker-modal")) closeSpeedPicker(); });
      byId("system-prompt-modal").addEventListener("click", (e) => { if (e.target === byId("system-prompt-modal")) closeSystemPromptModal(); });
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        hideStatTip();
        if (state.speedPicker) closeSpeedPicker();
        else if (state.modelPicker) closeModelPicker();
        else if (byId("system-prompt-modal").classList.contains("open")) closeSystemPromptModal();
        else closeVendorModal();
      });
      byId("open-vendor-modal").addEventListener("click", openVendorModal);
      byId("open-system-prompt-modal").addEventListener("click", openSystemPromptModal);
      byId("close-system-prompt-modal").addEventListener("click", closeSystemPromptModal);
      byId("apply-system-prompt-modal").addEventListener("click", () => {
        byId("system-prompt-status").textContent = byId("system-prompt-input").value ? "\u5f85\u4fdd\u5b58" : "\u672a\u542f\u7528";
        closeSystemPromptModal();
      });
      byId("upstream-actions-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        byId("upstream-actions").classList.toggle("open");
      });
      document.addEventListener("click", () => { byId("upstream-actions").classList.remove("open"); hideStatTip(); });
      byId("close-vendor-modal").addEventListener("click", closeVendorModal);
      byId("model-picker-close").addEventListener("click", closeModelPicker);
      byId("speed-picker-close").addEventListener("click", closeSpeedPicker);
      byId("speed-picker-cancel").addEventListener("click", closeSpeedPicker);
      byId("speed-picker-search").addEventListener("input", renderSpeedPicker);
      byId("speed-picker-run").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6d4b\u901f\u4e2d...", speedTest).catch(showError)
      );
      byId("picker-cancel").addEventListener("click", closeModelPicker);
      byId("picker-apply").addEventListener("click", applyModelPicker);
      byId("picker-select-visible").addEventListener("click", () => selectVisibleModels(true));
      byId("picker-clear-visible").addEventListener("click", () => selectVisibleModels(false));
      byId("model-picker-search").addEventListener("input", renderModelPicker);
      byId("vendor-account-id").addEventListener("input", applyVendorPreset);
      byId("vendor-fetch-models").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5bfc\u5165\u4e2d...", async () => {
          const models = await fetchDraftUpstreamModels();
          if (!models.length) throw new Error("\u8be5\u4e0a\u6e38\u65e0\u53ef\u7528\u6a21\u578b");
          showModelPicker(byId("vendor-name").value.trim() || "\u5f53\u524d\u4e0a\u6e38", models, byId("vendor-models"));
        }).catch(showError)
      );

      byId("create-vendor").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6dfb\u52a0\u4e2d...", async () => {
          createVendorFromModal();
          await saveConfig();
          showToast("\u4e0a\u6e38\u5df2\u6dfb\u52a0\u5e76\u4fdd\u5b58");
        }).catch(showError)
      );
      byId("save-config").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveConfig).catch(showError)
      );
      byId("save-settings").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveSettings).catch(showError)
      );
      byId("export-upstreams").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5bfc\u51fa\u4e2d...", async () => {
          const payload = await exportUpstreams();
          const stamp = (payload.exported_at || "export").slice(0, 10);
          downloadJsonFile("llmmerge-upstreams-" + stamp + ".json", payload);
          showToast("\u5df2\u5bfc\u51fa " + ((payload.upstreams || []).length || 0) + " \u4e2a\u4e0a\u6e38");
        }).catch(showError)
      );
      byId("import-upstreams").addEventListener("click", () => {
        const input = byId("import-upstreams-file");
        input.value = "";
        input.click();
      });
      byId("import-upstreams-file").addEventListener("change", (e) =>
        withButtonBusy(byId("import-upstreams"), "\u5bfc\u5165\u4e2d...", async () => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          await importUpstreamsFromFile(file);
        }).catch(showError)
      );
      byId("refresh-models").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5237\u65b0\u4e2d...", refreshModels).catch(showError)
      );
      byId("check-health").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u68c0\u67e5\u4e2d...", checkHealth).catch(showError)
      );
      byId("speed-test").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6253\u5f00\u4e2d...", openSpeedPicker).catch(showError)
      );
      byId("load-stats").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u52a0\u8f7d\u4e2d...", loadStats).catch(showError)
      );
      byId("load-logs").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u52a0\u8f7d\u4e2d...", loadLogs).catch(showError)
      );

      byId("create-client").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u751f\u6210\u4e2d...", createClient).catch(showError)
      );
      byId("refresh-client-key").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u751f\u6210\u4e2d...", createClient).catch(showError)
      );
      byId("copy-client-key").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(state.lastCreatedClient?.api_key, "API Key \u5df2\u590d\u5236")
        ).catch(showError)
      );
      byId("copy-client-json").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(byId("client-output-text").textContent, "JSON \u5df2\u590d\u5236")
        ).catch(showError)
      );
      byId("copy-gateway-url").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u590d\u5236\u4e2d...", () =>
          copyText(state.gateway?.base_url, "Gateway URL \u5df2\u590d\u5236")
        ).catch(showError)
      );

      byId("refresh-logs").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5237\u65b0\u4e2d...", loadLogs).catch(showError)
      );

      // ponytail: parallel boot — config + clients fetch together
      var hero = document.querySelector('.hero');
      var bootSpan = document.createElement('span');
      bootSpan.className = 'note';
      bootSpan.textContent = ' 加载中...';
      if (hero) hero.querySelector('h1')?.appendChild(bootSpan);
      await Promise.all([loadConfig(), loadClients()]);
      if (bootSpan.parentNode) bootSpan.remove();
      loadRuntimeStatus().catch(function(){});
      loadStats().catch(function(){}); // ponytail: don't block boot on stats
      loadLogs().catch(function(){});  // don't block on logs either
      // ponytail: only auto-refresh when stats panel is visible (save KV reads)
      var statsPanel = byId("stats-panel");
      var logPanel = byId("log-panel");
      setInterval(function() {
        var statsVisible = !statsPanel || statsPanel.offsetParent !== null;
        var logVisible = !logPanel || logPanel.offsetParent !== null;
        if (statsVisible) loadStats().catch(function(){});
        if (logVisible) loadLogs().catch(function(){});
      }, 120000); // ponytail: 2min auto-refresh to save KV quota
      setInterval(function() { loadRuntimeStatus().catch(function(){}); }, 5000);


    } catch (error) {
      showError(error);
      // ponytail: visible fallback so user sees something is wrong
      var hero = document.querySelector('.hero');
      if (hero) {
        var banner = document.createElement('div');
        banner.style.cssText = 'margin-top:12px;padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;color:#991b1b;font-size:13px';
        banner.textContent = '[Boot Error] ' + (error.message || 'Unknown') + ' — check browser console (F12)';
        hero.appendChild(banner);
      }
    }
  }

  boot();
</script>
</body>
</html>`;
}

