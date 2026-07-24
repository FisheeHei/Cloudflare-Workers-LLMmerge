import { renderAdminPage } from "./admin-page.js";
import { PRESET_TEMPLATES, inferPresetId, presetById } from "./presets.js";
import { isGlmModel, isMiniMaxM3Model, isNvidiaNimUpstream, sanitizeProxyBody } from "./provider-bridges.js";

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
  "access-control-allow-headers": "authorization,content-type,x-admin-token,x-api-key,anthropic-version,anthropic-beta,session-id,thread-id,turn-id,x-turn-id,x-client-request-id,x-session-id,x-conversation-id,x-codex-turn-metadata",
  "access-control-max-age": "3600",
};

const RETRYABLE_STATUSES = new Set([402, 408, 409, 425, 429, 500, 502, 503, 504, 524]);
const MODEL_PATH = "/v1/models";
const CHAT_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const RESPONSES_COMPACT_PATH = "/v1/responses/compact";
const EMBEDDINGS_PATH = "/v1/embeddings";
const MESSAGES_PATH = "/v1/messages";
const GATEWAY_CONFIG_KEY = "gateway:config";
const CONFIG_SNAPSHOTS_KEY = "gateway:config:snapshots";
const CONFIG_SNAPSHOT_LIMIT = 5;
const LOG_KEY = "gateway:logs";
const STATS_PREFIX = "gateway:stats:";
const STATS_WINDOW_HOURS = 24;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 900000;
const NIM_SLOW_FIRST_BYTE_TIMEOUT_MS = 300000;
const DEFAULT_MODEL_CACHE_TTL = 3600;
const DEFAULT_COOLDOWN_TTL = 60;
const HK_TIME_ZONE = "Asia/Hong_Kong";
const HK_TIME_ZONE_LABEL = "Hong Kong Standard Time (UTC+8)";
const HK_UTC_OFFSET_MS = 8 * 3600 * 1000;
const STDTIME_URL = "https://stdtime.gov.hk/";
const STDTIME_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const NVIDIA_NIM_RPM_LIMIT = 40;
const NVIDIA_NIM_RPM_WINDOW_MS = 60000;
// Keep the SSE connection visibly active through an additional proxy layer.
const SSE_KEEPALIVE_MS = 5000;
const SSE_FINISH_GRACE_MS = 1000;
const CLOUDFLARE_MODEL_SEARCH_PER_PAGE = 100;
const CLOUDFLARE_MODEL_SEARCH_MAX_PAGES = 20;
const SUBAGENT_PROMPT = "When the task benefits from parallel investigation or isolated implementation, use subagents to perform the work.";
const COMPACTION_PROMPT = "Compress the conversation for continued agent work. Preserve user requirements, decisions, file paths, commands, errors, tool results, unresolved tasks, and current state. Do not solve the task, call tools, change models, or add commentary. Output only a concise self-contained summary.";
const ANALYTICS_LIVE_PENDING_MS = 120000;
const ANALYTICS_QUERY_CACHE_MS = 2000;
const SESSION_MODEL_LOCK_TTL_SECONDS = 7 * 24 * 3600;
const VERSION = "v26-07-24-codex-responses";
const DEFAULT_ADMIN_TOKEN = "llmmerge-admin";

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
        // ponytail: ETag-based conditional request �?CDN caches, revalidates with 304
        var inm = request.headers.get("if-none-match") || ""; if (inm.includes(VERSION)) {
          return new Response(null, { status: 304, headers: { etag: '"'+VERSION+'"', "cache-control": "public, max-age=0, must-revalidate" } });
        }
        const pageBody = renderAdminPage(url.origin, VERSION);
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
        hdrs.set("cache-control", "private, max-age=30");
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: hdrs });
      }

      if (
        (pathname === CHAT_PATH || pathname === EMBEDDINGS_PATH) &&
        request.method === "POST"
      ) {
        const traceId = requestTraceId(request);
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
        const model = await resolveAuthorizedClientModel(client, runtime, requestedModel, request, payload);
        const publicModel = publicModelId(client, runtime, requestedModel, model);
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
          recordRequestLog(app, makeRequestLogEntry({
            client,
            upstream: error.upstreamName || "none",
            model,
            path: pathname,
            status: error.statusCode || 502,
            started,
            promptTokens: pt,
            completionTokens: 0,
            extra: { trace_id: traceId, tools_count: requestToolsCount(payload) },
          }), ctx);
          return gatewayErrorResponse(error, traceId);
        }

        const upstreamResp = proxyResponse.response;
        const headers = proxyResponseHeaders(upstreamResp, proxyResponse, client, traceId);

        return await buildLoggedProxyResponse({
          app,
          bodyText: proxyBodyText,
          client,
          ctx,
          headers,
          model,
          responseModel: publicModel,
          pathname,
          requestPayload: payload,
          proxyResponse,
          started,
          traceId,
          upstreamResp,
        });
      }

      if (pathname === RESPONSES_PATH && request.method === "POST") {
        return await handleResponsesRequest(request, url, app, ctx, requestTraceId(request));
      }

      if (pathname === RESPONSES_COMPACT_PATH && request.method === "POST") {
        return await handleResponsesCompactRequest(request, url, app, ctx, requestTraceId(request));
      }

      if (pathname === MESSAGES_PATH && request.method === "POST") {
        const traceId = requestTraceId(request);
        try {
          return await handleAnthropicMessagesRequest(request, url, app, ctx, traceId);
        } catch (error) {
          return anthropicGatewayErrorResponse(error, traceId);
        }
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
var _upstreamCooldowns = {};
// ponytail: per-isolate and per-model; DO if strict global rotation ever matters
var _lastSuccessfulUpstreamName = {};
var _activeUpstreams = {};
// ponytail: per-isolate NIM RPM window starts on first request; KV not worth it for provider-side soft guard
var _nimMinuteCounters = {};
// ponytail: short runtime cache saves KV + decrypt on hot path; config save invalidates it
var _runtimeCache = null;
var _runtimeCacheTs = 0;
var RUNTIME_CACHE_TTL_MS = 30000;
var _runtimeLoading = null;
var _stdTimeOffsetMs = 0;
var _stdTimeSyncedAt = 0;
var _stdTimeSyncing = null;
var _analyticsQueryCache = {};
// ponytail: model state is isolate-local; Goal turns must not create KV reads/writes.
var _sessionModelLocks = {};
var _sessionCurrentModels = {};

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
    analytics: env.ANALYTICS || env.LLM_ANALYTICS || env.LLM_GATEWAY_ANALYTICS || null,
    analyticsAccountId: String(env.ANALYTICS_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    analyticsApiToken: String(env.ANALYTICS_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim(),
    analyticsDataset: String(env.ANALYTICS_DATASET || "llmmerge_requests").trim(),
    defaultCooldownTtl: parsePositiveInt(env.UPSTREAM_COOLDOWN_TTL, DEFAULT_COOLDOWN_TTL),
    defaultModelCacheTtl: parsePositiveInt(env.MODEL_CACHE_TTL, DEFAULT_MODEL_CACHE_TTL),
    defaultStreamIdleTimeoutMs: parsePositiveInt(env.STREAM_IDLE_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS),
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
var _flushPromise = null;

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
  recordAnalyticsPoint(app, entry, ctx);
  if (!hasAnalyticsEngine(app)) scheduleLogFlush(app, ctx);
}

function hasAnalyticsEngine(app) {
  return app?.analytics && typeof app.analytics.writeDataPoint === "function";
}

function recordAnalyticsPoint(app, entry, ctx) {
  if (!hasAnalyticsEngine(app)) return;
  const task = Promise.resolve().then(() => app.analytics.writeDataPoint({
    blobs: [
      entry.ts || "",
      entry.client || "",
      entry.upstream || "",
      entry.model || "",
      entry.path || "",
      String(entry.status || ""),
      String(entry.tools_count || 0),
      entry.trace_id || "",
      entry.close_reason || "",
      entry.finish_reason || "",
    ],
    doubles: [
      Number(entry.status || 0),
      Number(entry.latency_ms || 0),
      Number(entry.prompt_tokens || 0),
      Number(entry.completion_tokens || 0),
      Number(entry.time_to_first_byte_ms || 0),
      Number(entry.time_to_first_token_ms || 0),
      Number(entry.max_stream_gap_ms || 0),
      entry.status >= 200 && entry.status < 400 ? 1 : 0,
      Number(entry.tool_calls_count || 0),
    ],
    indexes: [entry.client || "client"],
  })).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
}

function makeRequestLogEntry({ client, completionTokens, extra = {}, model, path, promptTokens, started, status, upstream }) {
  return {
    ts: hkNowIso(),
    client: client?.name || client?.id || "client",
    upstream: upstream || "unknown",
    model,
    path,
    status: status || 200,
    latency_ms: Date.now() - started,
    prompt_tokens: promptTokens || 0,
    completion_tokens: completionTokens || 0,
    ...extra,
  };
}

function scheduleLogFlush(app, ctx) {
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(flushBatch(app));
  } else {
    flushBatch(app);
  }
}

async function flushBatch(app, force = false) {
  if (!app.kv) return;
  // ponytail: AE handles stats+log persistence, skip KV writes entirely
  if (hasAnalyticsEngine(app)) return;
  var now = Date.now();
  if (!force && now - _lastFlush < FLUSH_INTERVAL_MS && _pendingLogs.length < FLUSH_PENDING_LIMIT) return;
  if (_flushPromise) return _flushPromise;
  _lastFlush = now;
  _flushPromise = _doFlush(app).catch(() => {}).finally(() => { _flushPromise = null; });
  return _flushPromise;
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

async function getBestLogs(app) {
  const analyticsLogs = await getAnalyticsLogs(app).catch(() => null);
  if (analyticsLogs) return mergeRecentLogs(analyticsLogs, recentPendingLogs());
  return await getMergedLogs(app);
}

function recentPendingLogs(maxAgeMs = ANALYTICS_LIVE_PENDING_MS) {
  const cutoff = Date.now() - maxAgeMs;
  return _pendingLogs.filter((entry) => Date.parse(entry.ts || "") >= cutoff).slice(-50).reverse();
}

function mergeRecentLogs(persisted, recent) {
  const seen = new Set();
  return [...(recent || []), ...(persisted || [])]
    .sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))
    .filter((entry) => {
      const key = entry.trace_id || [entry.ts, entry.client, entry.upstream, entry.model, entry.status].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

function recentPendingStats(maxAgeMs = ANALYTICS_LIVE_PENDING_MS) {
  const buckets = {};
  for (const entry of _pendingLogs) {
    if (Date.parse(entry.ts || "") < Date.now() - maxAgeMs) continue;
    const hour = hkHourKey(entry.ts);
    if (!buckets[hour]) buckets[hour] = emptyStatsBucket();
    addStatsEntry(buckets[hour], entry);
  }
  return buckets;
}

function canQueryAnalytics(app) {
  return Boolean(app?.analyticsAccountId && app?.analyticsApiToken && /^[A-Za-z0-9_]+$/.test(app?.analyticsDataset || ""));
}

async function queryAnalyticsEngine(app, sql) {
  if (!canQueryAnalytics(app)) return null;
  const cacheKey = app.analyticsAccountId + ":" + app.analyticsDataset + ":" + sql;
  const cached = _analyticsQueryCache[cacheKey];
  const now = Date.now();
  if (cached && now - cached.ts < ANALYTICS_QUERY_CACHE_MS) return cached.data;
  const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${app.analyticsAccountId}/analytics_engine/sql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${app.analyticsApiToken}`,
      "content-type": "text/plain; charset=utf-8",
    },
    body: sql,
  });
  if (!resp.ok) return null;
  const payload = await resp.json();
  const data = Array.isArray(payload) ? payload : (Array.isArray(payload.data) ? payload.data : []);
  _analyticsQueryCache[cacheKey] = { ts: now, data };
  return data;
}

async function getAnalyticsLogs(app) {
  const rows = await queryAnalyticsEngine(app, `
SELECT
  timestamp,
  blob2 AS client,
  blob3 AS upstream,
  blob4 AS model,
  blob5 AS path,
  double1 AS status,
  double2 AS latency_ms,
  double3 AS prompt_tokens,
  double4 AS completion_tokens,
  double5 AS time_to_first_byte_ms,
  double6 AS time_to_first_token_ms,
  double7 AS max_stream_gap_ms,
  blob7 AS raw_blob7,
  blob8 AS raw_blob8,
  blob9 AS raw_blob9,
  blob10 AS finish_reason,
  double9 AS tool_calls_count
FROM ${app.analyticsDataset}
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
ORDER BY timestamp DESC
LIMIT 50
`);
  if (!rows) return null;
  return rows.map((row) => {
    const hasToolBlob = isIntegerString(row.raw_blob7);
    return {
      ts: row.timestamp || row.ts || "",
      client: row.client || "",
      upstream: row.upstream || "",
      model: row.model || "",
      path: row.path || "",
      status: Number(row.status || 0),
      latency_ms: Number(row.latency_ms || 0),
      prompt_tokens: Number(row.prompt_tokens || 0),
      completion_tokens: Number(row.completion_tokens || 0),
      time_to_first_byte_ms: Number(row.time_to_first_byte_ms || 0),
      time_to_first_token_ms: Number(row.time_to_first_token_ms || 0),
      max_stream_gap_ms: Number(row.max_stream_gap_ms || 0),
      tools_count: hasToolBlob ? Number(row.raw_blob7 || 0) : 0,
      tool_calls_count: Number(row.tool_calls_count || 0),
      trace_id: hasToolBlob ? (row.raw_blob8 || "") : (row.raw_blob7 || ""),
      close_reason: hasToolBlob ? (row.raw_blob9 || "") : (row.raw_blob8 || ""),
      finish_reason: row.finish_reason || "",
    };
  });
}

async function getAnalyticsStats(app, hourKeys) {
  const rows = await queryAnalyticsEngine(app, `
SELECT
  formatDateTime(toStartOfHour(timestamp), '%Y-%m-%d:%H', 'Asia/Hong_Kong') AS hour,
  blob3 AS upstream,
  blob4 AS model,
  sum(_sample_interval) AS total,
  sum(if(double8 = 1, _sample_interval, 0)) AS success,
  sum(if(double8 = 1, 0, _sample_interval)) AS fail,
  sum(double3 * _sample_interval) AS prompt_tokens,
  sum(double4 * _sample_interval) AS completion_tokens
FROM ${app.analyticsDataset}
WHERE timestamp >= NOW() - INTERVAL '24' HOUR
GROUP BY hour, upstream, model
ORDER BY hour ASC
`);
  if (!rows) return null;
  const buckets = {};
  const wanted = new Set(hourKeys);
  for (const row of rows) {
    const hour = String(row.hour || "");
    if (!wanted.has(hour)) continue;
    const bucket = buckets[hour] || emptyStatsBucket();
    const entry = {
      upstream: row.upstream || "unknown",
      model: row.model || "unknown",
      status: Number(row.success || 0) > 0 ? 200 : 500,
      prompt_tokens: Number(row.prompt_tokens || 0),
      completion_tokens: Number(row.completion_tokens || 0),
    };
    bucket.total += Number(row.total || 0);
    bucket.success += Number(row.success || 0);
    bucket.fail += Number(row.fail || 0);
    bucket.prompt_tokens += entry.prompt_tokens;
    bucket.completion_tokens += entry.completion_tokens;
    bucket.upstreams[entry.upstream] = (bucket.upstreams[entry.upstream] || 0) + Number(row.total || 0);
    bucket.models[entry.model] = (bucket.models[entry.model] || 0) + Number(row.total || 0);
    const ms = bucket.model_statuses[entry.model] || { success: 0, fail: 0 };
    ms.success += Number(row.success || 0);
    ms.fail += Number(row.fail || 0);
    bucket.model_statuses[entry.model] = ms;
    buckets[hour] = bucket;
  }
  return buckets;
}

async function buildLoggedProxyResponse({ app, bodyText, client, ctx, headers, model, responseModel = model, pathname, requestPayload, proxyResponse, started, traceId, upstreamResp }) {
  const fallbackPrompt = Math.max(1, Math.round(bodyText.length / 4));
  const toolsCount = requestToolsCount(requestPayload);
  const log = (usage, statusOverride, extra = {}) => recordRequestLog(app, makeRequestLogEntry({
    client,
    upstream: proxyResponse.upstream.name,
    model,
    path: pathname,
    status: statusOverride || (upstreamResp.status || 502),
    started,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    extra: { trace_id: traceId, tools_count: toolsCount, ...extra },
  }), ctx);

  if (!upstreamResp.ok) {
    log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 });
    if (looksLikeHtmlResponse(upstreamResp)) {
      return upstreamBadGatewayResponse(`Upstream returned HTTP ${upstreamResp.status} HTML error page.`, headers);
    }
    return new Response(upstreamResp.body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  const contentType = upstreamResp.headers.get("content-type") || "";
  if (looksLikeHtmlResponse(upstreamResp)) {
    log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 }, 502);
    return upstreamBadGatewayResponse("Upstream returned an HTML page instead of an API response.", headers);
  }
  if (pathname === CHAT_PATH && requestPayload.stream === true && upstreamResp.body) {
    setSseHeaders(headers);
    const body = withSseKeepAlive(trackOpenAiStreamUsage(upstreamResp.body, fallbackPrompt, log, started, responseModel !== model ? responseModel : ""));
    return new Response(body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  if (contentType.includes("application/json")) {
    const textBody = await upstreamResp.text();
    const payload = safeJson(textBody);
    if (!payload || looksLikeHtmlDocument(textBody)) {
      log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 }, 502);
      return upstreamBadGatewayResponse("Upstream returned a non-JSON API response.", headers);
    }
    if (upstreamApplicationErrorMessage(payload || textBody)) {
      log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 }, 502);
      return upstreamBadGatewayResponse(upstreamApplicationErrorMessage(payload || textBody), headers);
    }
    const usage = normalizeOpenAiLogUsage(payload?.usage, fallbackPrompt, estimateOpenAiCompletionTokens(payload));
    log(usage, 0, { finish_reason: responseFinishReason(payload), tool_calls_count: responseToolCallsCount(payload) });
    payload.model = responseModel;
    return new Response(JSON.stringify(payload), { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
  }

  log({ prompt_tokens: fallbackPrompt, completion_tokens: 0 });
  return new Response(upstreamResp.body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
}

function trackOpenAiStreamUsage(body, fallbackPrompt, onDone, started = Date.now(), responseModel = "") {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const doneChunk = encoder.encode("data: [DONE]\n\n");
  let buffer = "";
  let usage = null;
  let outputText = "";
  let logged = false;
  let failureStatus = 0;
  const toolCallKeys = new Set();
  const diag = createStreamDiag(started);
  let closeReason = "done";
  let finishReason = "";
  let sawDone = false;
  const rewriteModel = Boolean(responseModel);
  const emitRewritten = (controller, now = Date.now()) => {
    let output = "";
    buffer = consumeOpenAiStreamBuffer(buffer, (chunk) => {
      noteChunk(chunk, now);
      output += `data: ${JSON.stringify({ ...chunk, model: responseModel })}\n\n`;
    }, () => {
      sawDone = true;
      output += "data: [DONE]\n\n";
    });
    if (output) controller.enqueue(encoder.encode(output));
  };
  const noteChunk = (chunk, now = Date.now()) => {
    if (upstreamApplicationErrorMessage(chunk)) failureStatus = 502;
    usage = chunk.usage || usage;
    finishReason = responseFinishReason(chunk) || finishReason;
    noteStreamToolCalls(chunk, toolCallKeys);
    const delta = chatContentToText((chunk.choices || [])[0]?.delta?.content || "");
    if (delta) noteStreamToken(diag, now);
    outputText += delta;
  };
  const finish = () => {
    if (logged) return;
    logged = true;
    onDone(normalizeOpenAiLogUsage(usage, fallbackPrompt, estimateTokens(outputText)), failureStatus || 0, {
      close_reason: closeReason,
      finish_reason: finishReason,
      tool_calls_count: toolCallKeys.size,
      ...streamDiagExtra(diag),
    });
  };

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        for (;;) {
          const result = shouldApplyToolFinishGrace(finishReason) && !sawDone
            ? await Promise.race([
              reader.read(),
              sleep(SSE_FINISH_GRACE_MS).then(() => ({ finishGrace: true })),
            ])
            : await reader.read();
          if (result.finishGrace) {
            closeReason = "finish_grace";
            Promise.resolve(reader.cancel("finish grace elapsed")).catch(() => {});
            controller.enqueue(doneChunk);
            sawDone = true;
            break;
          }
          const { done, value } = result;
          if (done) break;
          const now = Date.now();
          noteStreamByte(diag, now);
          buffer += decoder.decode(value, { stream: true });
          if (rewriteModel) {
            emitRewritten(controller, now);
          } else {
            buffer = consumeOpenAiStreamBuffer(buffer, (chunk) => noteChunk(chunk, now), () => { sawDone = true; });
            controller.enqueue(value);
          }
          if (sawDone) break;
        }
        if (buffer) {
          buffer += "\n\n";
          if (rewriteModel) emitRewritten(controller);
          else consumeOpenAiStreamBuffer(buffer, (chunk) => noteChunk(chunk), () => { sawDone = true; });
        }
        finish();
        controller.close();
      } catch (error) {
        closeReason = "error";
        finish();
        controller.error(error);
      }
    },
  });
}

export function withSseKeepAlive(body, intervalMs = SSE_KEEPALIVE_MS) {
  if (!body) return body;
  const encoder = new TextEncoder();
  const ping = encoder.encode(": keepalive\n\n");
  const done = encoder.encode(": stream closed\n\ndata: [DONE]\n\n");
  const interval = Math.max(1, Number(intervalMs) || SSE_KEEPALIVE_MS);
  let reader = null;
  let timer = null;
  let closed = false;
  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
  const safeEnqueue = (controller, chunk) => {
    if (closed) return false;
    try {
      controller.enqueue(chunk);
      return true;
    } catch {
      cleanup();
      return false;
    }
  };
  const safeClose = (controller) => {
    cleanup();
    try { controller.close(); } catch {}
  };
  return new ReadableStream({
    async start(controller) {
      reader = body.getReader();
      timer = setInterval(() => {
        if (!closed && controller.desiredSize > 0) safeEnqueue(controller, ping);
      }, interval);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!safeEnqueue(controller, value)) {
            try { await reader.cancel("client closed"); } catch {}
            return;
          }
        }
        if (!closed) {
          safeClose(controller);
        }
      } catch (error) {
        if (!closed) {
          if (safeEnqueue(controller, done)) safeClose(controller);
        }
      }
    },
    async cancel(reason) {
      cleanup();
      try { await reader?.cancel(reason); } catch {}
    },
  });
}

function streamPendingAnthropicResponse(open) {
  const encoder = new TextEncoder();
  // ponytail: padded SSE crosses buffering proxies that otherwise hold tiny first chunks.
  const ping = encoder.encode(`: ${" ".repeat(2048)}\nevent: ping\ndata: {"type":"ping"}\n\n`);
  let reader = null;
  let timer = null;
  let closed = false;
  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
  return new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          cleanup();
          return false;
        }
      };
      send(ping);
      timer = setInterval(() => { if (controller.desiredSize > 0) send(ping); }, SSE_KEEPALIVE_MS);
      (async () => {
        try {
          const body = await open();
          reader = body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!send(value)) {
              try { await reader.cancel("client closed"); } catch {}
              return;
            }
          }
        } catch (error) {
          const status = error.statusCode || 502;
          const payload = { type: "error", error: { type: anthropicErrorType(status), message: error.message || "Upstream request failed." } };
          send(encoder.encode(`event: error\ndata: ${JSON.stringify(payload)}\n\n`));
        } finally {
          cleanup();
          try { controller.close(); } catch {}
        }
      })();
    },
    async cancel(reason) {
      cleanup();
      try { await reader?.cancel(reason); } catch {}
    },
  });
}

function consumeOpenAiStreamBuffer(text, onChunk, onDone = null) {
  const blocks = text.split(/\r?\n\r?\n/);
  const rest = blocks.pop() || "";
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data) continue;
    if (data === "[DONE]") {
      if (onDone) onDone();
      continue;
    }
    const chunk = safeJson(data);
    if (chunk) onChunk(chunk);
  }
  return rest;
}

function createStreamDiag(started = Date.now()) {
  return { firstByteMs: 0, firstTokenMs: 0, lastChunkAt: started, maxStreamGapMs: 0, started };
}

function noteStreamByte(diag, now = Date.now()) {
  if (!diag.firstByteMs) diag.firstByteMs = now - diag.started;
  diag.maxStreamGapMs = Math.max(diag.maxStreamGapMs, now - diag.lastChunkAt);
  diag.lastChunkAt = now;
}

function noteStreamToken(diag, now = Date.now()) {
  if (!diag.firstTokenMs) diag.firstTokenMs = now - diag.started;
}

function streamDiagExtra(diag) {
  return {
    max_stream_gap_ms: diag.maxStreamGapMs,
    time_to_first_byte_ms: diag.firstByteMs,
    time_to_first_token_ms: diag.firstTokenMs,
  };
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

function isIntegerString(value) {
  return /^\d+$/.test(String(value || ""));
}

function requestToolsCount(payload) {
  if (!payload || typeof payload !== "object") return 0;
  return (Array.isArray(payload.tools) ? payload.tools.length : 0) + (Array.isArray(payload.functions) ? payload.functions.length : 0);
}

function responseToolCallsCount(payload) {
  return (payload?.choices || []).reduce((count, choice) => count + (Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls.length : 0), 0);
}

function responseFinishReason(payload) {
  const reasons = new Set();
  for (const choice of (payload?.choices || [])) {
    if (choice?.finish_reason) reasons.add(String(choice.finish_reason));
  }
  return [...reasons].join(",");
}

function shouldApplyToolFinishGrace(finishReason) {
  return String(finishReason || "").split(",").includes("tool_calls");
}

function noteStreamToolCalls(chunk, seen) {
  const calls = (chunk?.choices || []).flatMap((choice) => Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : []);
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index] || {};
    seen.add(String(call.id ?? call.index ?? index));
  }
}

async function handleAdminApi(request, url, pathname, app, adminBasePath) {
  if (!app.kv) {
    throw badConfig("A KV binding named `KV` is required for the admin page.");
  }

  const apiPath = pathname.slice(adminBasePath.length);

  if (apiPath === "/api/config" && request.method === "GET") {
    return adminConfigResponse(url, app);
  }

  if (apiPath === "/api/config" && request.method === "PUT") {
    return saveAdminConfig(request, app);
  }

  if (apiPath === "/api/config/snapshots" && request.method === "GET") {
    const snapshots = await listConfigSnapshots(app.kv);
    return withCorsResponse(json({ ok: true, snapshots: snapshots.map(publicConfigSnapshot) }, 200));
  }

  const snapshotRestoreMatch = apiPath.match(/^\/api\/config\/snapshots\/([^/]+)\/restore$/);
  if (snapshotRestoreMatch && request.method === "POST") {
    return restoreConfigSnapshot(app, decodeURIComponent(snapshotRestoreMatch[1]));
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
  if (clientMatch && request.method === "PUT") {
    const id = decodeURIComponent(clientMatch[1]);
    const existing = await app.kv.get(clientIdKey(id), "json");
    if (!existing?.key) throw httpError(404, "Client not found.");
    const payload = parseJsonBody(await request.text());
    const record = buildClientRecord({
      ...existing,
      ...payload,
      id: existing.id,
      key: existing.key,
      created_at: existing.created_at,
    });
    await saveClientRecord(app.kv, record);
    return withCorsResponse(json({ ok: true, client: publicClientRecord(record) }, 200));
  }

  if (clientMatch && request.method === "DELETE") {
    const id = decodeURIComponent(clientMatch[1]);
    await deleteClientRecord(app.kv, id);
    return withCorsResponse(json({ ok: true, id }, 200));
  }

  if (apiPath === "/api/logs" && request.method === "GET") {
    const logs = await getBestLogs(app);
    return withCorsResponse(json({ ok: true, logs }, 200));
  }

  // ponytail: parallel KV reads for 24h stats instead of sequential loop
  if (apiPath === "/api/stats" && request.method === "GET") {
    const now = hkNowMs();
    const hourKeys = [];
    for (let h = STATS_WINDOW_HOURS - 1; h >= 0; h -= 1) {
      hourKeys.push(hkHourKey(now - h * 3600000));
    }
    const analyticsBuckets = await getAnalyticsStats(app, hourKeys).catch(() => null);
    const useAnalyticsForStats = analyticsBuckets !== null;
    const raws = useAnalyticsForStats ? null : (app.kv ? await Promise.all(hourKeys.map((k) => app.kv.get(STATS_PREFIX + k, "json"))) : hourKeys.map(() => null));
    // Keep all isolate-local stats when AE is write-only; the two-minute merge window is only for readable AE data.
    const liveStats = useAnalyticsForStats ? recentPendingStats() : _pendingStats;
    const logs = await getBestLogs(app);
    const buckets = hourKeys.map((hour, i) => {
      const raw = analyticsBuckets ? analyticsBuckets[hour] : raws[i];
      return { hour, ...mergeStatsBucket(raw, liveStats[hour]) };
    });
    return withCorsResponse(json({ ok: true, buckets, last_model: logs[0]?.model || "", now: hkNowIso(), time_zone: HK_TIME_ZONE_LABEL }, 200));
  }

  if (apiPath === "/api/runtime" && request.method === "GET") {
    return withCorsResponse(json({ ok: true, active_upstreams: getActiveUpstreamSnapshot(), last_successful_upstream: _lastSuccessfulUpstreamName, nim_rpm: getNimRpmSnapshot() }, 200));
  }

      // ponytail: fetch model list from a saved or draft upstream for picker
  if (apiPath === "/api/fetch-models" && request.method === "POST") {
    return fetchAdminModels(request, app);
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
    return speedTestAdminUpstreams(request, app);
  }

// ponytail: detect uses single getEditableConfig call, not loadRuntimeConfig + getEditableConfig
  const detectMatch = apiPath.match(/^\/api\/upstreams\/([^/]+)\/detect$/);
  if (detectMatch && request.method === "POST") {
    return detectAdminUpstream(app, decodeURIComponent(detectMatch[1]));
  }

  return withCorsResponse(json(openAiError("Admin route not found.", "not_found_error"), 404));
}

async function adminConfigResponse(url, app) {
  const stored = await getEditableConfig(app);
  return withCorsResponse(json({
    ok: true,
    gateway: { base_url: `${url.origin}/v1` },
    presets: PRESET_TEMPLATES,
    config: toPublicGatewayConfig(stored),
  }, 200));
}

async function saveAdminConfig(request, app) {
  const payload = parseJsonBody(await request.text());
  // ponytail: merge into existing so a partial payload never wipes upstreams
  const existing = await getEditableConfig(app);
  const hasUpstreams = Object.prototype.hasOwnProperty.call(payload, "upstreams");
  const merged = {
    settings: { ...existing.settings, ...(payload.settings || {}) },
    routing: { ...existing.routing, ...(payload.routing || {}) },
    upstreams: hasUpstreams && Array.isArray(payload.upstreams) ? payload.upstreams : (existing.upstreams || []),
  };
  const normalized = await normalizeGatewayConfigPayload(merged, app);
  await saveConfigSnapshot(app.kv, existing);
  await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(normalized));
  invalidateRuntimeCache();
  return withCorsResponse(json({
    ok: true,
    message: "Configuration saved.",
    config: toPublicGatewayConfig(normalized),
  }, 200));
}

async function fetchAdminModels(request, app) {
  const payload = parseJsonBody(await request.text());
  const upstream = await resolveModelFetchUpstream(payload, app);
  if (upstream.response) return upstream.response;
  try {
    const models = await fetchUpstreamModelIds(upstream, 15000);
    return withCorsResponse(json({ ok: true, models }, 200));
  } catch (err) {
    const status = err.status && err.status < 500 ? err.status : 502;
    return withCorsResponse(json({ ok: false, status: err.status || status, error: err.message }, status));
  }
}

async function resolveModelFetchUpstream(payload, app) {
  const uName = payload.name || "";
  if (uName) {
    const runtime = await loadRuntimeConfig(app);
    const saved = runtime.upstreams.find((u) => u.name === uName);
    if (!saved) return { response: withCorsResponse(json({ ok: false, error: "Upstream not found" }, 404)) };
    return {
      ...saved,
      account_id: String(payload.account_id || saved.account_id || "").trim(),
      api_key: String(payload.api_key || payload.api_key_value || saved.api_key || "").trim(),
      base_url: String(payload.base_url || saved.base_url || "").trim(),
      headers: { ...normalizeHeaders(saved.headers), ...normalizeHeaders(payload.headers) },
      preset: String(payload.preset || saved.preset || inferPresetId(payload.base_url || saved.base_url)).trim(),
    };
  }

  const baseUrl = String(payload.base_url || "").trim();
  const apiKey = String(payload.api_key || payload.api_key_value || "").trim();
  if (!baseUrl || !apiKey) return { response: withCorsResponse(json({ ok: false, error: "Base URL and API Key are required" }, 400)) };
  return {
    name: "draft",
    account_id: String(payload.account_id || "").trim(),
    base_url: baseUrl,
    api_key: apiKey,
    headers: normalizeHeaders(payload.headers),
    preset: String(payload.preset || inferPresetId(baseUrl)).trim(),
  };
}

async function speedTestAdminUpstreams(request, app) {
  const runtime = await loadRuntimeConfig(app);
  const payload = parseJsonBody(await request.text());
  const model = String(payload.model || "").trim();
  if (!model) {
    return withCorsResponse(json(openAiError("Model is required for speed test.", "invalid_request_error"), 400));
  }
  const upstreamNames = new Set(normalizeStringArray(payload.upstreams));
  const targets = runtime.upstreams.filter((upstream) =>
    upstream.enabled !== false &&
    (!upstreamNames.size || upstreamNames.has(upstream.name)) &&
    upstreamSupportsModel(upstream, model) &&
    upstreamSupportsPath(upstream, CHAT_PATH)
  );
  if (!targets.length) {
    return withCorsResponse(json(openAiError("No enabled upstream provides this model.", "not_found_error"), 404));
  }
  const results = await Promise.all(targets.map((upstream) => speedTestUpstream(runtime, upstream, model)));
  return withCorsResponse(json({ ok: true, results }, 200));
}

async function detectAdminUpstream(app, upstreamName) {
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

async function getEditableConfig(app) {
  const stored = app.kv ? await app.kv.get(GATEWAY_CONFIG_KEY, "json") : null;
  const config = unwrapGatewayConfig(stored);
  if (config) {
    return repairStoredGatewayConfig(config, app);
  }

  return buildGatewayConfigFromEnv(app);
}

function unwrapGatewayConfig(value) {
  if (typeof value === "string") return unwrapGatewayConfig(safeJson(value));
  if (Array.isArray(value)) return { upstreams: value };
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value.upstreams)) return value;
  return unwrapGatewayConfig(value.config || value.gateway_config || value.gatewayConfig);
}

function normalizeGatewayRouting(routing = {}) {
  return {
    failover: routing.failover !== false,
    fast_routing: routing.fast_routing === true,
    hedge_enabled: routing.hedge_enabled === true,
    hedge_max: Math.max(1, Math.min(5, parsePositiveInt(routing.hedge_max, 2))),
    load_balance: routing.load_balance !== false,
  };
}

function normalizeGatewaySettings(settings = {}, app) {
  return {
    model_cache_ttl: parsePositiveInt(settings.model_cache_ttl, app.defaultModelCacheTtl),
    request_timeout_ms: parsePositiveInt(settings.request_timeout_ms, app.defaultTimeoutMs),
    stream_idle_timeout_ms: parsePositiveInt(settings.stream_idle_timeout_ms, app.defaultStreamIdleTimeoutMs),
    system_prompt: String(settings.system_prompt || ""),
    system_prompt_clients: normalizeStringArray(settings.system_prompt_clients),
    subagent_prompt_clients: normalizeStringArray(settings.subagent_prompt_clients),
    global_context: String(settings.global_context || settings.context_prompt || ""),
    global_context_clients: normalizeStringArray(settings.global_context_clients),
    context_always_clients: normalizeStringArray(settings.context_always_clients),
    context_on_demand: settings.context_on_demand === true,
    context_item_limit: Math.max(1, Math.min(5, parsePositiveInt(settings.context_item_limit, 3))),
    context_max_chars: Math.max(500, Math.min(20000, parsePositiveInt(settings.context_max_chars, 4000))),
    context_items: normalizeContextItems(settings.context_items),
    upstream_cooldown_ttl: parsePositiveInt(settings.upstream_cooldown_ttl, app.defaultCooldownTtl),
  };
}

function normalizeContextItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const keywords = normalizeStringArray(item?.keywords);
    const models = normalizeStringArray(item?.models);
    return {
      id: String(item?.id || crypto.randomUUID()),
      title: String(item?.title || `Context ${index + 1}`).trim(),
      text: String(item?.text || "").trim(),
      keywords,
      keyword_lc: keywords.map((word) => word.toLowerCase()),
      clients: normalizeStringArray(item?.clients),
      models,
      models_lc: models.map((model) => model.toLowerCase()),
      enabled: item?.enabled !== false,
      priority: Number(item?.priority || 0) || 0,
      max_chars: Math.max(200, Math.min(8000, parsePositiveInt(item?.max_chars, 1200))),
    };
  }).filter((item) => item.text).slice(0, 50);
}

function buildUpstreamConfigRecord(item, index, options) {
  const preset = options.preset;
  const defaults = presetById(preset) || presetById("custom");
  const models = options.models || normalizeStringArray(item?.models);
  const paths = normalizeStringArray(item?.paths);
  return {
    api_key_encrypted: options.apiKeyEncrypted,
    base_url: String(options.baseUrl || "").trim(),
    account_id: String(options.accountId || "").trim(),
    enabled: item?.enabled !== false,
    headers: { ...presetDefaultHeaders(preset), ...normalizeHeaders(item?.headers) },
    id: String(item?.id || crypto.randomUUID()),
    models,
    model_contexts: normalizeModelContexts(item?.model_contexts, models),
    name: String(options.name || item?.name || `upstream-${index + 1}`).trim(),
    note: String(options.note ?? item?.note ?? "").trim(),
    paths: paths.length ? paths : [...defaults.paths],
    preset,
    priority: parsePriority(item?.priority, index + 1),
    weight: parsePositiveInt(item?.weight, 1),
    capability: item?.capability || null,
  };
}

async function repairStoredGatewayConfig(config, app) {
  const settings = config.settings && typeof config.settings === "object" ? config.settings : {};
  const routing = config.routing && typeof config.routing === "object" ? config.routing : {};
  const upstreamEntries = Array.isArray(config.upstreams) ? config.upstreams : [];
  const upstreams = await Promise.all(upstreamEntries.map(async (item, index) => {
    const preset = presetById(item?.preset) ? item.preset : "custom";
    const defaults = presetById(preset) || presetById("custom");
    const accountId = String(item?.account_id || "").trim();
    const models = normalizeStringArray(item?.models);
    const apiKeyValue = String(item?.api_key_encrypted || item?.api_key_value || item?.api_key || "").trim();
    return buildUpstreamConfigRecord(item, index, {
      accountId,
      apiKeyEncrypted: apiKeyValue ? await ensureEncryptedValue(apiKeyValue, app.encryptionSecret) : "",
      baseUrl: item?.base_url || resolveBaseUrl(preset, "", defaults.base_url, accountId),
      models,
      name: String(item?.name || `upstream-${index + 1}`).trim(),
      note: String(item?.note || "").trim(),
      preset,
    });
  }));
  const validUpstreams = upstreams.filter((item) => item.name && item.base_url && item.api_key_encrypted);

  return {
    routing: normalizeGatewayRouting(routing),
    settings: normalizeGatewaySettings(settings, app),
    upstreams: validUpstreams,
    version: config.version || 1,
  };
}

async function buildGatewayConfigFromEnv(app) {
  const upstreams = [];

  for (let index = 0; index < app.envUpstreams.length; index += 1) {
    const upstream = app.envUpstreams[index];
    const presetId = String(upstream.preset || inferPresetId(upstream.base_url)).trim() || "custom";
    const plaintextKey = upstream.api_key || app.env[upstream.api_key_env] || "";
    const accountId = String(upstream.account_id || "").trim();

    const models = normalizeStringArray(upstream.models);
    upstreams.push(buildUpstreamConfigRecord(upstream, index, {
      accountId,
      apiKeyEncrypted: plaintextKey ? await ensureEncryptedValue(plaintextKey, app.encryptionSecret) : "",
      baseUrl: resolveBaseUrl(
        presetId,
        upstream.base_url,
        presetById(presetId)?.base_url,
        accountId,
      ),
      models,
      name: String(upstream.name || `upstream-${index + 1}`),
      note: String(upstream.note || upstream.name || ""),
      preset: presetId,
    }));
  }

  return {
    routing: normalizeGatewayRouting(),
    settings: normalizeGatewaySettings({
      system_prompt: String(app.env.SYSTEM_PROMPT || app.env.GLOBAL_SYSTEM_PROMPT || ""),
      global_context: String(app.env.GLOBAL_CONTEXT || app.env.GLOBAL_SYSTEM_CONTEXT || ""),
    }, app),
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

    const models = normalizeStringArray(item.models);
    upstreams.push(buildUpstreamConfigRecord(item, index, {
      accountId,
      apiKeyEncrypted: await ensureEncryptedValue(apiKeyValue, app.encryptionSecret),
      baseUrl,
      models,
      name,
      preset,
    }));
  }

  return {
    routing: normalizeGatewayRouting(routing),
    settings: normalizeGatewaySettings(settings, app),
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

async function listConfigSnapshots(kv) {
  const snapshots = await kv.get(CONFIG_SNAPSHOTS_KEY, "json");
  return Array.isArray(snapshots) ? snapshots : [];
}

function publicConfigSnapshot(snapshot) {
  return {
    id: snapshot.id,
    created_at: snapshot.created_at,
    upstream_count: snapshot.upstream_count || 0,
    client_note: snapshot.client_note || "",
  };
}

async function saveConfigSnapshot(kv, config, clientNote = "before-save") {
  if (!config || !Array.isArray(config.upstreams)) return;
  const snapshots = await listConfigSnapshots(kv);
  snapshots.unshift({
    id: `cfg_${Date.now()}_${randomString(6).toLowerCase()}`,
    created_at: hkNowIso(),
    upstream_count: config.upstreams.length,
    client_note: clientNote,
    config,
  });
  await kv.put(CONFIG_SNAPSHOTS_KEY, JSON.stringify(snapshots.slice(0, CONFIG_SNAPSHOT_LIMIT)));
}

async function restoreConfigSnapshot(app, snapshotId) {
  const snapshots = await listConfigSnapshots(app.kv);
  const snapshot = snapshots.find((item) => String(item.id || "").toLowerCase() === String(snapshotId || "").toLowerCase());
  if (!snapshot?.config) {
    return withCorsResponse(json(openAiError("Config snapshot not found.", "not_found_error"), 404));
  }
  const current = await getEditableConfig(app);
  await saveConfigSnapshot(app.kv, current, "before-restore");
  const restored = await repairStoredGatewayConfig(snapshot.config, app);
  await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(restored));
  invalidateRuntimeCache();
  return withCorsResponse(json({ ok: true, config: toPublicGatewayConfig(restored) }, 200));
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
      model_contexts: normalizeModelContexts(upstream.model_contexts, upstream.models),
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
  if (_runtimeLoading?.app === app) return _runtimeLoading.promise;

  const promise = buildRuntimeConfig(app);
  _runtimeLoading = { app, promise };
  try {
    return await promise;
  } finally {
    if (_runtimeLoading?.promise === promise) _runtimeLoading = null;
  }
}

async function buildRuntimeConfig(app) {
  const now = Date.now();
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
    streamIdleTimeoutMs: editable.settings.stream_idle_timeout_ms,
    routing: editable.routing,
    settings: editable.settings,
    upstreamCooldownTtl: editable.settings.upstream_cooldown_ttl,
    upstreams: decrypted,
  };
  runtime.routeIndex = buildRouteIndex(decrypted);
  _runtimeCache = { app, runtime };
  _runtimeCacheTs = now;
  return runtime;
}

function buildRouteIndex(upstreams) {
  const index = {};
  for (const upstream of upstreams || []) {
    for (const path of normalizeStringArray(upstream.paths)) {
      if (!index[path]) index[path] = { wildcard: [], models: {} };
      const models = configuredUpstreamModels(upstream);
      if (!models.length || models.includes("*")) {
        index[path].wildcard.push(upstream);
        continue;
      }
      for (const model of models) {
        if (!index[path].models[model]) index[path].models[model] = [];
        index[path].models[model].push(upstream);
      }
    }
  }
  return index;
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
  _runtimeLoading = null;
}

// ponytail: LRU cache per-isolate for client tokens �?saves KV read every proxy request
var _clientCache = {};
var _clientCacheTs = {};
var _clientLoading = {};
var CLIENT_CACHE_TTL_MS = 60000;

async function requireClient(request, runtime) {
  const token = getBearerToken(request);
  if (!token) {
    throw httpError(401, "Missing API key.");
  }

  // ponytail: hit in-memory cache if fresh (<60s)
  var cached = _clientCache[token];
  if (cached && (Date.now() - (_clientCacheTs[token] || 0)) < CLIENT_CACHE_TTL_MS) {
    return cached;
  }

  if (runtime.kv) {
    const load = _clientLoading[token] || (async () => runtime.kv.get(clientTokenKey(token), "json"))();
    _clientLoading[token] = load;
    let kvClient;
    try {
      kvClient = await load;
    } finally {
      if (_clientLoading[token] === load) delete _clientLoading[token];
    }
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
  const rows = modelRegistryRows(runtime)
    .filter((row) => clientAllowsUpstream(client, row.upstream.name))
    .filter((row) => clientAllowsModelSelection(client, row.alias, row.model))
    .map((row) => ({
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
  const rows = modelRegistryRows(runtime).filter((row) => clientAllowsUpstream(client, row.upstream.name));
  const hit = rows.find((row) => row.alias === value || row.model === value);
  if (hit) return hit.model;
  const fuzzy = rows.filter((row) =>
    modelsMatch(value, row.alias) || modelsMatch(value, row.model) ||
    (!value.includes("/") && modelSuffix(value).toLowerCase() === modelSuffix(row.alias).toLowerCase())
  );
  if (fuzzy.length === 1) return fuzzy[0].model;
  return value;
}

function publicModelId(client, runtime, requestedModel, resolvedModel = requestedModel) {
  const value = String(requestedModel || "").trim();
  const rows = modelRegistryRows(runtime).filter((row) => clientAllowsUpstream(client, row.upstream.name));
  const hit = rows.find((row) => row.alias === value) || rows.find((row) => row.model === resolvedModel);
  return hit?.alias || value;
}

async function resolveAuthorizedClientModel(client, runtime, requestedModel, request, payload) {
  const model = await resolveClientModelAlias(client, runtime, requestedModel);
  if (!clientAllowsModelSelection(client, requestedModel, model)) {
    throw httpError(403, `Model is not allowed for this client key: ${requestedModel}`);
  }
  await enforceSessionModelLock(client, runtime, request, payload, model);
  rememberSessionCurrentModel(client, request, payload, model);
  return model;
}

async function enforceSessionModelLock(client, runtime, request, payload, model) {
  const scopeId = requestModelLockScope(request, payload);
  if (!scopeId) return;

  const cacheKey = `${client.id}\n${scopeId}`;
  const now = Date.now();
  let lock = _sessionModelLocks[cacheKey];
  if (lock?.expires > now) {
    if (lock.model !== model) throw httpError(403, `This session is locked to model: ${lock.model}`);
    return;
  }

  lock = { model, expires: now + SESSION_MODEL_LOCK_TTL_SECONDS * 1000 };
  _sessionModelLocks[cacheKey] = lock;
  const lockKeys = Object.keys(_sessionModelLocks);
  if (lockKeys.length > 500) delete _sessionModelLocks[lockKeys[0]];
}

function sessionCurrentModelKey(client, request, payload) {
  const scopeId = requestModelLockScope(request, payload);
  const sessionScope = scopeId.split("\nturn:")[0];
  return sessionScope ? `${client.id}\n${sessionScope}` : "";
}

function rememberSessionCurrentModel(client, request, payload, model) {
  const key = sessionCurrentModelKey(client, request, payload);
  if (!key) return;
  const previous = _sessionCurrentModels[key];
  _sessionCurrentModels[key] = {
    ...previous,
    model,
    expires: Date.now() + SESSION_MODEL_LOCK_TTL_SECONDS * 1000,
    ...(previous?.model === model ? {} : { persistedModel: "" }),
  };
  const keys = Object.keys(_sessionCurrentModels);
  if (keys.length > 500) delete _sessionCurrentModels[keys[0]];
}

async function persistSessionCurrentModel(runtime, client, request, payload, ctx) {
  const key = sessionCurrentModelKey(client, request, payload);
  const item = key && _sessionCurrentModels[key];
  if (!runtime.kv || !item?.model || item.persistedModel === item.model) return;
  item.persistedModel = item.model;
  const task = sessionCurrentModelStorageKey(key)
    .then((storageKey) => runtime.kv.put(storageKey, JSON.stringify({ model: item.model, expires: item.expires }), { expirationTtl: SESSION_MODEL_LOCK_TTL_SECONDS }))
    .catch(() => { if (_sessionCurrentModels[key]?.model === item.model) _sessionCurrentModels[key].persistedModel = ""; });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
  else await task;
}

async function currentSessionModel(client, runtime, request, payload) {
  const key = sessionCurrentModelKey(client, request, payload);
  const item = key && _sessionCurrentModels[key];
  if (item?.expires > Date.now()) return item.model;
  if (key) delete _sessionCurrentModels[key];
  if (!key || !runtime.kv) return "";
  try {
    const stored = await runtime.kv.get(await sessionCurrentModelStorageKey(key), "json");
    if (stored?.model && stored.expires > Date.now()) {
      _sessionCurrentModels[key] = { ...stored, persistedModel: stored.model };
      return stored.model;
    }
  } catch {}
  return "";
}

async function sessionCurrentModelStorageKey(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return "session:current-model:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestModelLockScope(request, payload) {
  const metadata = safeJson(request?.headers.get("x-codex-turn-metadata") || "") || {};
  const bodyMetadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const session = request?.headers.get("session-id") || request?.headers.get("x-session-id") ||
    metadata.session_id || bodyMetadata.session_id || request?.headers.get("thread-id") ||
    request?.headers.get("x-client-request-id") || request?.headers.get("x-conversation-id") ||
    metadata.thread_id || bodyMetadata.thread_id || bodyMetadata.conversation_id;
  const turn = request?.headers.get("turn-id") || request?.headers.get("x-turn-id") ||
    metadata.turn_id || bodyMetadata.turn_id;
  const sessionId = String(session || "").trim();
  const turnId = String(turn || "").trim();
  if (turnId && turnId.length <= 256) return `${sessionId.slice(0, 256)}\nturn:${turnId}`;
  return sessionId && sessionId.length <= 256 ? sessionId : "";
}

function routeModelRows(runtime) {
  if (runtime._routeModelRows) return runtime._routeModelRows;
  runtime._routeModelRows = runtime.upstreams.flatMap((upstream) =>
    configuredUpstreamModels(upstream)
      .filter((model) => model && model !== "*")
      .map((model) => ({ model, upstream }))
  );
  return runtime._routeModelRows;
}

function modelRegistryRows(runtime) {
  if (runtime._modelRegistryRows) return runtime._modelRegistryRows;
  runtime._modelRegistryRows = aliasRowsForModels(routeModelRows(runtime));
  return runtime._modelRegistryRows;
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

function isKimiModel(model) {
  return /(^|[\/_.-])kimi([\/_.-]|$)/i.test(String(model || ""));
}

function isLooseAliasModel(model) {
  return isQwenModel(model) || /(^|[\/_.-])glm([\/_.-]|$)/i.test(String(model || ""));
}

function modelsMatch(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!isLooseAliasModel(a) && !isLooseAliasModel(b)) return false;
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
    const model = configuredUpstreamModels(upstream).find((item) => item && item !== "*");
    if (!resp.ok && model && ![401, 403, 429].includes(resp.status)) {
      try { await resp.body?.cancel("falling back to model probe"); } catch {}
      if (!takeNimMinuteSlot(upstream)) {
        return { name: upstream.name, ok: false, status: 429, error: "NVIDIA NIM RPM limit reached", latency_ms: Date.now() - started };
      }
      const body = sanitizeProxyBody(JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }), upstream);
      resp = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, CHAT_PATH, ""),
        {
          method: "POST",
          headers: buildUpstreamHeaders(null, upstream),
          body,
        },
        timeoutMs,
      );
    }
    const error = resp.ok ? "" : await responseErrorMessage(resp);
    try { await resp.body?.cancel("health check complete"); } catch {}
    return { name: upstream.name, ok: resp.ok, status: resp.status, ...(error ? { error } : {}), latency_ms: Date.now() - started };
  } catch (err) {
    return { name: upstream.name, ok: false, status: err.status || 0, error: err.message, latency_ms: Date.now() - started };
  }
}

async function speedTestUpstream(runtime, upstream, model) {
  const started = Date.now();
  if (!takeNimMinuteSlot(upstream)) {
    return { name: upstream.name, ok: false, status: 429, error: "NVIDIA NIM RPM limit reached", latency_ms: 0 };
  }
  let resp = null;
  let release = null;
  try {
    const bodyText = JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 8, stream: true });
    const probeRequest = new Request("https://llmmerge.local/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream, application/json" },
      body: bodyText,
    });
    const result = await fetchProxyUpstream({ bodyText, pathname: CHAT_PATH, request: probeRequest, runtime, search: "", upstream });
    release = result.release;
    resp = result.response;
    if (!resp.ok) {
      const error = await responseErrorMessage(resp);
      return { name: upstream.name, ok: false, status: resp.status, ...(error ? { error } : {}), latency_ms: Date.now() - started };
    }

    const streaming = (resp.headers.get("content-type") || "").includes("text/event-stream");
    if (streaming) {
      const primed = await primeSseResponse(resp);
      resp = primed.response;
      const latency = Date.now() - started;
      if (primed.error) return { name: upstream.name, ok: false, status: 502, error: primed.error, latency_ms: latency };
      rememberUpstreamLatency(upstream, model, latency);
      return { name: upstream.name, ok: true, status: 200, latency_ms: latency, metric: "first_output" };
    }

    const text = await resp.text();
    const payload = safeJson(text);
    const error = upstreamApplicationErrorMessage(payload || text);
    const valid = payload && Array.isArray(payload.choices) && payload.choices.length > 0 && !looksLikeHtmlDocument(text) && !error;
    const latency = Date.now() - started;
    if (!valid) return { name: upstream.name, ok: false, status: 502, error: error || "Upstream returned no valid model output.", latency_ms: latency };
    rememberUpstreamLatency(upstream, model, latency);
    return { name: upstream.name, ok: true, status: 200, latency_ms: latency, metric: "complete" };
  } catch (err) {
    return { name: upstream.name, ok: false, status: err.status || 0, error: err.message, latency_ms: Date.now() - started };
  } finally {
    try { await resp?.body?.cancel("speed test complete"); } catch {}
    release?.();
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

async function handleAnthropicMessagesRequest(request, url, app, ctx, traceId) {
  const started = Date.now();
  const runtime = await loadRuntimeConfig(app);
  const client = await requireClient(request, runtime);
  const payload = parseJsonBody(await request.text());
  const translated = translateAnthropicMessagesRequest(payload);
  await resolveTranslatedRequestModel(client, runtime, translated, request, payload);

  if (translated.stream) {
    const headers = new Headers(CORS_HEADERS);
    setSseHeaders(headers);
    headers.set("x-llm-gateway-client", client.name || client.id || "client");
    headers.set("x-llm-gateway-trace-id", traceId);
    const body = streamPendingAnthropicResponse(async () => {
      let logged = false;
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
        if (!upstreamResp.ok) {
          const text = await upstreamResp.text().catch(() => "");
          const payload = safeJson(text);
          const message = upstreamApplicationErrorMessage(payload || text) || payload?.error?.message || payload?.message || text || `Upstream returned HTTP ${upstreamResp.status}.`;
          recordAnthropicLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated, null, ctx, traceId);
          logged = true;
          const error = httpError(upstreamResp.status || 502, looksLikeHtmlDocument(text) ? `Upstream returned HTTP ${upstreamResp.status} HTML error page.` : message);
          error.upstreamName = proxyResponse.upstream.name;
          throw error;
        }
        const onDone = (usage, extra) => recordAnthropicLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated, usage, ctx, traceId, extra);
        return streamAnthropicMessagesFromChat(upstreamResp, translated.seed, onDone, started);
      } catch (error) {
        if (!logged) {
          recordRequestLog(app, makeRequestLogEntry({
            client,
            upstream: error.upstreamName || "none",
            model: translated.model,
            path: MESSAGES_PATH,
            status: error.statusCode || 502,
            started,
            promptTokens: Math.max(1, Math.round(translated.bodyText.length / 4)),
            completionTokens: 0,
            extra: { trace_id: traceId, tools_count: translated.toolsCount },
          }), ctx);
        }
        throw error;
      }
    });
    return new Response(body, { status: 200, headers });
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
    const headers = proxyResponseHeaders(upstreamResp, proxyResponse, client, traceId);

    if (!upstreamResp.ok) {
      recordAnthropicLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated, null, ctx, traceId);
      return await anthropicUpstreamErrorResponse(upstreamResp, headers);
    }

    const openaiText = await upstreamResp.text();
    const openaiPayload = safeJson(openaiText);
    if (!openaiPayload || looksLikeHtmlDocument(openaiText) || upstreamApplicationErrorMessage(openaiPayload)) {
      recordAnthropicLog(app, client, proxyResponse.upstream.name, translated.model, started, 502, translated, null, ctx, traceId);
      return anthropicErrorResponse(upstreamApplicationErrorMessage(openaiPayload) || "Upstream returned an invalid response.", 502, headers);
    }

    const responsePayload = openAiChatToAnthropicMessage(openaiPayload, translated.seed);
    headers.set("content-type", "application/json; charset=utf-8");
    recordAnthropicLog(app, client, proxyResponse.upstream.name, translated.model, started, 200, translated, responsePayload.usage, ctx, traceId, {
      finish_reason: responseFinishReason(openaiPayload),
      tool_calls_count: responseToolCallsCount(openaiPayload),
    });
    return new Response(JSON.stringify(responsePayload), { status: 200, headers });
  } catch (error) {
    recordRequestLog(app, makeRequestLogEntry({
      client,
      upstream: error.upstreamName || "none",
      model: translated.model,
      path: MESSAGES_PATH,
      status: error.statusCode || 502,
      started,
      promptTokens: Math.max(1, Math.round(translated.bodyText.length / 4)),
      completionTokens: 0,
      extra: { trace_id: traceId, tools_count: translated.toolsCount },
    }), ctx);
    return anthropicGatewayErrorResponse(error, traceId);
  }
}

async function resolveTranslatedRequestModel(client, runtime, translated, request, payload) {
  const requestedModel = translated.model;
  const resolvedModel = await resolveAuthorizedClientModel(client, runtime, requestedModel, request, payload);
  translated.seed.model = publicModelId(client, runtime, requestedModel, resolvedModel);
  translated.model = resolvedModel;
  if (resolvedModel !== requestedModel) {
    translated.bodyText = JSON.stringify({ ...parseJsonBody(translated.bodyText), model: resolvedModel });
  }
}

function translateAnthropicMessagesRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Request body must be a JSON object.");
  }
  const model = String(payload.model || "").trim();
  if (!model) {
    throw httpError(400, "`model` is required.");
  }
  const messages = anthropicMessagesToOpenAiMessages(payload.system, payload.messages);
  if (!messages.length) {
    throw httpError(400, "`messages` is required.");
  }

  const chat = { model, messages, stream: payload.stream === true };
  copyIfPresent(payload, chat, ["temperature", "top_p", "thinking", "reasoning", "reasoning_effort", "reasoningEffort", "reasoningSummary", "providerOptions", "provider_options"]);
  if (isProvidedValue(payload.max_tokens)) chat.max_tokens = payload.max_tokens;
  if (isProvidedValue(payload.stop_sequences)) chat.stop = payload.stop_sequences;
  if (isProvidedValue(payload.metadata?.user_id)) chat.user = String(payload.metadata.user_id);
  const tools = anthropicToolsToOpenAiTools(payload.tools);
  if (tools.length) chat.tools = tools;
  const toolChoice = anthropicToolChoiceToOpenAi(payload.tool_choice);
  if (toolChoice != null) chat.tool_choice = toolChoice;

  return {
    bodyText: JSON.stringify(chat),
    model,
    stream: chat.stream,
    toolsCount: Array.isArray(payload.tools) ? payload.tools.length : 0,
    seed: {
      id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      createdAt: Math.floor(hkNowMs() / 1000),
      model,
    },
  };
}

function anthropicMessagesToOpenAiMessages(system, messages) {
  const out = [];
  const systemText = anthropicBlocksToText(system);
  if (systemText) out.push({ role: "system", content: systemText });
  const rows = Array.isArray(messages) ? messages : [];
  for (const msg of rows) out.push(...anthropicMessageToOpenAiMessages(msg));
  return out.filter((msg) => msg && (msg.tool_call_id || msg.tool_calls?.length || msg.content !== ""));
}

function anthropicMessageToOpenAiMessages(msg) {
  if (!msg || typeof msg !== "object") return [];
  const role = String(msg.role || "user") === "assistant" ? "assistant" : "user";
  if (typeof msg.content === "string") return [{ role, content: msg.content }];
  if (!Array.isArray(msg.content)) return [];
  return role === "assistant"
    ? anthropicAssistantBlocksToOpenAiMessages(msg.content)
    : anthropicUserBlocksToOpenAiMessages(msg.content);
}

function anthropicAssistantBlocksToOpenAiMessages(blocks) {
  const text = [];
  const toolCalls = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "thinking" || block.type === "redacted_thinking") continue;
    if (block.type === "tool_use") {
      toolCalls.push({
        id: String(block.id || `call_${crypto.randomUUID().replace(/-/g, "")}`),
        type: "function",
        function: {
          name: String(block.name || "tool"),
          arguments: JSON.stringify(block.input && typeof block.input === "object" ? block.input : {}),
        },
      });
      continue;
    }
    const blockText = anthropicBlockToText(block);
    if (blockText) text.push(blockText);
  }
  const message = { role: "assistant", content: text.join("") };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return [message];
}

function anthropicUserBlocksToOpenAiMessages(blocks) {
  const out = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const hasMedia = pending.some((part) => typeof part === "object" && part.type !== "text");
    out.push({ role: "user", content: hasMedia ? pending : pending.map((part) => typeof part === "string" ? part : part.text || "").join("") });
    pending = [];
  };

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_result") {
      flush();
      out.push({
        role: "tool",
        tool_call_id: String(block.tool_use_id || ""),
        content: anthropicBlocksToText(block.content) || (block.is_error ? "Tool returned an error." : ""),
      });
      continue;
    }
    const part = anthropicBlockToOpenAiContentPart(block);
    if (part != null) pending.push(part);
  }
  flush();
  return out;
}

function anthropicBlockToOpenAiContentPart(block) {
  if (!block || typeof block !== "object") return null;
  if (block.type === "text") return { type: "text", text: String(block.text || "") };
  if (block.type === "image") {
    const url = anthropicImageSourceToUrl(block.source);
    return url ? { type: "image_url", image_url: { url } } : { type: "text", text: "[image omitted]" };
  }
  const text = anthropicBlockToText(block);
  return text ? { type: "text", text } : null;
}

function anthropicImageSourceToUrl(source) {
  if (!source || typeof source !== "object") return "";
  if (source.type === "url" && source.url) return String(source.url);
  if (source.type === "base64" && source.media_type && source.data) {
    return `data:${source.media_type};base64,${source.data}`;
  }
  return "";
}

function anthropicToolsToOpenAiTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: String(tool?.name || "tool"),
      description: String(tool?.description || ""),
      parameters: tool?.input_schema && typeof tool.input_schema === "object" ? tool.input_schema : { type: "object", properties: {} },
    },
  }));
}

function anthropicToolChoiceToOpenAi(choice) {
  if (!isProvidedValue(choice)) return null;
  if (typeof choice === "string") return choice === "any" ? "required" : choice;
  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "none") return "none";
  if (choice.type === "tool" && choice.name) return { type: "function", function: { name: String(choice.name) } };
  return null;
}

function openAiChatToAnthropicMessage(openaiPayload, seed) {
  const choice = (openaiPayload?.choices || [])[0] || {};
  const message = choice.message || {};
  const content = openAiMessageToAnthropicContent(message);
  return {
    id: seed.id,
    type: "message",
    role: "assistant",
    model: seed.model,
    content,
    stop_reason: openAiFinishToAnthropicStop(choice.finish_reason),
    stop_sequence: null,
    usage: normalizeAnthropicUsage(openaiPayload?.usage, content),
  };
}

function openAiMessageToAnthropicContent(message) {
  const content = [];
  const thinking = reasoningText(message?.reasoning_content ?? message?.reasoning ?? message?.thinking);
  if (thinking) content.push({ type: "thinking", thinking });
  const text = chatContentToText(message?.content || "");
  if (text) content.push({ type: "text", text });
  for (const call of (message?.tool_calls || [])) {
    content.push({
      type: "tool_use",
      id: String(call.id || `call_${crypto.randomUUID().replace(/-/g, "")}`),
      name: String(call.function?.name || call.name || "tool"),
      input: parseToolArguments(call.function?.arguments),
    });
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

function parseToolArguments(value) {
  if (value && typeof value === "object") return value;
  const parsed = safeJson(String(value || "{}"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  return {};
}

function openAiFinishToAnthropicStop(reason) {
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop" || !reason) return "end_turn";
  return String(reason);
}

function normalizeAnthropicUsage(usage, content = []) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0);
  const outputFallback = estimateTokens((content || []).map((block) => block.text || JSON.stringify(block.input || "")).join(""));
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens ?? outputFallback) || 0);
  return { input_tokens: input, output_tokens: output };
}

function anthropicBlocksToText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(anthropicBlockToText).filter(Boolean).join("");
}

function anthropicBlockToText(block) {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  if (block.type === "text") return String(block.text || "");
  if (block.type === "thinking") return String(block.thinking || "");
  if (block.text != null) return String(block.text);
  if (block.content != null) return anthropicBlocksToText(block.content);
  return "";
}

function anthropicErrorResponse(message, status = 500, headers = new Headers()) {
  const out = responseBodyHeaders(headers);
  out.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ type: "error", error: { type: anthropicErrorType(status), message: message || "Internal error." } }), {
    status,
    headers: out,
  });
}

function anthropicGatewayErrorResponse(error, traceId) {
  const headers = new Headers(CORS_HEADERS);
  if (traceId) headers.set("x-llm-gateway-trace-id", traceId);
  return anthropicErrorResponse(error?.message || "Internal error.", error?.statusCode || 500, headers);
}

async function anthropicUpstreamErrorResponse(upstreamResp, headers) {
  const text = await upstreamResp.text().catch(() => "");
  const payload = safeJson(text);
  const message = upstreamApplicationErrorMessage(payload || text) || payload?.error?.message || payload?.message || text || `Upstream returned HTTP ${upstreamResp.status}.`;
  return anthropicErrorResponse(looksLikeHtmlDocument(text) ? `Upstream returned HTTP ${upstreamResp.status} HTML error page.` : message, upstreamResp.status || 502, headers);
}

function anthropicErrorType(status) {
  if (status === 400) return "invalid_request_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 429) return "rate_limit_error";
  return "api_error";
}

function recordAnthropicLog(app, client, upstreamName, model, started, status, translated, usage, ctx, traceId, extra = {}) {
  recordRequestLog(app, makeRequestLogEntry({
    client,
    upstream: upstreamName,
    model,
    path: MESSAGES_PATH,
    status: status || 200,
    started,
    promptTokens: usage?.input_tokens || Math.max(1, Math.round(translated.bodyText.length / 4)),
    completionTokens: usage?.output_tokens || 0,
    extra: { trace_id: traceId, tools_count: translated.toolsCount || 0, ...extra },
  }), ctx);
}

async function handleResponsesRequest(request, url, app, ctx, traceId) {
  const started = Date.now();
  const runtime = await loadRuntimeConfig(app);
  const client = await requireClient(request, runtime);
  const payload = parseJsonBody(await request.text());
  const translated = translateResponsesRequest(payload);
  await resolveTranslatedRequestModel(client, runtime, translated, request, payload);
  await persistSessionCurrentModel(runtime, client, request, payload, ctx);

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
    const headers = proxyResponseHeaders(upstreamResp, proxyResponse, client, traceId);

    if (!upstreamResp.ok) {
      recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated.bodyText, null, ctx, traceId);
      return new Response(await upstreamResp.text(), { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
    }

    if (translated.stream) {
      setSseHeaders(headers);
      const onDone = (usage, extra) => recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, upstreamResp.status, translated.bodyText, usage, ctx, traceId, extra);
      return new Response(withSseKeepAlive(streamResponsesFromChat(upstreamResp, translated.seed, onDone, started)), { status: 200, headers });
    }

    const openaiText = await upstreamResp.text();
    const openaiPayload = safeJson(openaiText);
    const applicationError = upstreamApplicationErrorMessage(openaiPayload || openaiText);
    if (!openaiPayload || looksLikeHtmlDocument(openaiText) || applicationError) {
      recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, 502, translated.bodyText, null, ctx, traceId);
      return upstreamBadGatewayResponse(applicationError || "Upstream returned a non-JSON API response.", headers);
    }
    const choice = (openaiPayload.choices || [])[0] || {};
    const message = choice.message || {};
    const text = chatContentToText(message.content || "");
    const reasoning = reasoningText(message.reasoning_content ?? message.reasoning ?? message.thinking);
    const responsePayload = makeResponsesPayload(translated.seed, { text, usage: openaiPayload.usage, toolCalls: message.tool_calls || [], reasoning });
    headers.set("content-type", "application/json; charset=utf-8");
    recordResponsesLog(app, client, proxyResponse.upstream.name, translated.model, started, 200, translated.bodyText, responsePayload.usage, ctx, traceId, {
      finish_reason: responseFinishReason(openaiPayload),
      tool_calls_count: responseToolCallsCount(openaiPayload),
    });
    return new Response(JSON.stringify(responsePayload), { status: 200, headers });
  } catch (error) {
    recordRequestLog(app, makeRequestLogEntry({
      client,
      upstream: error.upstreamName || "none",
      model: translated.model,
      path: RESPONSES_PATH,
      status: error.statusCode || 502,
      started,
      promptTokens: Math.max(1, Math.round(translated.bodyText.length / 4)),
      completionTokens: 0,
      extra: { trace_id: traceId },
    }), ctx);
    return gatewayErrorResponse(error, traceId);
  }
}

async function handleResponsesCompactRequest(request, url, app, ctx, traceId) {
  const started = Date.now();
  const runtime = await loadRuntimeConfig(app);
  const client = await requireClient(request, runtime);
  const payload = parseJsonBody(await request.text());
  const requestedModel = String(payload?.model || "").trim();
  if (!requestedModel) throw httpError(400, "`model` is required.");

  const sessionModel = await currentSessionModel(client, runtime, request, payload);
  const model = sessionModel || await resolveAuthorizedClientModel(client, runtime, requestedModel, request, payload);
  if (sessionModel && !clientAllowsModelSelection(client, sessionModel, sessionModel)) {
    throw httpError(403, `Model is not allowed for this client key: ${sessionModel}`);
  }
  const transcript = compactTranscript(payload.input, payload.instructions);
  if (!transcript) throw httpError(400, "`input` is required.");

  const chat = {
    model,
    messages: [
      { role: "system", content: COMPACTION_PROMPT },
      { role: "user", content: transcript },
    ],
    max_tokens: 4096,
    stream: false,
  };
  copyIfPresent(payload, chat, ["reasoning", "reasoning_effort", "reasoningEffort", "reasoningSummary", "providerOptions", "provider_options"]);
  const bodyText = JSON.stringify(chat);
  const fallbackPrompt = Math.max(1, Math.round(bodyText.length / 4));
  let upstreamName = "none";
  const log = (status, usage, extra = {}) => recordRequestLog(app, makeRequestLogEntry({
    client,
    upstream: upstreamName,
    model,
    path: RESPONSES_COMPACT_PATH,
    status,
    started,
    promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? fallbackPrompt,
    completionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
    extra: { trace_id: traceId, ...extra },
  }), ctx);

  try {
    const proxyResponse = await proxyRequest({ client, model, pathname: CHAT_PATH, request, bodyText, runtime, search: url.search });
    upstreamName = proxyResponse.upstream.name;
    const upstreamResp = proxyResponse.response;
    const headers = proxyResponseHeaders(upstreamResp, proxyResponse, client, traceId);
    if (!upstreamResp.ok) {
      log(upstreamResp.status);
      return new Response(upstreamResp.body, { status: upstreamResp.status, statusText: upstreamResp.statusText, headers });
    }

    const text = await upstreamResp.text();
    const result = safeJson(text);
    const applicationError = upstreamApplicationErrorMessage(result || text);
    const summary = chatContentToText(result?.choices?.[0]?.message?.content || "").trim();
    if (!result || looksLikeHtmlDocument(text) || applicationError || !summary) {
      log(502);
      return upstreamBadGatewayResponse(applicationError || "Upstream returned no compaction summary.", headers);
    }

    log(200, result.usage, { finish_reason: result.choices?.[0]?.finish_reason || "stop" });
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({
      output: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Conversation summary:\n${summary}` }],
      }],
    }), { status: 200, headers });
  } catch (error) {
    upstreamName = error.upstreamName || upstreamName;
    log(error.statusCode || 502);
    return gatewayErrorResponse(error, traceId);
  }
}

