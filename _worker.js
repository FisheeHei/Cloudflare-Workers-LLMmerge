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
const MESSAGES_PATH = "/v1/messages";
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
    id: "custom",
    name: "\u81ea\u5b9a\u4e49",
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
        return await handleAdminApi(request, url, pathnameLower, app, adminRoute.basePath);
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

      // ponytail: translate Anthropic messages <-> OpenAI chat.completions for Claude Code compatibility.
      if (pathname === MESSAGES_PATH && request.method === "POST") {
        const runtime = await loadRuntimeConfig(app);
        const client = await requireClient(request, runtime);
        const bodyText = await request.text();
        const anthropicPayload = parseJsonBody(bodyText);
        const model = anthropicPayload.model;

        if (!model || typeof model !== "string") {
          return withCorsResponse(
            json({ type: "error", error: { type: "invalid_request_error", message: "`model` is required." } }, 400),
          );
        }

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

        const proxyResponse = await proxyRequest({
          client, model,
          pathname: CHAT_PATH,
          request,
          bodyText: openaiBody,
          runtime,
          search: url.search,
        });

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

  // ponytail: health check only verifies connectivity, does not parse model list.
  if (apiPath === "/api/health" && request.method === "POST") {
    const runtime = await loadRuntimeConfig(app);
    const results = [];
    for (const upstream of runtime.upstreams) {
      const started = Date.now();
      try {
        const resp = await fetchWithTimeout(
          buildUpstreamUrl(upstream.base_url, MODEL_PATH, ""),
          { method: "GET", headers: buildUpstreamHeaders(null, upstream) },
          10000,
        );
        const latency = Date.now() - started;
        results.push({ name: upstream.name, ok: resp.ok, status: resp.status, latency_ms: latency });
      } catch (err) {
        results.push({ name: upstream.name, ok: false, error: err.message, latency_ms: Date.now() - started });
      }
    }
    return withCorsResponse(json({ ok: true, results }, 200));
  }

  const detectMatch = apiPath.match(/^\/api\/upstreams\/([^/]+)\/detect$/);
  if (detectMatch && request.method === "POST") {
    const upstreamName = decodeURIComponent(detectMatch[1]);
    const runtime = await loadRuntimeConfig(app);
    const upstream = runtime.upstreams.find((u) => u.name === upstreamName);
    if (!upstream) {
      return withCorsResponse(json(openAiError("Upstream not found.", "not_found_error"), 404));
    }
    const started = Date.now();
    try {
      const resp = await fetchWithTimeout(
        buildUpstreamUrl(upstream.base_url, EMBEDDINGS_PATH, ""),
        {
          method: "POST",
          headers: buildUpstreamHeaders(null, upstream),
          body: JSON.stringify({ model: "detect", input: "test" }),
        },
        10000,
      );
      const latency = Date.now() - started;
      const ok = resp.ok || resp.status === 400;
      const capability = ok ? "openai" : "claude";
      const paths = ok ? [CHAT_PATH, EMBEDDINGS_PATH] : [CHAT_PATH];
      const config = await getEditableConfig(app);
      const target = config.upstreams.find((u) => u.name === upstreamName);
      if (target) {
        target.capability = capability;
        target.paths = paths;
        await app.kv.put(GATEWAY_CONFIG_KEY, JSON.stringify(config));
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
      capability: upstream.capability || null,
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
      capability: item.capability || null,
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
      capability: upstream.capability || null,
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
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, rgba(165,77,45,.18), transparent 28%),
                  linear-gradient(180deg, #efe5d2 0%, var(--bg) 42%, #f8f4ec 100%);
      color: var(--ink);
      font: 15px/1.5 "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .wrap { width: min(960px, calc(100vw - 24px)); margin: 0 auto; padding: 24px 0 48px; }

    .hero, .panel {
      background: rgba(255,253,248,.94);
      border: 1px solid var(--line);
      box-shadow: 0 18px 40px rgba(38,28,18,.08);
      backdrop-filter: blur(8px);
      margin-bottom: 18px;
    }
    .hero { padding: 24px; }
    .hero h1 { margin: 0 0 10px; font: 700 30px/1.15 Georgia, "Times New Roman", serif; }
    .hero-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero code {
      background: #f2e7d3; padding: 4px 10px; border-radius: 8px;
      font-size: 14px; word-break: break-all;
    }
    .gateway-urls { margin-top: 12px; }
    .url-card {
      border: 1px solid var(--line);
      background: rgba(255,253,248,.7); border-radius: 14px; padding: 14px;
      max-width: 520px;
    }
    .url-card .url-card-head { font-weight: 600; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .url-card code { display: block; margin-bottom: 8px; }
    .url-card button { margin-right: 6px; }
    .panel { padding: 20px; }
    .panel h2 { margin: 0 0 14px; font: 700 20px/1.2 Georgia, "Times New Roman", serif; }

    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
    .toolbar h2 { margin: 0; }

    button {
      border: 0; border-radius: 999px; padding: 9px 16px;
      font: 600 13px/1.1 inherit; cursor: pointer;
      background: var(--accent); color: white;
      transition: transform .16s ease, opacity .16s ease;
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
    .mono { font-family: "Cascadia Code", "Fira Code", Consolas, monospace; font-size: 13px; }

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
    .upstream-card summary {
      display: flex; align-items: center; gap: 12px;
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
      font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
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
    .modal-card h3 { margin: 0 0 14px; font: 700 18px/1.2 Georgia, "Times New Roman", serif; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }

    #toast {
      position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
      background: #1f2937; color: #f9fafb; padding: 12px 28px;
      border-radius: 999px; font-size: 14px; font-weight: 600;
      opacity: 0; pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
      z-index: 100;
    }
    #toast.show { opacity: 1; transform: translateX(-50%) translateY(-6px); }
  </style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>LLM Gateway</h1>
    <div class="gateway-urls">
      <div class="url-card">
        <div class="url-card-head">Gateway URL <span class="note">(OpenAI + Claude Compatible)</span></div>
        <code id="gateway-url-pill">loading...</code>
        <button class="small secondary" id="copy-gateway-url">\u590d\u5236</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>\u5ba2\u6237\u7aef Keys</h2>
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
      <button class="secondary" id="refresh-models">\u5237\u65b0\u6a21\u578b\u7f13\u5b58</button>
      <button class="secondary" id="check-health">\u68c0\u67e5\u5065\u5eb7\u5ea6</button>
      <span class="note" id="config-status"></span>
    </div>
    <div id="upstream-list"></div>
  </div>

  <details class="panel settings-panel">
    <summary><h2>\u9ad8\u7ea7\u8bbe\u7f6e</h2></summary>
    <div class="settings-body">
      <div class="row">
        <div class="field span-4"><label>\u8bf7\u6c42\u8d85\u65f6 (ms, \u9ed8\u8ba490000)</label><input id="request-timeout" type="number" min="1000" placeholder="90000"></div>
        <div class="field span-4"><label>\u51b7\u5374 TTL (s, \u9ed8\u8ba460)</label><input id="cooldown-ttl" type="number" min="1" placeholder="60"></div>
        <div class="field span-4"><label>\u6a21\u578b\u7f13\u5b58 TTL (s, \u9ed8\u8ba43600)</label><input id="model-cache-ttl" type="number" min="1" placeholder="3600"></div>
      </div>
      <div class="row">
        <div class="field span-6">
          <label><input type="checkbox" id="routing-load-balance"> \u8d1f\u8f7d\u5747\u8861 (\u9ed8\u8ba4\u5f00)</label>
        </div>
        <div class="field span-6">
          <label><input type="checkbox" id="routing-failover"> \u6545\u969c\u8f6c\u79fb (\u9ed8\u8ba4\u5f00)</label>
        </div>
      </div>
      <button class="good small" id="save-settings">\u4fdd\u5b58\u8bbe\u7f6e</button>
      <span class="note" id="settings-status"></span>
    </div>
  </details>

  <footer style="text-align:center;padding:24px 0;color:var(--muted);font-size:13px;">
    v26-06-30-anthropic ·
    <a href="https://github.com/FisheeHei/Cloudflare-Workers-LLMmerge" style="color:var(--accent);">FisheeHei/Cloudflare-Workers-LLMmerge</a>
    · by FisheeHei
  </footer>
</div>

<div id="toast"></div>

<div class="modal-backdrop" id="vendor-modal">
  <div class="modal-card">
    <h3>\u6dfb\u52a0\u4e0a\u6e38</h3>
    <div class="row">
      <div class="field span-12"><label>\u6a21\u677f</label><select id="vendor-preset"></select></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>\u5907\u6ce8</label><input id="vendor-note" placeholder="\u6211\u7684 NVIDIA key"></div>
      <div class="field span-6"><label>\u5185\u90e8\u540d\u79f0</label><input id="vendor-name" placeholder="nim-main (\u53ef\u7701\u7565)"></div>
    </div>
    <div class="row">
      <div class="field span-6"><label>Base URL</label><input id="vendor-base-url" placeholder="https://..."></div>
      <div class="field span-6"><label>API Key</label><input id="vendor-api-key" class="mono" placeholder="nvapi-... \u6216 sk-..."></div>
    </div>
    <div class="row">
      <div class="field span-4"><label>\u6a21\u578b (\u9017\u53f7\u5206\u9694, \u7559\u7a7a=\u81ea\u52a8)</label><input id="vendor-models" placeholder="model-a, model-b"></div>
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

<script>
  const API_BASE = location.pathname.replace(/\\/+$/, "") + "/api";
  const state = { config: null, presets: [], clients: [], gateway: null, draftPresetId: null, lastCreatedClient: null };
  const byId = (id) => document.getElementById(id);
  const text = (value) => String(value ?? "");

  function splitList(value) { return text(value).split(/[,\\n]/).map((s) => s.trim()).filter(Boolean); }
  function esc(value) { return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function presetById(id) { return state.presets.find((p) => p.id === id) || state.presets.find((p) => p.id === "custom") || state.presets[0]; }
  function baseUrlLocked(presetId) { const p = presetById(presetId); return !!p && p.requires_base_url === false; }

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

  function showError(error) {
    console.error(error);
    showToast(error.message || "Error");
  }

  /* ---- Modal ---- */
  function openVendorModal() {
    if (!state.draftPresetId && state.presets.length) state.draftPresetId = state.presets[0].id;
    renderPresets();
    applyVendorPreset();
    ["vendor-note","vendor-name","vendor-api-key","vendor-models"].forEach((id) => byId(id).value = "");
    byId("vendor-weight").value = "1"; byId("vendor-enabled").value = "true";
    byId("vendor-modal").classList.add("open");
  }
  function closeVendorModal() { byId("vendor-modal").classList.remove("open"); }

  function renderPresets() {
    const sel = byId("vendor-preset");
    sel.innerHTML = state.presets.map((p) =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.requires_base_url === false ? ' (\u9884\u8bbe ' + esc(p.base_url || "") + ')' : ' (\u81ea\u5b9a\u4e49)') + '</option>'
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
    const preset = presetById(state.draftPresetId);
    if (!preset) return;
    const locked = preset.requires_base_url === false;
    baseInput.readOnly = locked;
    baseInput.value = locked ? (preset.base_url || "") : "";
    pathsInput.value = (preset.paths || []).join(", ");
  }

  function createVendorFromModal() {
    const presetId = state.draftPresetId || "custom";
    const note = byId("vendor-note").value.trim();
    const name = byId("vendor-name").value.trim();
    const baseUrl = byId("vendor-base-url").value.trim();
    const apiKey = byId("vendor-api-key").value.trim();
    const suffix = Math.random().toString(36).slice(2, 7);

    if (!apiKey) throw new Error("API Key \u4e0d\u80fd\u4e3a\u7a7a");
    if (!baseUrl) throw new Error("Base URL \u4e0d\u80fd\u4e3a\u7a7a");

    state.config.upstreams.push({
      id: crypto.randomUUID ? crypto.randomUUID() : "u-" + suffix,
      preset: presetId,
      note, name: name || presetId + "-" + suffix,
      base_url: baseUrl, api_key_value: apiKey,
      models: splitList(byId("vendor-models").value),
      paths: splitList(byId("vendor-paths").value),
      weight: Number(byId("vendor-weight").value || 1),
      priority: 100, enabled: byId("vendor-enabled").value === "true",
    });

    renderUpstreams(); closeVendorModal();
    ["vendor-note","vendor-name","vendor-api-key","vendor-models"].forEach((id) => byId(id).value = "");
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
      const presetOptions = state.presets.map((pr) =>
        '<option value="' + esc(pr.id) + '"' + (pr.id === item.preset ? ' selected' : '') + '>' + esc(pr.name) + '</option>'
      ).join("");

      return '<details class="upstream-card" data-id="' + esc(item.id) + '">' +
        '<summary>' +
          '<span class="card-badge">' + esc(badge) + '</span>' +
          '<strong>' + esc(item.note || item.name || "\u672a\u547d\u540d") + '</strong>' +
          '<span class="health-dot" data-upstream="' + esc(item.name) + '"></span>' +
          (item.preset === "custom" || item.preset === "generic-openai" || item.preset === "claude-openai" ? '<span class="capability-badge" data-upstream="' + esc(item.name) + '">' + (item.capability === "openai" ? '\u2713 OpenAI' : item.capability === "claude" ? 'Claude' : '\u672a\u68c0\u6d4b') + '</span>' : '') +
          '<span class="card-meta">\u6743\u91cd:' + esc(item.weight) + ' | \u4f18\u5148:' + esc(item.priority) + ' | ' + (item.enabled ? '\u2713' : '\u2717') + '</span>' +
        '</summary>' +
        '<div class="card-body">' +
          '<div class="row">' +
            '<div class="field span-4"><label>\u6a21\u677f</label><select data-field="preset">' + presetOptions + '</select></div>' +
            '<div class="field span-4"><label>\u5907\u6ce8</label><input data-field="note" value="' + esc(item.note) + '"></div>' +
            '<div class="field span-4"><label>\u5185\u90e8\u540d\u79f0</label><input data-field="name" value="' + esc(item.name) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-6"><label>Base URL' + (locked ? ' (\u9884\u8bbe)' : '') + '</label><input data-field="base_url" value="' + esc(item.base_url) + '"' + (locked ? ' readonly' : '') + '></div>' +
            '<div class="field span-6"><label>API Key (\u4fdd\u5b58\u540e\u663e\u793a\u5bc6\u6587)</label><input class="mono" data-field="api_key_value" value="' + esc(item.api_key_value) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-3"><label>\u6743\u91cd</label><input data-field="weight" type="number" min="1" value="' + esc(item.weight) + '"></div>' +
            '<div class="field span-3"><label>\u4f18\u5148\u7ea7</label><input data-field="priority" type="number" value="' + esc(item.priority) + '"></div>' +
            '<div class="field span-3"><label>\u542f\u7528</label><select data-field="enabled"><option value="true"' + (item.enabled ? ' selected' : '') + '>\u662f</option><option value="false"' + (!item.enabled ? ' selected' : '') + '>\u5426</option></select></div>' +
            '<div class="field span-3"><label>\u8def\u5f84</label><input data-field="paths" value="' + esc((item.paths || []).join(", ")) + '"></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field span-12"><label>\u6a21\u578b (\u6bcf\u884c\u4e00\u4e2a, \u7559\u7a7a=\u81ea\u52a8)</label><textarea data-field="models">' + esc((item.models || []).join("\\n")) + '</textarea></div>' +
          '</div>' +
          '<button type="button" class="danger small delete-upstream">\u5220\u9664\u4e0a\u6e38</button>' +
          (item.preset === "custom" || item.preset === "generic-openai" || item.preset === "claude-openai" ? '<button type="button" class="secondary small detect-upstream" data-upstream="' + esc(item.name) + '">\u68c0\u6d4b\u80fd\u529b</button>' : '') +
        '</div>' +
      '</details>';
    }).join("");

    host.querySelectorAll(".detect-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        await withButtonBusy(btn, "\u68c0\u6d4b\u4e2d...", () => detectCapability(btn.dataset.upstream));
      });
    });
    host.querySelectorAll(".delete-upstream").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        const card = btn.closest(".upstream-card");
        await withButtonBusy(btn, "\u5220\u9664\u4e2d...", async () => {
          state.config.upstreams = state.config.upstreams.filter((u) => u.id !== card.dataset.id);
          renderUpstreams();
          showToast("\u5df2\u5220\u9664\u4e0a\u6e38");
        });
      });
    });

    host.querySelectorAll('select[data-field="preset"]').forEach((sel) => {
      sel.addEventListener("change", () => {
        const card = sel.closest(".upstream-card");
        const p = presetById(sel.value);
        const baseInput = card.querySelector('[data-field="base_url"]');
        const pathsInput = card.querySelector('[data-field="paths"]');
        baseInput.readOnly = !!p && p.requires_base_url === false;
        if (p && p.requires_base_url === false) baseInput.value = p.base_url || "";
        pathsInput.value = (p?.paths || []).join(", ");
      });
    });
  }

  function collectConfig() {
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
      upstreams: [...document.querySelectorAll(".upstream-card")].map((card) => ({
        id: card.dataset.id,
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
      })),
    };
  }

  /* ---- Settings ---- */
  function renderSettings() {
    byId("request-timeout").value = state.config.settings.request_timeout_ms;
    byId("cooldown-ttl").value = state.config.settings.upstream_cooldown_ttl;
    byId("model-cache-ttl").value = state.config.settings.model_cache_ttl;
    byId("routing-load-balance").checked = state.config.routing.load_balance !== false;
    byId("routing-failover").checked = state.config.routing.failover !== false;
    byId("gateway-url-pill").textContent = state.gateway.base_url;
  }

  async function loadConfig() {
    const resp = await fetch(API_BASE + "/config");
    const payload = await parseApiResponse(resp);
    if (!resp.ok) throw new Error(payload?.error?.message || "\u8bfb\u53d6\u914d\u7f6e\u5931\u8d25");
    state.config = payload.config;
    state.presets = payload.presets;
    state.gateway = payload.gateway;
    renderSettings();
    renderUpstreams();
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
    showToast("\u914d\u7f6e\u5df2\u4fdd\u5b58");
    byId("config-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("config-status").textContent = "", 3000);
  }

  async function saveSettings() {
    await saveConfig();
    byId("settings-status").textContent = "\u2713 \u5df2\u4fdd\u5b58";
    setTimeout(() => byId("settings-status").textContent = "", 3000);
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
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeVendorModal(); });
      byId("open-vendor-modal").addEventListener("click", openVendorModal);
      byId("close-vendor-modal").addEventListener("click", closeVendorModal);

      byId("create-vendor").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u6dfb\u52a0\u4e2d...", async () => {
          createVendorFromModal();
          showToast("\u4e0a\u6e38\u5df2\u6dfb\u52a0");
        }).catch(showError)
      );
      byId("save-config").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveConfig).catch(showError)
      );
      byId("save-settings").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u4fdd\u5b58\u4e2d...", saveSettings).catch(showError)
      );
      byId("refresh-models").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u5237\u65b0\u4e2d...", refreshModels).catch(showError)
      );
      byId("check-health").addEventListener("click", (e) =>
        withButtonBusy(e.currentTarget, "\u68c0\u67e5\u4e2d...", checkHealth).catch(showError)
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

      await loadConfig();
      await loadClients();
    } catch (error) { showError(error); }
  }

  boot();
</script>
</body>
</html>`;
}

