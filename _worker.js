const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-admin-token",
};

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MODEL_PATH = "/v1/models";
const CHAT_PATH = "/v1/chat/completions";
const EMBEDDINGS_PATH = "/v1/embeddings";
const GATEWAY_CONFIG_KEY = "gateway:config";
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_MODEL_CACHE_TTL = 3600;
const DEFAULT_COOLDOWN_TTL = 60;
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
    id: "claude-openai",
    name: "Custom Claude-Compatible",
    base_url: "",
    paths: [CHAT_PATH],
    requires_base_url: true,
  },
  {
    id: "generic-openai",
    name: "Custom OpenAI-Compatible",
    base_url: "",
    paths: [CHAT_PATH, EMBEDDINGS_PATH],
    requires_base_url: true,
  },
];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathname = normalizePathname(url.pathname);
      const pathnameLower = pathname.toLowerCase();
      const app = createApp(env);
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
              now: new Date().toISOString(),
            },
            200,
          ),
        );
      }

      if (request.method === "GET" && adminRoute?.kind === "page") {
        return html(renderAdminPage());
      }

      if (adminRoute?.kind === "api") {
        return handleAdminApi(request, url, pathnameLower, app, adminRoute.basePath);
      }

      if (pathname === MODEL_PATH && request.method === "GET") {
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        return withCorsResponse(await listModels(client, runtime));
      }

      if (
        (pathname === CHAT_PATH || pathname === EMBEDDINGS_PATH) &&
        request.method === "POST"
      ) {
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        const bodyText = await request.text();
        const payload = parseJsonBody(bodyText);
        const model = payload.model;

        if (!model || typeof model !== "string") {
          return withCorsResponse(
            json(openAiError("`model` is required.", "invalid_request_error"), 400),
          );
        }

        const proxyResponse = await proxyRequest({
          client,
          model,
          pathname,
          request,
          bodyText,
          runtime,
          search: url.search,
        });

        return withGatewayHeaders(proxyResponse.response, {
          upstream: proxyResponse.upstream.name,
          client: client.name || client.id || "client",
          attempts: proxyResponse.attempts,
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

function createApp(env) {
  const adminToken = pickAdminToken(env);

  if (!/^[A-Za-z0-9._~-]+$/.test(adminToken)) {
    throw badConfig("ADMIN_TOKEN may only contain URL-safe characters.");
  }

  return {
    adminPath: `/${adminToken}`,
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
  };
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
    const normalized = await normalizeGatewayConfigPayload(payload, app);
    await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(normalized));

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

  return withCorsResponse(json(openAiError("Admin route not found.", "not_found_error"), 404));
}

async function getEditableConfig(app) {
  const stored = app.kv ? await app.kv.get(GATEWAY_CONFIG_KEY, "json") : null;
  if (stored && typeof stored === "object") {
    return await normalizeGatewayConfigPayload(stored, app);
  }

  return buildGatewayConfigFromEnv(app);
}

async function buildGatewayConfigFromEnv(app) {
  const upstreams = [];

  for (let index = 0; index < app.envUpstreams.length; index += 1) {
    const upstream = app.envUpstreams[index];
    const presetId = inferPresetId(upstream.base_url);
    const plaintextKey = upstream.api_key || app.env[upstream.api_key_env] || "";

    upstreams.push({
      api_key_encrypted: plaintextKey
        ? await ensureEncryptedValue(plaintextKey, app.encryptionSecret)
        : "",
      base_url: resolveBaseUrl(
        presetId,
        upstream.base_url,
        presetById(presetId)?.base_url,
      ),
      enabled: upstream.enabled !== false,
      headers: normalizeHeaders(upstream.headers),
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
    });
  }

  return {
    routing: {
      failover: true,
      load_balance: true,
    },
    settings: {
      model_cache_ttl: app.defaultModelCacheTtl,
      request_timeout_ms: app.defaultTimeoutMs,
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
    if (!item || typeof item !== "object") {
      continue;
    }

    const preset = presetById(item.preset) ? item.preset : "generic-openai";
    const defaults = presetById(preset) || presetById("generic-openai");
    const apiKeyValue = String(
      item.api_key_value || item.api_key_encrypted || item.api_key || "",
    ).trim();

    upstreams.push({
      api_key_encrypted: apiKeyValue
        ? await ensureEncryptedValue(apiKeyValue, app.encryptionSecret)
        : "",
      base_url: resolveBaseUrl(preset, item.base_url, defaults.base_url),
      enabled: item.enabled !== false,
      headers: normalizeHeaders(item.headers),
      id: String(item.id || crypto.randomUUID()),
      models: normalizeStringArray(item.models),
      name: String(item.name || `upstream-${index + 1}`).trim(),
      note: String(item.note || "").trim(),
      paths: normalizeStringArray(item.paths).length
        ? normalizeStringArray(item.paths)
        : [...defaults.paths],
      preset,
      priority: parsePriority(item.priority, index + 1),
      weight: parsePositiveInt(item.weight, 1),
    });
  }

  for (const upstream of upstreams) {
    if (!upstream.name) {
      throw httpError(400, "Each upstream needs a name.");
    }
    if (!upstream.base_url) {
      throw httpError(400, `Upstream ${upstream.name} is missing base_url.`);
    }
    if (!upstream.api_key_encrypted) {
      throw httpError(400, `Upstream ${upstream.name} is missing api_key.`);
    }
  }

  return {
    routing: {
      failover: routing.failover !== false,
      load_balance: routing.load_balance !== false,
    },
    settings: {
      model_cache_ttl: parsePositiveInt(settings.model_cache_ttl, app.defaultModelCacheTtl),
      request_timeout_ms: parsePositiveInt(settings.request_timeout_ms, app.defaultTimeoutMs),
      upstream_cooldown_ttl: parsePositiveInt(
        settings.upstream_cooldown_ttl,
        app.defaultCooldownTtl,
      ),
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
      api_key_value: upstream.api_key_encrypted || "",
    })),
    version: config.version || 1,
  };
}

async function loadRuntimeConfig(app) {
  const editable = await getEditableConfig(app);
  const upstreams = [];

  for (const upstream of editable.upstreams) {
    if (upstream.enabled === false) {
      continue;
    }

    upstreams.push({
      ...upstream,
      api_key: await decryptValue(upstream.api_key_encrypted, app.encryptionSecret),
    });
  }

  return {
    clients: app.envClients.map(normalizeClient),
    kv: app.kv,
    modelCacheTtl: editable.settings.model_cache_ttl,
    requestTimeoutMs: editable.settings.request_timeout_ms,
    routing: editable.routing,
    settings: editable.settings,
    upstreamCooldownTtl: editable.settings.upstream_cooldown_ttl,
    upstreams,
  };
}

async function requireClient(request, runtime) {
  const token = getBearerToken(request);
  if (!token) {
    throw httpError(401, "Missing bearer token.");
  }

  if (runtime.kv) {
    const kvClient = await runtime.kv.get(clientTokenKey(token), "json");
    if (kvClient?.key) {
      return normalizeClient(kvClient);
    }
  }

  const staticClient = runtime.clients.find((item) => item.key === token);
  if (staticClient) {
    return staticClient;
  }

  throw httpError(401, "Invalid bearer token.");
}

async function listModels(client, runtime) {
  const rows = [];
  const seen = new Set();

  for (const upstream of runtime.upstreams) {
    if (!clientAllowsUpstream(client, upstream.name)) {
      continue;
    }

    const models = await getUpstreamModels(runtime, upstream);
    for (const model of models) {
      if (!model || model === "*" || seen.has(model) || !clientAllowsModel(client, model)) {
        continue;
      }

      seen.add(model);
      rows.push({
        id: model,
        object: "model",
        owned_by: upstream.note || upstream.name || "gateway",
      });
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  return json(
    {
      object: "list",
      data: rows,
    },
    200,
  );
}

async function getUpstreamModels(runtime, upstream) {
  if (Array.isArray(upstream.models) && upstream.models.length > 0) {
    return upstream.models;
  }

  if (!runtime.kv) {
    return [];
  }

  const cacheKey = modelsCacheKey(upstream.name);
  const cached = await runtime.kv.get(cacheKey, "json");
  if (cached && Array.isArray(cached.models)) {
    return cached.models;
  }

  try {
    const response = await fetchWithTimeout(
      buildUpstreamUrl(upstream.base_url, MODEL_PATH, ""),
      {
        method: "GET",
        headers: buildUpstreamHeaders(null, upstream),
      },
      runtime.requestTimeoutMs,
    );

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const models = Array.isArray(payload.data)
      ? payload.data.map((item) => item?.id).filter(Boolean)
      : [];

    await runtime.kv.put(
      cacheKey,
      JSON.stringify({
        fetched_at: new Date().toISOString(),
        models,
      }),
      { expirationTtl: runtime.modelCacheTtl },
    );

    return models;
  } catch {
    return [];
  }
}

async function refreshModelCache(runtime) {
  const results = [];

  for (const upstream of runtime.upstreams) {
    const models = await getFreshModels(runtime, upstream);
    results.push({
      model_count: models.length,
      name: upstream.name,
    });
  }

  return results;
}

async function getFreshModels(runtime, upstream) {
  if (!runtime.kv) {
    return Array.isArray(upstream.models) ? upstream.models : [];
  }

  try {
    const response = await fetchWithTimeout(
      buildUpstreamUrl(upstream.base_url, MODEL_PATH, ""),
      {
        method: "GET",
        headers: buildUpstreamHeaders(null, upstream),
      },
      runtime.requestTimeoutMs,
    );

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const models = Array.isArray(payload.data)
      ? payload.data.map((item) => item?.id).filter(Boolean)
      : [];

    await runtime.kv.put(
      modelsCacheKey(upstream.name),
      JSON.stringify({
        fetched_at: new Date().toISOString(),
        models,
      }),
      { expirationTtl: runtime.modelCacheTtl },
    );

    return models;
  } catch {
    return [];
  }
}

async function proxyRequest({ client, model, pathname, request, bodyText, runtime, search }) {
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
  let lastError = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const upstream = attempts[index];
    const isLast = index === maxAttempts - 1;

    try {
      const response = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, pathname, search),
        {
          method: request.method,
          headers: buildUpstreamHeaders(request, upstream),
          body: bodyText,
        },
        runtime.requestTimeoutMs,
      );

      const shouldRetry = runtime.routing.failover !== false && RETRYABLE_STATUSES.has(response.status);
      if (shouldRetry) {
        await markUpstreamFailure(runtime, upstream, response.status);
      } else {
        await clearUpstreamFailure(runtime, upstream);
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
      await markUpstreamFailure(runtime, upstream, 599);
      if (isLast) {
        break;
      }
    }
  }

  throw httpError(502, lastError?.message || "All upstreams failed.");
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
    ? prioritySort(healthy)
    : weightedShuffle(healthy);

  const orderedCooling = runtime.routing.load_balance === false
    ? prioritySort(cooling)
    : weightedShuffle(cooling);

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
      updated_at: new Date().toISOString(),
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
  return client.models.includes("*") || client.models.includes(model);
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
    created_at: client.created_at || new Date().toISOString(),
    updated_at: client.updated_at || new Date().toISOString(),
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

  const now = new Date().toISOString();
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
    updated_at: new Date().toISOString(),
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

async function decryptValue(value, secret) {
  if (!value) {
    return "";
  }

  if (!value.startsWith("enc::")) {
    return value;
  }

  const raw = base64UrlDecode(value.slice("enc::".length));
  const iv = raw.slice(0, 12);
  const payload = raw.slice(12);
  const key = await deriveAesKey(secret);
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
  if (value.includes("anthropic") || value.includes("claude")) {
    return "claude-openai";
  }
  return "generic-openai";
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

function resolveBaseUrl(presetId, inputBaseUrl, defaultBaseUrl) {
  const preset = presetById(presetId);
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
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return fetch(url, init);
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

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: HTML_HEADERS,
  });
}

function withCorsResponse(response) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withGatewayHeaders(response, meta) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  headers.set("x-llm-gateway-upstream", meta.upstream);
  headers.set("x-llm-gateway-client", meta.client);
  headers.set("x-llm-gateway-attempts", String(meta.attempts));

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

function renderNginxWelcomePage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to nginx!</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f5f7fa;
      color: #111827;
      font: 16px/1.6 Georgia, "Times New Roman", serif;
    }
    main {
      width: min(720px, calc(100vw - 32px));
      background: white;
      border: 1px solid #d1d5db;
      box-shadow: 0 18px 50px rgba(0,0,0,.08);
      padding: 32px;
    }
    h1 { margin: 0 0 16px; font-weight: 700; }
    p { margin: 0 0 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Welcome to nginx!</h1>
    <p>If you see this page, the web server is successfully installed and working.</p>
    <p>Further configuration is required.</p>
  </main>
</body>
</html>`;
}

function renderAdminPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LLM Gateway \u7ba1\u7406\u9762\u677f</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d7c7aa;
      --accent: #a54d2d;
      --accent-2: #2f6f5e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(165,77,45,.18), transparent 28%),
        linear-gradient(180deg, #efe5d2 0%, var(--bg) 42%, #f8f4ec 100%);
      color: var(--ink);
      font: 15px/1.5 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .wrap {
      width: min(1180px, calc(100vw - 24px));
      margin: 0 auto;
      padding: 24px 0 48px;
    }
    .hero, .panel {
      background: rgba(255,253,248,.94);
      border: 1px solid var(--line);
      box-shadow: 0 18px 40px rgba(38,28,18,.08);
      backdrop-filter: blur(8px);
    }
    .hero {
      padding: 24px;
      margin-bottom: 18px;
    }
    .hero h1 {
      margin: 0 0 8px;
      font: 700 30px/1.15 Georgia, "Times New Roman", serif;
      letter-spacing: .02em;
    }
    .hero p { margin: 0; color: var(--muted); }
    .hero code {
      background: #f2e7d3;
      padding: 2px 6px;
      border-radius: 6px;
    }
    .grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(12, 1fr);
    }
    .panel {
      padding: 18px;
      grid-column: span 12;
    }
    .panel h2 {
      margin: 0 0 14px;
      font: 700 22px/1.2 Georgia, "Times New Roman", serif;
    }
    .row {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(12, 1fr);
      margin-bottom: 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field label {
      color: var(--muted);
      font-size: 13px;
    }
    .span-12 { grid-column: span 12; }
    .span-8 { grid-column: span 8; }
    .span-6 { grid-column: span 6; }
    .span-4 { grid-column: span 4; }
    .span-3 { grid-column: span 3; }
    .span-2 { grid-column: span 2; }
    input, textarea, select {
      width: 100%;
      border: 1px solid #cdbda2;
      background: #fffdfa;
      color: var(--ink);
      border-radius: 10px;
      padding: 10px 12px;
      font: inherit;
    }
    textarea { min-height: 94px; resize: vertical; }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      font: 600 14px/1.1 inherit;
      cursor: pointer;
      background: var(--accent);
      color: white;
      transition: transform .16s ease, opacity .16s ease, filter .16s ease;
    }
    button:hover { filter: brightness(1.04); }
    button:active { transform: translateY(1px); }
    button[disabled] { opacity: .62; cursor: wait; }
    button.secondary { background: #eadcc5; color: #3a2b1f; }
    button.good { background: var(--accent-2); }
    button.danger { background: #8d2f23; }
    .note {
      color: var(--muted);
      font-size: 13px;
    }
    .status {
      min-height: 22px;
      color: var(--accent-2);
      font-weight: 600;
    }
    .upstream-list {
      display: grid;
      gap: 14px;
    }
    .group-card {
      border: 1px solid #cfbea0;
      background: #fff9ef;
      padding: 14px;
      border-radius: 20px;
    }
    .group-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .group-head h3 {
      margin: 0;
      font: 700 18px/1.2 Georgia, "Times New Roman", serif;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(33, 24, 15, .55);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      z-index: 50;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-card {
      width: min(760px, 100%);
      max-height: calc(100vh - 32px);
      overflow: auto;
      background: #fffaf2;
      border: 1px solid #cfbea0;
      border-radius: 24px;
      padding: 18px;
      box-shadow: 0 26px 60px rgba(0,0,0,.18);
    }
    .template-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin-bottom: 14px;
    }
    .template-card {
      border: 1px solid #d7c7aa;
      background: #fffcf6;
      border-radius: 18px;
      padding: 14px;
      cursor: pointer;
    }
    .template-card.active {
      border-color: #a54d2d;
      box-shadow: inset 0 0 0 1px #a54d2d;
    }
    .template-card strong {
      display: block;
      margin-bottom: 6px;
    }
    .upstream-card {
      border: 1px solid #d7c7aa;
      background: #fffcf6;
      padding: 14px;
      border-radius: 18px;
    }
    .upstream-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      align-items: center;
    }
    .mono { font-family: Consolas, "SFMono-Regular", monospace; }
    .checkbox {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: var(--ink);
      font-size: 14px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      background: #f8efdfe0;
      padding: 8px 12px;
      border-radius: 999px;
    }
    .client-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .client-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid #d7c7aa;
      background: #fffcf6;
    }
    .client-meta { display: grid; gap: 4px; }
    pre {
      white-space: pre-wrap;
      background: #fbf5e8;
      border: 1px solid #e3d4b8;
      border-radius: 12px;
      padding: 12px;
      margin: 10px 0 0;
      overflow: auto;
    }
    .output-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      max-width: min(360px, calc(100vw - 32px));
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(215, 199, 170, .9);
      background: rgba(31, 41, 55, .94);
      color: #fff;
      box-shadow: 0 16px 40px rgba(0, 0, 0, .2);
      opacity: 0;
      pointer-events: none;
      transform: translateY(8px);
      transition: opacity .18s ease, transform .18s ease;
      z-index: 60;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    @media (max-width: 860px) {
      .span-8, .span-6, .span-4, .span-3, .span-2 { grid-column: span 12; }
      .client-item, .upstream-head { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>LLM Gateway \u7ba1\u7406\u9762\u677f</h1>
      <p>\u8fd9\u4e2a\u9875\u9762\u53ea\u5728\u5f53\u524d\u9690\u85cf\u8def\u5f84\u4e0b\u53ef\u89c1\u3002\u5bf9\u5916\u7684 OpenAI \u517c\u5bb9\u5165\u53e3\u56fa\u5b9a\u4e3a <code id="gateway-url">/v1</code>\u3002</p>
    </section>

    <div class="grid">
      <section class="panel">
        <h2>\u57fa\u7840\u914d\u7f6e</h2>
        <div class="row">
          <div class="field span-4">
            <label for="request-timeout">\u8bf7\u6c42\u8d85\u65f6\uff08\u6beb\u79d2\uff09</label>
            <input id="request-timeout" type="number" min="1000">
          </div>
          <div class="field span-4">
            <label for="cooldown-ttl">\u5931\u8d25\u51b7\u5374\uff08\u79d2\uff09</label>
            <input id="cooldown-ttl" type="number" min="1">
          </div>
          <div class="field span-4">
            <label for="model-cache-ttl">\u6a21\u578b\u7f13\u5b58\uff08\u79d2\uff09</label>
            <input id="model-cache-ttl" type="number" min="1">
          </div>
        </div>
        <div class="toolbar">
          <label class="checkbox"><input id="routing-load-balance" type="checkbox">\u542f\u7528\u8d1f\u8f7d\u5747\u8861</label>
          <label class="checkbox"><input id="routing-failover" type="checkbox">\u542f\u7528\u5931\u8d25\u8f6e\u8be2</label>
          <span class="pill mono" id="gateway-url-pill">/v1</span>
        </div>
        <p class="note">\u8d1f\u8f7d\u5747\u8861\u8d1f\u8d23\u591a key \u5206\u6d41\uff1b\u5931\u8d25\u8f6e\u8be2\u8d1f\u8d23\u4e0a\u6e38\u5f02\u5e38\u65f6\u81ea\u52a8\u5207\u6362\u3002\u4e24\u4e2a\u90fd\u5f00\u5c31\u662f\u6df7\u5408\u6a21\u5f0f\u3002</p>
      </section>

      <section class="panel">
        <h2>\u4e0a\u6e38 API Keys</h2>
        <div class="toolbar">
          <button class="good" id="open-vendor-modal">\u65b0\u5efa\u4f9b\u5e94\u5546</button>
        </div>
        <p class="note">\u4fdd\u5b58\u540e\u8f93\u5165\u6846\u91cc\u5c55\u793a\u7684\u662f\u52a0\u5bc6\u4e32\uff0c\u4e0d\u4f1a\u56de\u663e\u660e\u6587\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u76f4\u63a5\u6539\u5bc6\u6587\u5bf9\u5e94\u7684\u5907\u6ce8\uff0c\u4e5f\u53ef\u4ee5\u91cd\u65b0\u8d34\u5165\u65b0\u7684\u660e\u6587 key \u8986\u76d6\u5b83\u3002</p>
        <div class="upstream-list" id="upstream-list"></div>
        <div class="toolbar" style="margin-top:14px;">
          <button class="good" id="save-config">\u4fdd\u5b58\u914d\u7f6e</button>
          <button class="secondary" id="refresh-models">\u5237\u65b0\u6a21\u578b\u7f13\u5b58</button>
        </div>
        <div class="status" id="config-status"></div>
      </section>

      <section class="panel">
        <h2>\u5ba2\u6237\u7aef Keys</h2>
        <div class="row">
          <div class="field span-4">
            <label for="client-name">\u5907\u6ce8</label>
            <input id="client-name" placeholder="demo-user">
          </div>
          <div class="field span-4">
            <label for="client-models">\u6a21\u578b\u767d\u540d\u5355\uff08\u9017\u53f7\u5206\u9694\uff0c\u53ef\u7559\u7a7a\uff09</label>
            <input id="client-models" placeholder="* \u6216 meta/llama-3.1-8b-instruct">
          </div>
          <div class="field span-4">
            <label for="client-upstreams">\u4e0a\u6e38\u767d\u540d\u5355\uff08\u9017\u53f7\u5206\u9694\uff0c\u53ef\u7559\u7a7a\uff09</label>
            <input id="client-upstreams" placeholder="nim-main,nim-backup">
          </div>
        </div>
        <div class="toolbar">
          <button class="good" id="create-client">\u751f\u6210\u5ba2\u6237\u7aef Key</button>
        </div>
        <pre id="client-output" hidden></pre>
        <div class="output-actions" id="client-output-actions" hidden>
          <button type="button" class="secondary" id="copy-client-output">\u590d\u5236\u5ba2\u6237\u7aef JSON</button>
          <button type="button" class="secondary" id="copy-client-key">\u590d\u5236 API Key</button>
        </div>
        <div class="client-list" id="client-list"></div>
      </section>
    </div>
  </div>

  <div class="modal-backdrop" id="vendor-modal">
    <div class="modal-card">
      <div class="toolbar" style="justify-content:space-between;">
        <h2 style="margin:0;">\u65b0\u5efa\u4f9b\u5e94\u5546</h2>
        <button type="button" class="secondary" id="close-vendor-modal">\u5173\u95ed</button>
      </div>
      <p class="note">\u5148\u9009\u62e9\u4f9b\u5e94\u5546\u6a21\u677f\u3002\u9884\u8bbe\u6a21\u677f\u53ea\u9700\u8981\u8f93\u5165 API key\uff1b\u81ea\u5b9a\u4e49\u6a21\u677f\u9700\u8981\u540c\u65f6\u8f93\u5165 Base URL \u548c API key\u3002</p>
      <div class="template-grid" id="vendor-template-grid"></div>
      <div class="row">
        <div class="field span-4">
          <label for="vendor-note">\u5907\u6ce8</label>
          <input id="vendor-note" placeholder="\u6211\u7684 NIM Key">
        </div>
        <div class="field span-4">
          <label for="vendor-name">\u5185\u90e8\u540d\u79f0</label>
          <input id="vendor-name" placeholder="nim-main">
        </div>
        <div class="field span-4">
          <label for="vendor-enabled">\u542f\u7528</label>
          <select id="vendor-enabled">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div class="field span-6">
          <label for="vendor-base-url">Base URL</label>
          <input id="vendor-base-url" placeholder="https://integrate.api.nvidia.com/v1">
        </div>
        <div class="field span-6">
          <label for="vendor-api-key">API Key</label>
          <input id="vendor-api-key" class="mono" placeholder="nvapi-...">
        </div>
        <div class="field span-4">
          <label for="vendor-weight">\u6743\u91cd</label>
          <input id="vendor-weight" type="number" min="1" value="1">
        </div>
        <div class="field span-4">
          <label for="vendor-priority">\u4f18\u5148\u7ea7</label>
          <input id="vendor-priority" type="number" value="100">
        </div>
        <div class="field span-4">
          <label for="vendor-paths">\u8def\u5f84</label>
          <input id="vendor-paths" value="/v1/chat/completions, /v1/embeddings">
        </div>
        <div class="field span-12">
          <label for="vendor-models">\u6a21\u578b\u767d\u540d\u5355</label>
          <textarea id="vendor-models" placeholder="\u53ef\u7559\u7a7a\uff0c\u6216\u586b\u9017\u53f7/\u6362\u884c\u5206\u9694\u7684\u6a21\u578b\u540d"></textarea>
        </div>
      </div>
      <div class="toolbar">
        <button class="good" id="create-vendor">\u6dfb\u52a0\u5230 Key \u6c60</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast" aria-live="polite"></div>

  <script>
    const API_BASE = location.pathname.replace(/\/+$/, "") + "/api";
    const state = {
      config: null,
      presets: [],
      clients: [],
      gateway: null,
      draftPresetId: null,
      lastCreatedClient: null,
    };

    const byId = (id) => document.getElementById(id);
    const text = (value) => String(value ?? "");

    function splitList(value) {
      return text(value)
        .split(/[,\\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    function esc(value) {
      return text(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function presetById(id) {
      return state.presets.find((item) => item.id === id) || state.presets[0];
    }

    function makeUpstream(presetId) {
      const preset = presetById(presetId);
      const suffix = Math.random().toString(36).slice(2, 7);
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : "u-" + suffix,
        preset: preset.id,
        note: "",
        name: preset.id + "-" + suffix,
        base_url: preset.base_url || "",
        api_key_value: "",
        models: [],
        paths: [...preset.paths],
        weight: 1,
        priority: 100,
        enabled: true,
      };
    }

    function baseUrlLocked(presetId) {
      const preset = presetById(presetId);
      return !!preset && preset.requires_base_url === false;
    }

    function groupUpstreams(items) {
      const groups = new Map();
      for (const item of items) {
        const key = item.preset || "generic-openai";
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(item);
      }
      return [...groups.entries()];
    }

    function renderPresets() {
      const host = byId("vendor-template-grid");
      host.innerHTML = state.presets
        .map((preset) => '<button type="button" class="template-card' + (state.draftPresetId === preset.id ? ' active' : '') + '" data-preset="' + esc(preset.id) + '">' +
          '<strong>' + esc(preset.name) + '</strong>' +
          '<span class="note">' + (preset.requires_base_url === false ? '\u53ea\u9700 API Key' : '\u9700\u8981 Base URL + API Key') + '</span>' +
        '</button>')
        .join("");

      host.querySelectorAll("button[data-preset]").forEach((button) => {
        button.addEventListener("click", () => {
          state.draftPresetId = button.dataset.preset;
          applyVendorPreset();
          renderPresets();
        });
      });
    }

    function openVendorModal() {
      if (!state.draftPresetId && state.presets.length) {
        state.draftPresetId = state.presets[0].id;
      }
      applyVendorPreset();
      renderPresets();
      byId("vendor-modal").classList.add("open");
    }

    function closeVendorModal() {
      byId("vendor-modal").classList.remove("open");
    }

    let toastTimer = null;

    function showToast(message) {
      const toast = byId("toast");
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove("show");
      }, 2200);
    }

    async function copyText(value, successMessage) {
      if (!value) {
        throw new Error("\u6ca1\u6709\u53ef\u590d\u5236\u7684\u5185\u5bb9");
      }
      await navigator.clipboard.writeText(value);
      showToast(successMessage || "\u5df2\u590d\u5236");
    }

    async function withButtonBusy(button, label, task) {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = label;
      try {
        return await task();
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    function applyVendorPreset() {
      const preset = presetById(state.draftPresetId);
      if (!preset) {
        return;
      }
      const baseInput = byId("vendor-base-url");
      const pathsInput = byId("vendor-paths");
      const locked = preset.requires_base_url === false;
      baseInput.readOnly = locked;
      baseInput.value = locked ? (preset.base_url || "") : "";
      pathsInput.value = (preset.paths || []).join(", ");
    }

    function createVendorFromModal() {
      const preset = presetById(state.draftPresetId);
      if (!preset) {
        throw new Error("\u8bf7\u5148\u9009\u62e9\u4f9b\u5e94\u5546\u6a21\u677f");
      }

      const entry = makeUpstream(preset.id);
      entry.note = byId("vendor-note").value.trim();
      entry.name = byId("vendor-name").value.trim() || entry.name;
      entry.base_url = byId("vendor-base-url").value.trim();
      entry.api_key_value = byId("vendor-api-key").value.trim();
      entry.weight = Number(byId("vendor-weight").value || 1);
      entry.priority = Number(byId("vendor-priority").value || 100);
      entry.enabled = byId("vendor-enabled").value === "true";
      entry.paths = splitList(byId("vendor-paths").value);
      entry.models = splitList(byId("vendor-models").value);

      if (!entry.api_key_value) {
        throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
      }
      if (!entry.base_url) {
        throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");
      }

      state.config.upstreams.push(entry);
      renderUpstreams();
      closeVendorModal();
      byId("vendor-note").value = "";
      byId("vendor-name").value = "";
      byId("vendor-api-key").value = "";
      byId("vendor-models").value = "";
      byId("vendor-weight").value = "1";
      byId("vendor-priority").value = "100";
      byId("vendor-enabled").value = "true";
      applyVendorPreset();
    }

    function renderUpstreams() {
      const host = byId("upstream-list");
      if (!state.config.upstreams.length) {
        host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u4e0a\u6e38 key\uff0c\u5148\u70b9\u4e0a\u9762\u7684\u6a21\u677f\u52a0\u4e00\u4e2a\u3002</div>';
        return;
      }

      host.innerHTML = groupUpstreams(state.config.upstreams)
        .map(([groupId, items]) => {
          const groupPreset = presetById(groupId);
          const groupTitle = groupPreset ? groupPreset.name : groupId;

          const cards = items.map((item) => {
            const presetOptions = state.presets
              .map((preset) => '<option value="' + esc(preset.id) + '"' + (preset.id === item.preset ? " selected" : "") + '>' + esc(preset.name) + "</option>")
              .join("");

            const lockedBaseUrl = baseUrlLocked(item.preset);

            return '<article class="upstream-card" data-id="' + esc(item.id) + '">' +
              '<div class="upstream-head">' +
                '<strong>' + esc(item.note || item.name || '\u81ea\u5e26 Key') + '</strong>' +
                '<button type="button" class="danger delete-upstream">\u5220\u9664</button>' +
              '</div>' +
              '<div class="row">' +
                '<div class="field span-3"><label>\u6a21\u677f</label><select data-field="preset">' + presetOptions + '</select></div>' +
                '<div class="field span-3"><label>\u5907\u6ce8</label><input data-field="note" value="' + esc(item.note) + '" placeholder="\u6211\u7684 NVIDIA key"></div>' +
                '<div class="field span-3"><label>\u5185\u90e8\u540d\u79f0</label><input data-field="name" value="' + esc(item.name) + '" placeholder="nim-main"></div>' +
                '<div class="field span-3"><label>\u542f\u7528</label><select data-field="enabled"><option value="true"' + (item.enabled ? " selected" : "") + '>true</option><option value="false"' + (!item.enabled ? " selected" : "") + '>false</option></select></div>' +
                '<div class="field span-6"><label>Base URL' + (lockedBaseUrl ? ' \uff08\u9884\u8bbe\uff09' : '') + '</label><input data-field="base_url" value="' + esc(item.base_url) + '" placeholder="https://integrate.api.nvidia.com/v1"' + (lockedBaseUrl ? ' readonly' : '') + '></div>' +
                '<div class="field span-6"><label>API Key\uff08\u4fdd\u5b58\u540e\u663e\u793a\u5bc6\u6587\uff09</label><input class="mono" data-field="api_key_value" value="' + esc(item.api_key_value) + '" placeholder="nvapi-... \u6216 enc::..."></div>' +
                '<div class="field span-4"><label>\u6743\u91cd</label><input data-field="weight" type="number" min="1" value="' + esc(item.weight) + '"></div>' +
                '<div class="field span-4"><label>\u4f18\u5148\u7ea7</label><input data-field="priority" type="number" value="' + esc(item.priority) + '"></div>' +
                '<div class="field span-4"><label>\u8def\u5f84</label><input data-field="paths" value="' + esc((item.paths || []).join(", ")) + '" placeholder="/v1/chat/completions,/v1/embeddings"></div>' +
                '<div class="field span-12"><label>\u6a21\u578b</label><textarea data-field="models">' + esc((item.models || []).join("\\n")) + '</textarea></div>' +
              '</div>' +
            '</article>';
          }).join("");

          return '<section class="group-card">' +
            '<div class="group-head">' +
              '<h3>' + esc(groupTitle) + '</h3>' +
              '<span class="note">' + esc(items.length) + ' \u4e2a key</span>' +
            '</div>' +
            cards +
          '</section>';
        })
        .join("");

      host.querySelectorAll(".delete-upstream").forEach((button) => {
        button.addEventListener("click", async (event) => {
          const btn = event.currentTarget;
          btn.disabled = true;
          const card = btn.closest(".upstream-card");
          state.config.upstreams = state.config.upstreams.filter((item) => item.id !== card.dataset.id);
          renderUpstreams();
          showToast("\u5df2\u5220\u9664\u4e0a\u6e38");
        });
      });

      host.querySelectorAll('select[data-field="preset"]').forEach((select) => {
        select.addEventListener("change", (event) => {
          const card = event.target.closest(".upstream-card");
          const preset = presetById(event.target.value);
          const baseInput = card.querySelector('[data-field="base_url"]');
          const pathsInput = card.querySelector('[data-field="paths"]');
          baseInput.readOnly = !!preset && preset.requires_base_url === false;
          baseInput.value = preset && preset.requires_base_url === false ? (preset.base_url || "") : "";
          pathsInput.value = (preset.paths || []).join(", ");
          renderUpstreams();
        });
      });
    }

    function collectConfig() {
      const upstreams = [...document.querySelectorAll(".upstream-card")].map((card, index) => ({
        id: card.dataset.id || "upstream-" + index,
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
      }));

      return {
        settings: {
          request_timeout_ms: Number(byId("request-timeout").value || 90000),
          upstream_cooldown_ttl: Number(byId("cooldown-ttl").value || 60),
          model_cache_ttl: Number(byId("model-cache-ttl").value || 3600),
        },
        routing: {
          load_balance: byId("routing-load-balance").checked,
          failover: byId("routing-failover").checked,
        },
        upstreams,
      };
    }

    function renderSettings() {
      byId("request-timeout").value = state.config.settings.request_timeout_ms;
      byId("cooldown-ttl").value = state.config.settings.upstream_cooldown_ttl;
      byId("model-cache-ttl").value = state.config.settings.model_cache_ttl;
      byId("routing-load-balance").checked = state.config.routing.load_balance !== false;
      byId("routing-failover").checked = state.config.routing.failover !== false;
      byId("gateway-url").textContent = state.gateway.base_url;
      byId("gateway-url-pill").textContent = state.gateway.base_url;
    }

    async function parseApiResponse(response) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return response.json();
      }

      const text = await response.text();
      throw new Error("Admin API \u8fd4\u56de\u7684\u4e0d\u662f JSON\uff0c\u8bf7\u786e\u8ba4\u5f53\u524d\u8bbf\u95ee\u7684\u7ba1\u7406\u8def\u5f84\u6b63\u786e\u3002");
    }

    async function loadConfig() {
      const response = await fetch(API_BASE + "/config");
      const payload = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error?.message || "\u8bfb\u53d6\u914d\u7f6e\u5931\u8d25");
      }
      state.config = payload.config;
      state.presets = payload.presets;
      state.gateway = payload.gateway;
      renderSettings();
      renderPresets();
      renderUpstreams();
    }

    async function saveConfig() {
      setStatus("\u6b63\u5728\u4fdd\u5b58\u914d\u7f6e...");
      const response = await fetch(API_BASE + "/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(collectConfig()),
      });
      const payload = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error?.message || "\u4fdd\u5b58\u5931\u8d25");
      }
      state.config = payload.config;
      renderSettings();
      renderUpstreams();
      setStatus("\u914d\u7f6e\u5df2\u4fdd\u5b58\u3002");
    }

    async function refreshModels() {
      setStatus("\u6b63\u5728\u5237\u65b0\u6a21\u578b\u7f13\u5b58...");
      const response = await fetch(API_BASE + "/refresh", { method: "POST" });
      const payload = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error?.message || "\u5237\u65b0\u5931\u8d25");
      }
      const summary = (payload.result || []).map((item) => item.name + ": " + item.model_count).join(" | ");
      setStatus("\u6a21\u578b\u7f13\u5b58\u5df2\u5237\u65b0\u3002" + summary);
    }

    async function loadClients() {
      const response = await fetch(API_BASE + "/clients");
      const payload = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error?.message || "\u8bfb\u53d6\u5ba2\u6237\u7aef\u5217\u8868\u5931\u8d25");
      }
      state.clients = payload;
      renderClients();
    }

    function renderClients() {
      const host = byId("client-list");
      if (!state.clients.length) {
        host.innerHTML = '<div class="note">\u8fd8\u6ca1\u6709\u5ba2\u6237\u7aef key\u3002</div>';
        return;
      }

      host.innerHTML = state.clients.map((client) =>
        '<article class="client-item">' +
          '<div class="client-meta">' +
            '<strong>' + esc(client.name) + '</strong>' +
            '<span class="mono">' + esc(client.key_preview || "") + '</span>' +
            '<span class="note">\u6a21\u578b: ' + esc((client.models || []).join(", ") || "*") + '</span>' +
          '</div>' +
          '<button type="button" class="danger" data-client-id="' + esc(client.id) + '">\u5220\u9664</button>' +
        '</article>'
      ).join("");

      host.querySelectorAll("button[data-client-id]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          const btn = event.currentTarget;
          await withButtonBusy(btn, "\u5220\u9664\u4e2d...", () => deleteClient(btn.dataset.clientId));
        });
      });
    }

    async function createClient() {
      const payload = {
        name: byId("client-name").value.trim() || "generated-client",
        models: splitList(byId("client-models").value),
        upstreams: splitList(byId("client-upstreams").value),
      };

      if (!payload.models.length) {
        payload.models = ["*"];
      }

      const response = await fetch(API_BASE + "/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(data?.error?.message || "\u521b\u5efa\u5ba2\u6237\u7aef\u5931\u8d25");
      }

      state.lastCreatedClient = data.client;
      byId("client-output").hidden = false;
      byId("client-output").textContent = JSON.stringify(data.client, null, 2);
      byId("client-output-actions").hidden = false;
      byId("client-name").value = "";
      byId("client-models").value = "";
      byId("client-upstreams").value = "";
      showToast("\u5ba2\u6237\u7aef Key \u5df2\u521b\u5efa");
      await loadClients();
    }

    async function deleteClient(id) {
      const response = await fetch(API_BASE + "/clients/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const payload = await parseApiResponse(response);
      if (!response.ok) {
        throw new Error(payload?.error?.message || "\u5220\u9664\u5ba2\u6237\u7aef\u5931\u8d25");
      }
      await loadClients();
    }

    function setStatus(message) {
      byId("config-status").textContent = message || "";
    }

    async function boot() {
      try {
        byId("vendor-modal").addEventListener("click", (event) => {
          if (event.target === byId("vendor-modal")) {
            closeVendorModal();
          }
        });
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            closeVendorModal();
          }
        });
        byId("open-vendor-modal").addEventListener("click", openVendorModal);
        byId("close-vendor-modal").addEventListener("click", closeVendorModal);
        byId("create-vendor").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u6dfb\u52a0\u4e2d...", async () => {
            createVendorFromModal();
            showToast("\u4e0a\u6e38\u8349\u7a3f\u5df2\u6dfb\u52a0");
          }).catch(showError),
        );
        byId("save-config").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u4fdd\u5b58\u4e2d...", saveConfig).catch(showError),
        );
        byId("refresh-models").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u5237\u65b0\u4e2d...", refreshModels).catch(showError),
        );
        byId("create-client").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u521b\u5efa\u4e2d...", createClient).catch(showError),
        );
        byId("copy-client-output").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u590d\u5236\u4e2d...", () =>
            copyText(byId("client-output").textContent, "\u5ba2\u6237\u7aef JSON \u5df2\u590d\u5236"),
          ).catch(showError),
        );
        byId("copy-client-key").addEventListener("click", (event) =>
          withButtonBusy(event.currentTarget, "\u590d\u5236\u4e2d...", () =>
            copyText(state.lastCreatedClient?.api_key, "API Key \u5df2\u590d\u5236"),
          ).catch(showError),
        );
        await loadConfig();
        await loadClients();
      } catch (error) {
        showError(error);
      }
    }

    function showError(error) {
      console.error(error);
      setStatus(error.message || "Error");
      showToast(error.message || "Error");
    }

    boot();
  </script>
</body>
</html>`;
}