function compactTranscript(input, instructions) {
  const messages = responsesInputToMessages(input, instructions);
  return messages.map((message) => {
    const toolCalls = (message.tool_calls || []).map((call) => `${call.function?.name || "tool"}(${call.function?.arguments || ""})`).join("\n");
    return `[${message.role}]\n${chatContentToText(message.content)}${toolCalls ? `\n${toolCalls}` : ""}`.trim();
  }).filter(Boolean).join("\n\n");
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
  const tools = responsesToolsToChatTools(payload.tools);
  if (tools.length) chat.tools = tools;
  const toolChoice = responsesToolChoiceToChat(payload.tool_choice);
  if (toolChoice != null) chat.tool_choice = toolChoice;

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
      reasoningId: `rs_${crypto.randomUUID().replace(/-/g, "")}`,
      temperature: payload.temperature ?? null,
      toolChoice: payload.tool_choice ?? "auto",
      tools: Array.isArray(payload.tools) ? payload.tools : [],
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
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: String(item.call_id || item.id || `call_${crypto.randomUUID().replace(/-/g, "")}`),
          type: "function",
          function: { name: String(item.name || "tool"), arguments: String(item.arguments || "{}") },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: String(item.call_id || ""), content: responsesToolOutputText(item.output) });
      continue;
    }
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

  return messages.filter((msg) => msg.tool_call_id || msg.tool_calls?.length || (msg.content !== "" && msg.content != null));
}

function responsesToolsToChatTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => tool?.function || tool).filter((tool) => tool?.name).map((tool) => ({
    type: "function",
    function: {
      name: String(tool.name),
      description: String(tool.description || ""),
      parameters: tool.parameters && typeof tool.parameters === "object" ? tool.parameters : { type: "object", properties: {} },
      ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
    },
  }));
}

function responsesToolChoiceToChat(choice) {
  if (!isProvidedValue(choice)) return null;
  if (typeof choice === "string") return choice;
  const name = choice.name || choice.function?.name;
  if (choice.type === "function" && name) return { type: "function", function: { name: String(name) } };
  return null;
}

function responsesToolOutputText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((part) => String(part?.text ?? part?.content ?? "")).join("");
  return output == null ? "" : JSON.stringify(output);
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
    if (isProvidedValue(from[key])) to[key] = from[key];
  }
}

function isProvidedValue(value) {
  return value != null && String(value) !== "[undefined]";
}

function makeResponsesPayload(seed, { text = "", usage = null, status = "completed", toolCalls = [], reasoning = "" } = {}) {
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
    output: status === "completed" ? [message, ...(reasoning ? [responsesReasoningItem(seed, reasoning)] : []), ...toolCalls.map((call) => responsesFunctionCallItem(call))] : [],
    output_text: text || "",
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: seed.temperature,
    text: { format: { type: "text" } },
    tool_choice: seed.toolChoice,
    tools: seed.tools,
    top_p: seed.topP,
    truncation: "disabled",
    usage: normalizeResponsesUsage(usage, estimateTokens([text, reasoning, ...toolCalls.map((call) => call?.function?.arguments || "")].join(""))),
    metadata: seed.metadata || {},
  };
}

function normalizeResponsesUsage(usage, fallbackOutput = 0) {
  const input = Math.max(0, Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0);
  const output = Math.max(0, Number(usage?.completion_tokens ?? usage?.output_tokens ?? fallbackOutput) || 0);
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

function responsesReasoningItem(seed, text, status = "completed") {
  return { id: seed.reasoningId, type: "reasoning", status, summary: [{ type: "summary_text", text }] };
}

function responsesFunctionCallItem(call, status = "completed") {
  return {
    id: String(call.id || `fc_${crypto.randomUUID().replace(/-/g, "")}`),
    call_id: String(call.id || ""),
    type: "function_call",
    status,
    name: String(call.function?.name || call.name || "tool"),
    arguments: String(call.function?.arguments || call.arguments || ""),
  };
}

function reasoningText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return chatContentToText(value);
  if (!value || typeof value !== "object") return "";
  return String(value.text ?? value.content ?? value.reasoning ?? value.thinking ?? value.summary ?? "");
}

function recordResponsesLog(app, client, upstreamName, model, started, status, bodyText, usage, ctx, traceId, extra = {}) {
  recordRequestLog(app, makeRequestLogEntry({
    client,
    upstream: upstreamName,
    model,
    path: RESPONSES_PATH,
    status: status || 200,
    started,
    promptTokens: usage?.input_tokens || Math.max(1, Math.round(bodyText.length / 4)),
    completionTokens: usage?.output_tokens || 0,
    extra: { trace_id: traceId, ...extra },
  }), ctx);
}

function streamAnthropicMessagesFromChat(openaiResp, seed, onDone = null, started = Date.now()) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const write = (eventName, payload) => writer.write(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`));

  (async () => {
    let buffer = "";
    let usage = null;
    let finishReason = "";
    let outputText = "";
    let sawDone = false;
    let closeReason = "done";
    let textIndex = null;
    let thinkingIndex = null;
    let nextIndex = 0;
    const toolBlocks = new Map();
    const diag = createStreamDiag(started);
    const closeText = async () => {
      if (textIndex == null) return;
      await write("content_block_stop", { type: "content_block_stop", index: textIndex });
      textIndex = null;
    };
    const closeThinking = async () => {
      if (thinkingIndex == null) return;
      await write("content_block_stop", { type: "content_block_stop", index: thinkingIndex });
      thinkingIndex = null;
    };
    const ensureThinking = async () => {
      await closeText();
      if (thinkingIndex != null) return thinkingIndex;
      thinkingIndex = nextIndex++;
      await write("content_block_start", { type: "content_block_start", index: thinkingIndex, content_block: { type: "thinking", thinking: "" } });
      return thinkingIndex;
    };
    const ensureText = async () => {
      await closeThinking();
      if (textIndex != null) return textIndex;
      textIndex = nextIndex++;
      await write("content_block_start", { type: "content_block_start", index: textIndex, content_block: { type: "text", text: "" } });
      return textIndex;
    };
    const ensureTool = async (call) => {
      await closeText();
      await closeThinking();
      const key = String(call.index ?? toolBlocks.size);
      let block = toolBlocks.get(key);
      if (block) {
        if (call.id) block.id = String(call.id);
        if (call.function?.name) block.name = String(call.function.name);
        return block;
      }
      block = {
        index: nextIndex++,
        id: String(call.id || `call_${crypto.randomUUID().replace(/-/g, "")}`),
        name: String(call.function?.name || call.name || "tool"),
        args: "",
        stopped: false,
      };
      toolBlocks.set(key, block);
      await write("content_block_start", {
        type: "content_block_start",
        index: block.index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      return block;
    };
    const stopOpenBlocks = async () => {
      await closeText();
      await closeThinking();
      for (const block of toolBlocks.values()) {
        if (block.stopped) continue;
        block.stopped = true;
        await write("content_block_stop", { type: "content_block_stop", index: block.index });
      }
    };
    const processChunk = async (chunk, now = Date.now()) => {
      const streamError = streamEventErrorMessage(chunk);
      if (streamError) throw new Error(streamError);
      usage = chunk.usage || usage;
      const choice = (chunk.choices || [])[0] || {};
      finishReason = choice.finish_reason || finishReason;
      const delta = choice.delta || {};
      const thinking = reasoningText(delta.reasoning_content ?? delta.reasoning ?? delta.thinking);
      if (thinking) {
        outputText += thinking;
        const index = await ensureThinking();
        noteStreamToken(diag, now);
        await write("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } });
      }
      const text = chatContentToText(delta.content || "");
      if (text) {
        outputText += text;
        const index = await ensureText();
        noteStreamToken(diag, now);
        await write("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } });
      }
      for (const call of (delta.tool_calls || [])) {
        const block = await ensureTool(call);
        const args = String(call.function?.arguments || "");
        if (args) {
          block.args += args;
          outputText += args;
          await write("content_block_delta", { type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: args } });
        }
      }
    };

    try {
      await write("message_start", {
        type: "message_start",
        message: { id: seed.id, type: "message", role: "assistant", model: seed.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      });
      await write("ping", { type: "ping" });

      const reader = openaiResp.body.getReader();
      for (;;) {
        const result = shouldApplyToolFinishGrace(finishReason) && !sawDone
          ? await Promise.race([
            reader.read(),
            sleep(SSE_FINISH_GRACE_MS).then(() => ({ finishGrace: true })),
          ])
          : await reader.read();
        if (result.finishGrace) {
          closeReason = "finish_grace";
          Promise.resolve(reader.cancel("finish grace elapsed")).catch(() => {});
          break;
        }
        const { done, value } = result;
        if (done) break;
        const now = Date.now();
        noteStreamByte(diag, now);
        buffer += decoder.decode(value, { stream: true });
        const writes = [];
        buffer = consumeOpenAiStreamBuffer(buffer, (chunk) => writes.push(processChunk(chunk, now)), () => { sawDone = true; });
        await Promise.all(writes);
        if (sawDone) break;
      }
      if (buffer) {
        const writes = [];
        consumeOpenAiStreamBuffer(buffer + "\n\n", (chunk) => writes.push(processChunk(chunk)), () => { sawDone = true; });
        await Promise.all(writes);
      }
      await stopOpenBlocks();
      const stopReason = openAiFinishToAnthropicStop(finishReason);
      const finalUsage = normalizeAnthropicUsage(usage, [{ text: outputText }]);
      await write("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: finalUsage.output_tokens } });
      await write("message_stop", { type: "message_stop" });
      if (onDone) onDone(finalUsage, {
        close_reason: closeReason,
        finish_reason: finishReason,
        tool_calls_count: toolBlocks.size,
        ...streamDiagExtra(diag),
      });
    } catch (error) {
      closeReason = "error";
      // Never expose a provider reset as a raw errored response body. Outer
      // Cloudflare proxies can otherwise replace the stream with HTTP 502.
      try { await stopOpenBlocks(); } catch {}
      await write("error", { type: "error", error: { type: "api_error", message: error.message || "Stream error." } });
      if (onDone) onDone(normalizeAnthropicUsage(usage, [{ text: outputText }]), {
        close_reason: closeReason,
        finish_reason: finishReason,
        tool_calls_count: toolBlocks.size,
        ...streamDiagExtra(diag),
      });
    } finally {
      await writer.close();
    }
  })();

  return readable;
}

function streamResponsesFromChat(openaiResp, seed, onDone = null, started = Date.now()) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const write = (event) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const baseMessage = { id: seed.messageId, type: "message", status: "in_progress", role: "assistant", content: [] };

  (async () => {
    let buffer = "";
    let text = "";
    let reasoning = "";
    let reasoningOutputIndex = null;
    let usage = null;
    let streamError = "";
    let finishReason = "";
    const toolCalls = new Map();
    let nextOutputIndex = 1;
    const diag = createStreamDiag(started);
    let closeReason = "done";
    const writes = [];
    const ensureReasoning = () => {
      if (reasoningOutputIndex != null) return;
      reasoningOutputIndex = nextOutputIndex++;
      writes.push(write({ type: "response.output_item.added", output_index: reasoningOutputIndex, item: responsesReasoningItem(seed, "", "in_progress") }));
      writes.push(write({ type: "response.reasoning_summary_part.added", item_id: seed.reasoningId, output_index: reasoningOutputIndex, summary_index: 0, part: { type: "summary_text", text: "" } }));
    };
    const processChunk = (chunk, now = Date.now()) => {
      streamError = streamEventErrorMessage(chunk) || streamError;
      usage = chunk.usage || usage;
      finishReason = responseFinishReason(chunk) || finishReason;
      const delta = (chunk.choices || [])[0]?.delta || {};
      const reasoningDelta = reasoningText(delta.reasoning_content ?? delta.reasoning ?? delta.thinking);
      if (reasoningDelta) {
        ensureReasoning();
        noteStreamToken(diag, now);
        reasoning += reasoningDelta;
        writes.push(write({ type: "response.reasoning_summary_text.delta", item_id: seed.reasoningId, output_index: reasoningOutputIndex, summary_index: 0, delta: reasoningDelta }));
      }
      const content = chatContentToText(delta.content || "");
      if (content) {
        noteStreamToken(diag, now);
        text += content;
        writes.push(write({ type: "response.output_text.delta", item_id: seed.messageId, output_index: 0, content_index: 0, delta: content }));
      }
      for (const call of (delta.tool_calls || [])) {
        const key = String(call.index ?? toolCalls.size);
        let item = toolCalls.get(key);
        if (!item) {
          item = { id: String(call.id || `call_${crypto.randomUUID().replace(/-/g, "")}`), name: String(call.function?.name || call.name || "tool"), arguments: "", outputIndex: nextOutputIndex++ };
          toolCalls.set(key, item);
          writes.push(write({ type: "response.output_item.added", output_index: item.outputIndex, item: responsesFunctionCallItem(item, "in_progress") }));
        }
        if (call.id) item.id = String(call.id);
        if (call.function?.name) item.name = String(call.function.name);
        const args = String(call.function?.arguments || "");
        if (args) {
          item.arguments += args;
          writes.push(write({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: item.outputIndex, delta: args }));
        }
      }
    };
    try {
      await write({ type: "response.created", response: makeResponsesPayload(seed, { status: "in_progress" }) });
      await write({ type: "response.output_item.added", output_index: 0, item: baseMessage });
      await write({ type: "response.content_part.added", item_id: seed.messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });

      const reader = openaiResp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = Date.now();
        noteStreamByte(diag, now);
        buffer += decoder.decode(value, { stream: true });
        buffer = consumeOpenAiStreamBuffer(buffer, (chunk) => processChunk(chunk, now));
        await Promise.all(writes.splice(0));
        if (streamError) throw new Error(streamError);
      }
      if (buffer) {
        consumeOpenAiStreamBuffer(buffer + "\n\n", (chunk) => processChunk(chunk));
        await Promise.all(writes.splice(0));
        if (streamError) throw new Error(streamError);
      }

      const donePart = { type: "output_text", text, annotations: [] };
      await write({ type: "response.output_text.done", item_id: seed.messageId, output_index: 0, content_index: 0, text });
      await write({ type: "response.content_part.done", item_id: seed.messageId, output_index: 0, content_index: 0, part: donePart });
      await write({ type: "response.output_item.done", output_index: 0, item: { ...baseMessage, status: "completed", content: [donePart] } });
      if (reasoningOutputIndex != null) {
        const part = { type: "summary_text", text: reasoning };
        await write({ type: "response.reasoning_summary_text.done", item_id: seed.reasoningId, output_index: reasoningOutputIndex, summary_index: 0, text: reasoning });
        await write({ type: "response.reasoning_summary_part.done", item_id: seed.reasoningId, output_index: reasoningOutputIndex, summary_index: 0, part });
        await write({ type: "response.output_item.done", output_index: reasoningOutputIndex, item: responsesReasoningItem(seed, reasoning) });
      }
      for (const item of toolCalls.values()) {
        await write({ type: "response.function_call_arguments.done", item_id: item.id, output_index: item.outputIndex, arguments: item.arguments });
        await write({ type: "response.output_item.done", output_index: item.outputIndex, item: responsesFunctionCallItem(item) });
      }
      await write({ type: "response.completed", response: makeResponsesPayload(seed, { text, usage, toolCalls: [...toolCalls.values()].map((item) => ({ id: item.id, function: { name: item.name, arguments: item.arguments } })), reasoning }) });
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (error) {
      closeReason = "error";
      await write({ type: "response.failed", response: { ...makeResponsesPayload(seed, { text, usage, status: "failed" }), error: { message: error.message || "Stream error.", type: "server_error" } } });
      await write({ type: "error", error: { message: error.message || "Stream error.", type: "server_error" } });
    } finally {
      if (onDone) onDone(normalizeResponsesUsage(usage, estimateTokens(text + reasoning + [...toolCalls.values()].map((item) => item.arguments).join(""))), {
        close_reason: closeReason,
        finish_reason: finishReason,
        tool_calls_count: toolCalls.size,
        ...streamDiagExtra(diag),
      });
      await writer.close();
    }
  })();

  return readable;
}

async function proxyRequest({ client, model, pathname, request, bodyText, runtime, search }) {
  if (pathname === CHAT_PATH) {
    bodyText = applyGatewayPromptContext(bodyText, runtime.settings, client);
  }

  const candidates = proxyCandidates(runtime, client, model, pathname);

  if (candidates.length === 0) {
    throw httpError(404, `No upstream available for model: ${model}`);
  }

  const attempts = orderUpstreams(runtime, candidates, model);
  const maxAttempts = runtime.routing.failover === false
    ? 1
    : Math.min(attempts.length, runtime.routing.hedge_max || 2);
  if ((runtime.routing.hedge_enabled === true || runtime.routing.fast_routing === true) && maxAttempts > 1) {
    const hedgedAttempts = avoidLastSuccessfulUpstream(attempts.slice(0, maxAttempts), model);
    return hedgedProxyRequest({ attempts: hedgedAttempts, bodyText, model, pathname, request, runtime, search });
  }
  let lastError = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const upstream = attempts[index];
    const isLast = index === maxAttempts - 1;
    let upstreamResult = null;

    try {
      if (!takeNimMinuteSlot(upstream)) {
        lastError = new Error(`NVIDIA NIM RPM limit reached for ${upstream.name}`);
        lastError.upstreamName = upstream.name;
        continue;
      }
      upstreamResult = await fetchProxyUpstream({ bodyText, pathname, request, runtime, search, upstream });
      let response = upstreamResult.response;
      const upstreamLatency = upstreamResult.latency;

      const shouldRetry = runtime.routing.failover !== false && await isRetryableUpstreamResponse(response);
      if (shouldRetry) {
        if (!isLast) {
          await discardUpstreamResponse(upstreamResult, "retryable upstream response");
        }
        lastError = new Error(`HTTP ${response.status}`);
        lastError.upstreamName = upstream.name;
        markUpstreamFailure(runtime, upstream, model);
      } else {
        clearUpstreamFailure(upstream, model);
        rememberUpstreamLatency(upstream, model, upstreamLatency);
        rememberSuccessfulUpstream(upstream, model);
      }

      if (!shouldRetry || isLast) {
        return {
          attempts: index + 1,
          response,
          upstream,
        };
      }
    } catch (error) {
      await discardUpstreamResponse(upstreamResult, "upstream request failed");
      lastError = error;
      lastError.upstreamName = upstream.name;
      markUpstreamFailure(runtime, upstream, model);
      if (isLast) {
        break;
      }
    }
  }

  const err = httpError(502, lastError?.message || "All upstreams failed.");
  err.upstreamName = lastError?.upstreamName || "none";
  throw err;
}

function proxyCandidates(runtime, client, model, pathname) {
  const indexed = runtime.routeIndex?.[pathname];
  const indexedPool = indexed
    ? [...(indexed.models[model] || []), ...indexed.wildcard]
    : null;
  const pool = indexedPool && indexedPool.length ? indexedPool : runtime.upstreams;
  return pool.filter((upstream) =>
    clientAllowsUpstream(client, upstream.name) &&
    (indexedPool?.length || (upstreamSupportsModel(upstream, model) && upstreamSupportsPath(upstream, pathname)))
  );
}

function gatewayErrorResponse(error, traceId) {
  const response = withCorsResponse(json(openAiError(error.message || "Internal error.", mapErrorType(error.statusCode)), error.statusCode || 500));
  return traceResponse(response, traceId);
}

function traceResponse(response, traceId) {
  if (!traceId) return response;
  const headers = new Headers(response.headers);
  headers.set("x-llm-gateway-trace-id", traceId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchProxyUpstream({ bodyText, pathname, request, runtime, search, signal, upstream }) {
  const started = Date.now();
  const release = trackActiveUpstream(upstream);
  try {
    const sanitizedBody = sanitizeProxyBody(bodyText, upstream);
    const init = {
      method: request.method,
      headers: buildUpstreamHeaders(request, upstream),
      body: sanitizedBody,
    };
    if (signal) init.signal = signal;
    const response = await fetchWithTimeout(
      buildUpstreamUrl(upstream.base_url, pathname, search),
      init,
      proxyFirstByteTimeoutMs(runtime, upstream, sanitizedBody),
      runtime.streamIdleTimeoutMs,
      release,
    );
    return { response, release, latency: Date.now() - started, startedAt: started };
  } catch (error) {
    release();
    throw error;
  }
}

function proxyFirstByteTimeoutMs(runtime, upstream, bodyText) {
  const base = runtime.requestTimeoutMs;
  if (!isNvidiaNimUpstream(upstream)) return base;
  try {
    const modelName = String(JSON.parse(bodyText || "{}").model || "").toLowerCase();
    // ponytail: GLM/MiniMax on NIM can spend minutes before first byte; streaming idle timeout still guards after headers.
    return (isGlmModel(modelName) || isMiniMaxM3Model(modelName))
      ? Math.max(base, NIM_SLOW_FIRST_BYTE_TIMEOUT_MS)
      : base;
  } catch {
    return base;
  }
}

function applyGatewayPromptContext(bodyText, settings, client) {
  if (!bodyText) return bodyText;
  const clientIds = clientIdentitySet(client);
  const systemText = promptAppliesToClient(settings?.system_prompt_clients, client, clientIds) ? String(settings?.system_prompt || "").trim() : "";
  const subagentClients = normalizeStringArray(settings?.subagent_prompt_clients);
  const subagentText = subagentClients.length && promptAppliesToClient(subagentClients, client, clientIds) ? SUBAGENT_PROMPT : "";
  const combinedSystemText = [systemText, subagentText].filter(Boolean).join("\n\n");
  const items = Array.isArray(settings?.context_items) ? settings.context_items : [];
  const hasContext = (promptAppliesToClient(settings?.global_context_clients, client, clientIds) && String(settings?.global_context || "").trim()) ||
    (settings?.context_on_demand === true && items.some((item) => item && item.enabled !== false && item.text));
  if (!combinedSystemText && !hasContext) return bodyText;
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  if (!Array.isArray(payload.messages)) return bodyText;
  const contextText = hasContext ? selectGatewayContext(payload, settings, client, clientIds) : "";
  if (!combinedSystemText && !contextText) return bodyText;
  const injected = [];
  if (combinedSystemText) {
    injected.push({ role: "system", content: combinedSystemText });
  }
  if (contextText) {
    const contextMessage = {
      role: "user",
      content: "Global reference context. Use it when relevant, but do not mention it unless the user asks.\n\n" + contextText,
    };
    const systemEnd = payload.messages.findIndex((msg) => !["system", "developer"].includes(String(msg?.role || "")));
    const insertAt = systemEnd < 0 ? payload.messages.length : systemEnd;
    payload.messages.splice(insertAt, 0, contextMessage);
  }
  if (injected.length) payload.messages = injected.concat(payload.messages);
  return JSON.stringify(payload);
}

function selectGatewayContext(payload, settings, client, clientIds) {
  const base = promptAppliesToClient(settings?.global_context_clients, client, clientIds) ? String(settings?.global_context || "").trim() : "";
  if (settings?.context_on_demand !== true) return base;
  const items = Array.isArray(settings?.context_items) ? settings.context_items : normalizeContextItems(settings?.context_items);
  if (!items.length) return base;

  const model = String(payload?.model || "").toLowerCase();
  const query = ((payload?.messages || []).slice(-4).map((msg) => chatContentToText(msg?.content || "")).join("\n") + "\n" + model + "\n" + (client?.name || "")).toLowerCase();
  const candidates = items
    .filter((item) => item.enabled !== false && contextScopeMatches(item.clients, client, clientIds) && contextModelMatches(item.models, model))
    .map((item) => ({ item, score: contextKeywordScore(item, query) }))
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority)
  const alwaysClients = normalizeStringArray(settings?.context_always_clients);
  const forceAll = alwaysClients.length && promptAppliesToClient(alwaysClients, client, clientIds);
  const picked = forceAll
    ? candidates
    : candidates.filter((hit) => hit.score > 0).slice(0, Math.max(1, Math.min(5, Number(settings.context_item_limit || 3))));
  if (!picked.length) return base;

  let remaining = Math.max(500, Number(settings.context_max_chars || 4000));
  const parts = [];
  for (const { item } of picked) {
    if (remaining <= 0) break;
    const text = item.text.slice(0, Math.min(remaining, item.max_chars || remaining));
    parts.push(`[${item.title}]\n${text}`);
    remaining -= text.length;
  }
  return parts.filter(Boolean).join("\n\n");
}

function contextScopeMatches(scope, client, clientIds) {
  return !normalizeStringArray(scope).length || promptAppliesToClient(scope, client, clientIds);
}

function contextModelMatches(scope, model) {
  const list = Array.isArray(scope) ? scope : normalizeStringArray(scope);
  if (!list.length || list.includes("*")) return true;
  return list.some((item) => modelsMatch(model, item) || model.includes(String(item).toLowerCase()));
}

function contextKeywordScore(item, query) {
  const keywords = item.keyword_lc || normalizeStringArray(item.keywords).map((word) => word.toLowerCase());
  if (!keywords.length) return 1 + (Number(item.priority || 0) / 100);
  return keywords.reduce((score, keyword) => score + (query.includes(keyword) ? 1 : 0), 0) + (Number(item.priority || 0) / 100);
}

function clientIdentitySet(client) {
  return new Set([client?.id, client?.name, client?.key].map((item) => String(item || "").trim()).filter(Boolean));
}

function promptAppliesToClient(scope, client, clientIds) {
  const list = normalizeStringArray(scope);
  if (!list.length || list.includes("*") || list.includes("__all__")) return true;
  if (list.includes("__none__")) return false;
  const ids = clientIds || clientIdentitySet(client);
  return list.some((item) => ids.has(item));
}

async function isRetryableUpstreamResponse(response) {
  if (RETRYABLE_STATUSES.has(response.status)) return true;
  const contentType = response.headers.get("content-type") || "";
  if (looksLikeHtmlResponse(response)) return true;
  if (response.ok && !contentType.includes("application/json")) return false;
  try {
    const body = await response.clone().text();
    if (looksLikeHtmlDocument(body)) return true;
    return upstreamApplicationErrorMessage(safeJson(body) || body) ||
      body.includes("DEGRADED function cannot be invoked") ||
      /Function id ['"][^'"]+['"].*Specified function .* is not found/i.test(body);
  } catch {
    return false;
  }
}

function upstreamApplicationErrorMessage(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return /internal server error|server_error|resourceexhausted|resource exhausted/i.test(value) ? value : "";
  }
  if (typeof value !== "object") return "";
  const message = value.error?.message || value.error || value.message || value.detail || value.details || "";
  if (typeof message === "string") return upstreamApplicationErrorMessage(message);
  if (Array.isArray(message)) return message.map(upstreamApplicationErrorMessage).find(Boolean) || "";
  return "";
}

function streamEventErrorMessage(value) {
  if (!value || typeof value !== "object") return "";
  if (value.type === "error" || value.error) {
    const message = value.error?.message || value.message || value.error;
    return typeof message === "string" ? message : JSON.stringify(message || "Upstream stream error.");
  }
  return upstreamApplicationErrorMessage(value);
}

function looksLikeHtmlResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function looksLikeHtmlDocument(text) {
  return /^\s*(?:<!doctype\s+html|<html[\s>]|<!--\[if\s+|<head[\s>]|<body[\s>])/i.test(String(text || ""));
}

function upstreamBadGatewayResponse(message, headers) {
  const out = responseBodyHeaders(headers || new Headers());
  out.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(openAiError(message || "Upstream returned an invalid response.", "server_error")), {
    status: 502,
    statusText: "Bad Gateway",
    headers: out,
  });
}

async function discardUpstreamResponse(result, reason) {
  try { await result?.response?.body?.cancel(reason); } catch {}
  result?.release?.();
}

function discardPendingHedgeLosers(pending) {
  pending.forEach(({ promise }) => {
    void promise.then((result) => discardUpstreamResponse(result, "hedged upstream lost")).catch(() => {});
  });
}

async function hedgedProxyRequest({ attempts, bodyText, model, pathname, request, runtime, search }) {
  const controllers = attempts.map(() => new AbortController());
  const streamRequest = requestBodyStreams(bodyText);
  const fastDelayMs = Math.max(100, Math.min(300, Math.floor(runtime.requestTimeoutMs / 12)));
  const knownTtft = upstreamLatencyScore(attempts[0], model);
  const hedgeDelayMs = Math.max(100, Math.min(1500, Math.floor(runtime.requestTimeoutMs / 3), Number.isFinite(knownTtft) ? Math.floor(knownTtft * 0.75) : 1000));
  const launchDelay = (index) => runtime.routing.fast_routing === true && index < 2
    ? index * fastDelayMs
    : index * hedgeDelayMs;
  let done = false;

  function launchLater(index) {
    const upstream = attempts[index];
    return sleep(launchDelay(index)).then(async () => {
      if (done) return { cancelled: true, upstream, index };
      if (!takeNimMinuteSlot(upstream)) {
        return { limited: true, error: new Error(`NVIDIA NIM RPM limit reached for ${upstream.name}`), upstream, index };
      }
      let result = null;
      try {
        result = await fetchProxyUpstream({ bodyText, pathname, request, runtime, search, signal: controllers[index].signal, upstream });
        if (result.response.ok && streamRequest) {
          const primed = await primeSseResponse(result.response);
          result.response = primed.response;
          result.streamError = primed.error;
          result.latency = Date.now() - result.startedAt;
        }
        return { ...result, upstream, index };
      } catch (error) {
        await discardUpstreamResponse(result, "hedged upstream request failed");
        return { error, upstream, index, latency: 0 };
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
    const retryable = Boolean(result.streamError) || (result.response && await isRetryableUpstreamResponse(result.response));
    if (result.response && !retryable) {
      done = true;
      controllers.forEach((controller, i) => { if (i !== result.index) controller.abort(); });
      discardPendingHedgeLosers(pending);
      clearUpstreamFailure(result.upstream, model);
      rememberUpstreamLatency(result.upstream, model, result.latency);
      rememberSuccessfulUpstream(result.upstream, model);
      return { attempts: result.index + 1, response: result.response, upstream: result.upstream };
    }
    if (result.response) {
      await discardUpstreamResponse(result, "retryable hedged response");
    }
    markUpstreamFailure(runtime, result.upstream, model);
  }

  const err = httpError(502, lastResult?.error?.message || "All hedged upstreams failed.");
  err.upstreamName = lastResult?.upstream?.name || attempts[attempts.length - 1]?.name || "none";
  throw err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestBodyStreams(bodyText) {
  try { return JSON.parse(bodyText || "{}").stream === true; } catch { return false; }
}

async function primeSseResponse(response) {
  if (!response.body || !(response.headers.get("content-type") || "").includes("text/event-stream")) {
    return { response, error: "" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  let error = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    text += decoder.decode(value, { stream: true });
    const events = text.split(/\r?\n\r?\n/);
    text = events.pop() || "";
    for (const event of events) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      const payload = safeJson(data);
      error = streamEventErrorMessage(payload) || upstreamApplicationErrorMessage(data);
      if (error || ssePayloadHasOutput(payload)) {
        return { response: prependResponseChunks(response, reader, chunks), error };
      }
    }
  }
  return { response: prependResponseChunks(response, reader, chunks), error: error || "Upstream stream ended before producing output." };
}

function ssePayloadHasOutput(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (String(payload.type || "").includes("delta")) return true;
  const delta = payload.choices?.[0]?.delta || {};
  return Boolean(chatContentToText(delta.content || "") || delta.reasoning_content || delta.reasoning || delta.thinking || delta.tool_calls?.length);
}

function prependResponseChunks(response, reader, chunks) {
  return new Response(new ReadableStream({
    async start(controller) {
      try {
        for (const chunk of chunks) controller.enqueue(chunk);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch {}
    },
  }), { status: response.status, statusText: response.statusText, headers: responseBodyHeaders(response.headers) });
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

function orderUpstreams(runtime, candidates, model) {
  if (candidates.length <= 1) {
    return candidates;
  }

  const now = Date.now();
  const healthy = [];
  const cooling = [];

  candidates.forEach((upstream) => {
    const status = _upstreamCooldowns[upstreamModelKey(upstream, model)];
    if (status && Number(status.until) > now) {
      cooling.push(upstream);
      return;
    }
    if (status) delete _upstreamCooldowns[upstreamModelKey(upstream, model)];
    healthy.push(upstream);
  });

  const orderedHealthy = runtime.routing.load_balance === false
    ? activeSort(latencySort(prioritySort(healthy), model))
    : activeSort(latencySort(weightedShuffle(healthy), model));

  const orderedCooling = runtime.routing.load_balance === false
    ? activeSort(latencySort(prioritySort(cooling), model))
    : activeSort(latencySort(weightedShuffle(cooling), model));

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

function latencySort(items, model) {
  return [...items].sort((a, b) => upstreamLatencyScore(a, model) - upstreamLatencyScore(b, model));
}

function activeSort(items) {
  return [...items].sort((a, b) => activeUpstreamCount(a) - activeUpstreamCount(b));
}

function activeUpstreamCount(upstream) {
  return Number(_activeUpstreams[String(upstream?.name || "").trim()] || 0) || 0;
}

function upstreamLatencyScore(upstream, model) {
  const score = Number(_upstreamLatency[upstreamModelKey(upstream, model)]);
  return Number.isFinite(score) && score > 0 ? score : Number.POSITIVE_INFINITY;
}

function avoidLastSuccessfulUpstream(items, model) {
  const last = _lastSuccessfulUpstreamName[String(model || "*")];
  if (items.length <= 1 || !last || items[0]?.name !== last) return items;
  return items.slice(1).concat(items[0]);
}

function rememberSuccessfulUpstream(upstream, model) {
  _lastSuccessfulUpstreamName[String(model || "*")] = String(upstream?.name || "").trim();
}

function noteActiveUpstream(upstream, delta) {
  const name = String(upstream?.name || "").trim();
  if (!name) return;
  const next = Math.max(0, Number(_activeUpstreams[name] || 0) + delta);
  if (next) _activeUpstreams[name] = next;
  else delete _activeUpstreams[name];
}

function trackActiveUpstream(upstream) {
  noteActiveUpstream(upstream, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    noteActiveUpstream(upstream, -1);
  };
}

function getActiveUpstreamSnapshot() {
  return { ..._activeUpstreams };
}

function rememberUpstreamLatency(upstream, model, latencyMs) {
  const name = upstreamModelKey(upstream, model);
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

function markUpstreamFailure(runtime, upstream, model) {
  if (runtime.routing.failover === false) return;
  _upstreamCooldowns[upstreamModelKey(upstream, model)] = {
    until: Date.now() + runtime.upstreamCooldownTtl * 1000,
  };
}

function clearUpstreamFailure(upstream, model) {
  delete _upstreamCooldowns[upstreamModelKey(upstream, model)];
}

function upstreamModelKey(upstream, model) {
  return `${String(upstream?.name || "").trim()}\n${String(model || "*").trim().toLowerCase()}`;
}

function buildUpstreamUrl(baseUrl, pathname, search) {
  const base = String(baseUrl).replace(/\/+$/, "");
  let path = pathname;

  if ((base.endsWith("/v1") || base.endsWith("/v4")) && path.startsWith("/v1/")) {
    path = path.slice(3);
  }

  return `${base}${path}${search}`;
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

function clientAllowsModelSelection(client, requestedModel, resolvedModel = requestedModel) {
  if (!Array.isArray(client.models) || client.models.length === 0 || client.models.includes("*")) {
    return true;
  }
  return client.models.some((allowed) =>
    modelsMatch(allowed, requestedModel) || modelsMatch(allowed, resolvedModel)
  );
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
  delete _clientCache[stored.key];
  delete _clientCacheTs[stored.key];
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
  delete _clientCache[record.key];
  delete _clientCacheTs[record.key];
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

function normalizeModelContexts(value, models = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const contexts = {};
  for (const model of normalizeStringArray(models)) {
    contexts[model] = String(source[model] || "1m").trim() || "1m";
  }
  return contexts;
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
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return (request.headers.get("x-api-key") || "").trim() || null;
}

async function fetchWithTimeout(url, init, timeoutMs, idleTimeoutMs = timeoutMs, onClose) {
  const timeout = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  const idleTimeout = Math.max(1, Number(idleTimeoutMs) || timeout);
  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const abort = () => controller.abort(upstreamSignal?.reason || "timeout");
  const cleanupSignal = () => upstreamSignal?.removeEventListener("abort", abort);
  if (upstreamSignal?.aborted) abort();
  else upstreamSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort("timeout"), timeout);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return wrapIdleTimeout(response, idleTimeout, () => {
      cleanupSignal();
      onClose?.();
    });
  } catch (error) {
    clearTimeout(timer);
    cleanupSignal();
    throw error;
  }
}

function wrapIdleTimeout(response, timeoutMs, onClose) {
  if (!response.body) {
    onClose?.();
    return response;
  }
  const stream = response.body;
  let reader = null;
  let closed = false;
  let timer = null;
  let finished = false;
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };
  const finish = () => {
    if (finished) return;
    finished = true;
    onClose?.();
  };
  return new Response(new ReadableStream({
    async start(controller) {
      reader = stream.getReader();
      const reset = () => {
        stop();
        timer = setTimeout(async () => {
          if (closed) return;
          closed = true;
          try { await reader.cancel("idle timeout"); } catch {}
          stop();
          finish();
          controller.error(new Error("Upstream idle timeout."));
        }, timeoutMs);
      };

      reset();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reset();
          if (closed) break;
          controller.enqueue(value);
        }
        if (!closed) {
          closed = true;
          stop();
          finish();
          controller.close();
        }
      } catch (error) {
        if (!closed) {
          closed = true;
          stop();
          finish();
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      closed = true;
      stop();
      finish();
      try { await reader?.cancel(reason); } catch {}
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers: responseBodyHeaders(response.headers),
  });
}

function responseBodyHeaders(headers) {
  const safe = new Headers(headers);
  ["content-length", "content-encoding", "transfer-encoding"].forEach((name) => safe.delete(name));
  return safe;
}

function proxyResponseHeaders(upstreamResp, proxyResponse, client, traceId) {
  const headers = responseBodyHeaders(upstreamResp.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  headers.set("x-llm-gateway-upstream", proxyResponse.upstream.name);
  headers.set("x-llm-gateway-client", client.name || client.id || "client");
  headers.set("x-llm-gateway-attempts", String(proxyResponse.attempts));
  headers.set("x-llm-gateway-trace-id", traceId);
  return headers;
}

function setSseHeaders(headers) {
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("x-accel-buffering", "no");
  headers.delete("content-length");
}

function generateClientKey() {
  return `sk-gw-${randomString(40)}`;
}

function requestTraceId(request) {
  const incoming = String(request.headers.get("x-request-id") || request.headers.get("x-trace-id") || "").trim();
  return incoming && incoming.length <= 128 ? incoming : `gw_${randomString(16)}`;
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

// ponytail: minimal nginx decoy �?just enough to look real, ~60% smaller
function renderNginxWelcomePage() {
  return "<!doctype html><html lang=en><head><meta charset=utf-8><title>Welcome to nginx!</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fa;color:#111827;font:16px/1.6 Georgia,serif}main{width:min(600px,calc(100vw - 32px));background:#fff;border:1px solid #d1d5db;padding:32px}h1{margin:0 0 16px}p{margin:0 0 12px}</style></head><body><main><h1>Welcome to nginx!</h1><p>If you see this page, the web server is successfully installed and working.</p><p>Further configuration is required.</p></main></body></html>";
}

// ponytail: origin param lets us pre-fill gateway URL server-side (no API wait)
