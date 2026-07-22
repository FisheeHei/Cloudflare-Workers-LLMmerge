import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const worker = await import(`${pathToFileURL(`${process.cwd()}/_worker.js`).href}?t=${Date.now()}`);
const keepaliveEncoder = new TextEncoder();
const keepaliveText = await new Response(worker.withSseKeepAlive(new ReadableStream({
  start(controller) {
    setTimeout(() => {
      controller.enqueue(keepaliveEncoder.encode("data: [DONE]\n\n"));
      controller.close();
    }, 30);
  },
}), 5)).text();
assert.equal(keepaliveText.includes(": keepalive\n\n"), true);
assert.equal(keepaliveText.includes("data: [DONE]"), true);
const cancelledText = await new Response(worker.withSseKeepAlive(new ReadableStream({
  start(controller) {
    controller.enqueue(keepaliveEncoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
    setTimeout(() => controller.error(new Error("CANCEL")), 5);
  },
}), 50)).text();
assert.equal(cancelledText.includes('"content":"hi"'), true);
assert.equal(cancelledText.endsWith("data: [DONE]\n\n"), true);

const bodies = [];
const zhipuBodies = [];
const fetchUrls = [];
const speedHits = [];
const speedBodies = [];
const speedStreamHits = [];
const hedgeHits = [];
const hedgeStreamHits = [];
const softFastHits = [];
const nimHits = [];
const responseHits = [];
const responseStreamHits = [];
const anthropicHits = [];
const anthropicStreamHits = [];
const delayedAnthropicHits = [];
const cloudflare524Hits = [];
let releaseDelayedAnthropic = null;
const paymentHits = [];
const degradedHits = [];
const missingFunctionHits = [];
const disabledHits = [];
const longStreamHits = [];
const usageHits = [];
const wrappedHits = [];
const toolStreamHits = [];
const appErrorHits = [];
const htmlHits = [];
const analyticsPoints = [];
const analyticsSqlQueries = [];
const kvPuts = [];
const kvStore = new Map();
globalThis.fetch = async (url, init) => {
  fetchUrls.push(String(url));
  if (String(url).includes("stdtime.gov.hk")) {
    return new Response(null, {
      status: 200,
      headers: { date: "Sat, 04 Jul 2026 04:00:00 GMT" },
    });
  }
  if (String(url).includes("/analytics_engine/sql")) {
    const sql = String(init.body || "");
    analyticsSqlQueries.push(sql);
    const data = sql.includes("GROUP BY hour")
      ? [{
        hour: "2026-07-04:12",
        upstream: "nim",
        model: "qwen3",
        total: 2,
        success: 1,
        fail: 1,
        prompt_tokens: 30,
        completion_tokens: 40,
      }]
      : [{
        timestamp: "2026-07-04 12:00:00",
        client: "c",
        upstream: "nim",
        model: "qwen3",
        path: "/v1/chat/completions",
        status: 200,
        latency_ms: 123,
        prompt_tokens: 10,
        completion_tokens: 20,
      }];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("disabled.example")) {
    disabledHits.push(String(url));
    return new Response(JSON.stringify({ data: [{ id: "disabled-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("usage-stream.example")) {
    usageHits.push("stream");
    return new Response([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":9,"total_tokens":16}}\n\n',
      'data: [DONE]\n\n',
    ].join(""), { status: 200, headers: { "content-type": "text/event-stream", "content-length": "999", "content-encoding": "gzip" } });
  }
  if (String(url).includes("usage.example")) {
    usageHits.push("json");
    return new Response(JSON.stringify({
      id: "usage",
      choices: [{ message: { content: "hello world" } }],
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    }), { status: 200, headers: { "content-type": "application/json", "content-length": "999", "content-encoding": "gzip" } });
  }
  if (String(url).includes("tool-call.example")) {
    return new Response(JSON.stringify({
      id: "tool-call",
      choices: [{ message: { tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("tool-stream.example")) {
    toolStreamHits.push("stream");
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"web_search","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n'));
      },
      cancel() {
        toolStreamHits.push("cancel");
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (String(url).includes("long-stream.example")) {
    longStreamHits.push("stream");
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        let sent = 0;
        const timer = setInterval(() => {
          if (init.signal?.aborted) {
            clearInterval(timer);
            controller.error(new Error("aborted"));
            return;
          }
          sent += 1;
          controller.enqueue(encoder.encode("x"));
          if (sent >= 5) {
            clearInterval(timer);
            controller.close();
          }
        }, 30);
      },
    }), { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (String(url).includes("degraded.example")) {
    degradedHits.push("degraded");
    return new Response("Function id '52e1ddb6-c745-4802-93f5-ba012d04c336': DEGRADED function cannot be invoked", {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }
  if (String(url).includes("missing-function.example")) {
    missingFunctionHits.push("missing");
    return new Response("Function id '52e1ddb6-c745-4802-93f5-ba012d04c336' version 'null': Specified function in account '6FqBGWPAdZEeL3QCvtuur-yTruZLNotqWzKfevWopTc' is not found", {
      status: 400,
      headers: { "content-type": "text/plain" },
    });
  }
  if (String(url).includes("payment-required.example")) {
    paymentHits.push("402");
    return new Response(JSON.stringify({ detail: [{ error: "You need positive balance to do inference." }] }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("app-error.example")) {
    appErrorHits.push("200-error");
    return new Response(JSON.stringify({ error: { message: "Internal server error" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("html-error.example")) {
    htmlHits.push("html");
    return new Response("<!DOCTYPE html><html><body>bad gateway</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }
  if (String(url).includes("responses-stream.example")) {
    const body = JSON.parse(init.body);
    responseStreamHits.push(body);
    if (body.model === "stream-error-model") {
      return new Response('data: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"plan "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_stream_search","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"glm\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (String(url).includes("responses.example")) {
    responseHits.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      id: "chatcmpl-resp",
      choices: [{ message: { reasoning_content: "plan first", content: "hello", tool_calls: [{ id: "call_search", type: "function", function: { name: "web_search", arguments: "{\"query\":\"glm\"}" } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("anthropic-stream.example")) {
    const body = JSON.parse(init.body);
    anthropicStreamHits.push(body);
    if (body.model === "anthropic-error-model") {
      return new Response('data: {"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const chunks = [
      { choices: [{ delta: { reasoning_content: "Checking sources. " } }] },
      { choices: [{ delta: { content: "Checking " } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_stream", type: "function", function: { name: "web_search", arguments: "{\"query\":" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"glm\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 13, completion_tokens: 5 } },
    ];
    return new Response(chunks.map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n").join(""), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (String(url).includes("anthropic-delayed.example")) {
    delayedAnthropicHits.push(JSON.parse(init.body));
    await new Promise((resolve) => { releaseDelayedAnthropic = resolve; });
    return new Response('data: {"choices":[{"delta":{"content":"late"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  if (String(url).includes("anthropic-reset.example")) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
        setTimeout(() => controller.error(new Error("CANCEL")), 5);
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (String(url).includes("cloudflare-524.example")) {
    cloudflare524Hits.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ title: "Error 524: A timeout occurred", status: 524, detail: "origin_response_timeout" }), {
      status: 524,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("anthropic.example")) {
    anthropicHits.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      id: "chatcmpl-anthropic",
      model: "anthropic-model",
      choices: [{
        message: {
          reasoning_content: "I should use a tool.",
          content: "I will search.",
          tool_calls: [{ id: "call_search", type: "function", function: { name: "web_search", arguments: "{\"query\":\"llm\"}" } }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 17, completion_tokens: 8, total_tokens: 25 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("hedge-slow.example")) {
    hedgeHits.push("slow");
    await new Promise((resolve) => setTimeout(resolve, 260));
    return new Response(JSON.stringify({ id: "hedge-slow", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("hedge-stream-slow.example")) {
    hedgeStreamHits.push("slow");
    return new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          if (init.signal?.aborted) {
            controller.error(new Error("aborted"));
            return;
          }
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"slow"}}]}\n\n'));
          controller.close();
        }, 350);
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (String(url).includes("hedge-stream-fast.example")) {
    hedgeStreamHits.push("fast");
    return new Response('data: {"choices":[{"delta":{"content":"fast"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (String(url).includes("hedge-fast.example")) {
    hedgeHits.push("fast");
    return new Response(JSON.stringify({ id: "hedge-fast", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("soft-fast-slow.example")) {
    softFastHits.push("slow");
    await new Promise((resolve) => setTimeout(resolve, 260));
    return new Response(JSON.stringify({ id: "soft-fast-slow", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("soft-fast-fast.example")) {
    softFastHits.push("fast");
    return new Response(JSON.stringify({ id: "soft-fast-fast", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("soft-fast-third.example")) {
    softFastHits.push("third");
    await new Promise((resolve) => setTimeout(resolve, 260));
    return new Response(JSON.stringify({ id: "soft-fast-third", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("nim-limit.example")) {
    nimHits.push("nim");
    return new Response(JSON.stringify({ id: "nim", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("health-auth.example")) {
    return new Response(JSON.stringify({ error: { message: "invalid token" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("kv-wrapped.example")) {
    wrappedHits.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "wrapped", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("speed-slow.example")) {
    speedHits.push("slow");
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ id: "slow", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("speed-stream.example")) {
    speedStreamHits.push("start");
    return new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n')), 5);
      },
      cancel() {
        speedStreamHits.push("cancel");
      },
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (String(url).includes("speed-fast.example")) {
    speedHits.push("fast");
    speedBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "fast", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("slow-first-byte.example")) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (init.signal?.aborted) throw new Error("aborted before first byte");
    return new Response(JSON.stringify({ id: "slow-first-byte", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("boom.example")) {
    throw new Error("network down");
  }
  if (String(url).includes("/ai/models/search")) {
    const page = Number(new URL(String(url)).searchParams.get("page") || 1);
    const result = page === 1
      ? Array.from({ length: 100 }, (_, i) => ({ name: `@cf/test/page-one-${i}` }))
      : [
        { name: "@cf/deepseek-ai/deepseek-v4-pro" },
        { id: "google/codegemma-7b" },
        { name: "not-a-workers-ai-model" },
      ];
    return new Response(JSON.stringify({ result, result_info: { total_count: 102, total_pages: 2 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("open.bigmodel.cn")) {
    zhipuBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "glm", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).endsWith("/models")) {
    return new Response(JSON.stringify({ data: [
      { id: "deepseek-ai/deepseek-v4-pro" },
      { id: "google/codegemma-7b" },
    ] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  bodies.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: "ok", choices: [{ message: { content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const env = {
  KV: {
    async get(key, type) {
      const value = kvStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) {
      kvPuts.push(key);
      kvStore.set(key, value);
    },
    async delete(key) {
      kvStore.delete(key);
    },
  },
  UPSTREAMS_JSON: JSON.stringify([
    { name: "nim", base_url: "https://integrate.api.nvidia.com/v1", api_key: "x", models: ["*"], paths: ["/v1/chat/completions"], headers: { "x-test": "1" } },
    { name: "ai", base_url: "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1", api_key: "y", models: ["*"], paths: ["/v1/chat/completions"], preset: "workers-ai", account_id: "acc123" },
    { name: "ai-old", base_url: "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1", api_key: "z", models: ["*"], paths: ["/v1/chat/completions"] },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "c", key: "sk-test", models: ["*"], upstreams: ["nim"] }]),
};

const adminPageResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin"), env);
const adminPage = await adminPageResp.text();
const adminScript = adminPage.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
assert.doesNotThrow(() => new Function(adminScript));
assert.equal(adminPage.includes("routing-fast"), true);
assert.equal(adminPage.includes("document.visibilityState"), true);
assert.equal(adminPage.includes("Fast \\u52a0\\u901f\\u524d 2 \\u4e2a") || adminPage.includes("Fast 加速前 2 个"), true);
assert.equal(adminPage.includes("upstream-status-emoji"), true);
assert.equal(adminPage.includes("upstream-group-active"), true);
assert.equal(adminPage.includes("client-models"), false);
assert.equal(adminPage.includes("data-client-save"), false);
assert.equal(adminPage.includes("picker-apply-same-preset"), true);
assert.equal(adminPage.includes("class=\"apply-models-same-preset\""), false);
assert.equal(adminPage.includes("toggle-log-expanded"), true);
assert.equal(adminPage.includes("data-log-filter"), true);
assert.equal(adminPage.includes("input / "), true);
assert.equal(adminPage.includes("system-prompt-modal"), true);
assert.equal(adminPage.includes("global-context-input"), true);
assert.equal(adminPage.includes("system-prompt-client-scope"), true);
assert.equal(adminPage.includes("subagent-prompt-client-scope"), true);
assert.equal(adminPage.includes("global-context-client-scope"), true);
assert.equal(adminPage.includes("prompt-splitter-input"), true);
assert.equal(adminPage.includes("splitPromptContextDraft"), true);
assert.equal(adminPage.includes("context-on-demand"), true);
assert.equal(adminPage.includes("context-items"), true);
assert.equal(adminPage.includes("classifyContextItemsDraft"), true);
assert.equal(adminPage.includes("export-prompt-config"), true);
assert.equal(adminPage.includes("import-prompt-file"), true);
assert.equal(adminPage.includes("export-context-items"), true);
assert.equal(adminPage.includes("import-context-file"), true);
assert.equal(adminPage.includes("180000"), true);
assert.equal(adminPage.includes("stream-idle-timeout"), true);
assert.equal(adminPage.includes("900000"), true);
assert.equal(adminPage.includes("@media (max-width: 700px)"), true);
assert.equal(adminPage.includes("id=\"stat-tip\""), true);
assert.equal(adminPage.includes("data-stat-kind"), true);
assert.equal(adminPage.includes("bar-hit"), true);
assert.equal(adminPage.includes("model-tag-filter"), true);
assert.equal(adminPage.includes("renderModelTags"), true);
assert.equal(adminPage.includes("}, 2000);"), true);
assert.equal(adminPage.includes("width: min(1216px"), true);
assert.equal(adminPage.includes(".picker-actions button.small"), true);
assert.equal(adminPage.includes("EXCLUSIVE_MODEL_TAGS"), true);
assert.equal(adminPage.includes("toggleModelTag"), true);
assert.equal(adminPage.includes("\u63a8\u7406"), true);
assert.equal(adminPage.includes("\u6df1\u5ea6\u601d\u8003"), false);
assert.equal(adminPage.includes("Agentic"), true);
assert.equal(adminPage.includes("\u5de5\u5177\u8c03\u7528"), true);
assert.equal(adminPage.includes("\u2705"), true);
assert.equal(adminPage.includes(".model-tag-filter button.active { background: #1f8f61; color: white; }"), true);

const privateModelsResp = await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: "Bearer sk-test" },
}), env);
assert.equal(privateModelsResp.headers.get("cache-control"), "private, max-age=30");

assert.equal(adminPage.includes("upstream-enable-toggle"), true);
assert.equal(adminPage.includes("upstream-group"), true);
assert.equal(adminPage.includes("model-entry-list"), true);
assert.equal(adminPage.includes("model-context-input"), true);
assert.equal(adminPage.includes("delete-model-row"), true);
assert.equal(adminPage.includes("toolDiag"), true);
const configResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config"), env);
const configPayload = await configResp.json();
assert.equal(configPayload.config.settings.stream_idle_timeout_ms, 900000);
const openRouterPreset = configPayload.presets.find((item) => item.id === "openrouter");
assert.equal(openRouterPreset.name, "OpenRouter");
assert.equal(openRouterPreset.base_url, "https://openrouter.ai/api/v1");
const moonshotPreset = configPayload.presets.find((item) => item.id === "moonshot");
assert.equal(moonshotPreset.name, "Kimi / \u6708\u4e4b\u6697\u9762");
assert.equal(moonshotPreset.base_url, "https://api.moonshot.ai/v1");
const minimaxPreset = configPayload.presets.find((item) => item.id === "minimax");
assert.equal(minimaxPreset.name, "MiniMax");
assert.equal(minimaxPreset.base_url, "https://api.minimax.io/v1");
const zhipuPreset = configPayload.presets.find((item) => item.id === "zhipu");
assert.equal(zhipuPreset.name, "GLM / \u667a\u8c31 AI");
assert.equal(zhipuPreset.base_url, "https://open.bigmodel.cn/api/paas/v4");
const zhipuCodingPreset = configPayload.presets.find((item) => item.id === "zhipu-coding");
assert.equal(zhipuCodingPreset.base_url, "https://open.bigmodel.cn/api/coding/paas/v4");

const zhipuStore = new Map();
zhipuStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "glm", preset: "zhipu", base_url: "https://open.bigmodel.cn/api/paas/v4", api_key_encrypted: "g", models: ["glm-4.6"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const zhipuEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = zhipuStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { zhipuStore.set(key, value); },
    async delete(key) { zhipuStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "glm-client", key: "sk-glm", models: ["*"], upstreams: ["glm"] }]),
};
const zhipuUrlStart = fetchUrls.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-glm", "content-type": "application/json" },
  body: JSON.stringify({ model: "glm-4.6", messages: [] }),
}), zhipuEnv);
assert.equal(fetchUrls.slice(zhipuUrlStart).some((url) => url.includes("/api/paas/v4/chat/completions")), true);
assert.equal(fetchUrls.slice(zhipuUrlStart).some((url) => url.includes("/api/paas/v4/v1/chat/completions")), false);
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-glm", "content-type": "application/json" },
  body: JSON.stringify({ model: "glm-4.6", messages: [], reasoningEffort: "medium", enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, functions: [{ name: "search", parameters: {} }], function_call: "auto" }),
}), zhipuEnv);
assert.deepEqual(zhipuBodies.at(-1).thinking, { type: "enabled" });
assert.equal(zhipuBodies.at(-1).reasoning_effort, "medium");
assert.equal(Array.isArray(zhipuBodies.at(-1).tools), true);
assert.equal("reasoning" in zhipuBodies.at(-1), false);
assert.equal("enable_thinking" in zhipuBodies.at(-1), false);
assert.equal("chat_template_kwargs" in zhipuBodies.at(-1), false);
assert.equal("functions" in zhipuBodies.at(-1), false);

const healthTimeResp = await worker.default.fetch(new Request("https://gw.test/health"), env);
const healthTime = await healthTimeResp.json();
assert.equal(healthTime.time_zone, "Hong Kong Standard Time (UTC+8)");
assert.equal(healthTime.now.endsWith("+08:00"), true);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [], reasoning_split: true, enable_thinking: true, thinking: {} }),
}), env);

assert.equal("reasoning_split" in bodies[0], false);
assert.equal("enable_thinking" in bodies[0], false);
assert.equal("thinking" in bodies[0], false);
assert.equal(bodies[0].chat_template_kwargs.enable_thinking, true);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [], reasoningEffort: "high" }),
}), env);

assert.equal(bodies[1].chat_template_kwargs.enable_thinking, true);
assert.equal("reasoningEffort" in bodies[1], false);
assert.equal("reasoning_effort" in bodies[1], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "minimax-m3", messages: [], reasoning_split: true, enable_thinking: true }),
}), env);

assert.equal("reasoning_split" in bodies[2], false);
assert.equal("enable_thinking" in bodies[2], false);
assert.equal(bodies[2].chat_template_kwargs.thinking_mode, "adaptive");

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-reasoner", messages: [], reasoningEffort: "high", reasoningSummary: "auto" }),
}), env);

assert.equal(bodies[3].reasoning_effort, "high");
assert.equal("reasoning" in bodies[3], false);
assert.equal("reasoningEffort" in bodies[3], false);
assert.equal("reasoningSummary" in bodies[3], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-reasoner", messages: [], providerOptions: { openai: { reasoningEffort: "medium", reasoningSummary: "auto", reasoning: { effort: "medium" } } } }),
}), env);

assert.equal(bodies[4].reasoning_effort, "high");
assert.equal("reasoning" in bodies[4], false);
assert.equal("providerOptions" in bodies[4], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "minimax-m3", messages: [], reasoningEffort: "high" }),
}), env);

assert.equal(bodies[5].chat_template_kwargs.thinking_mode, "enabled");
assert.equal("reasoningEffort" in bodies[5], false);
assert.equal("reasoning_effort" in bodies[5], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "glm-4.6", messages: [], reasoning: { effort: "high" }, reasoningEffort: "high", thinking: {} }),
}), env);

assert.equal("reasoning" in bodies[6], false);
assert.equal("reasoning_effort" in bodies[6], false);
assert.equal("reasoningEffort" in bodies[6], false);
assert.equal("thinking" in bodies[6], false);

const statsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/stats"), env);
const stats = await statsResp.json();
assert.equal(stats.buckets.some((b) => b.total >= 5), true);
assert.equal(stats.last_model, "glm-4.6");
assert.equal(stats.time_zone, "Hong Kong Standard Time (UTC+8)");
assert.equal(stats.now.endsWith("+08:00"), true);
assert.equal(stats.buckets.some((b) => b.model_statuses?.["minimax-m3"]?.success >= 1), true);

const logsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), env);
const logs = await logsResp.json();
assert.equal(logs.logs.some((entry) => entry.model === "glm-4.6"), true);
assert.equal(kvPuts.length, 0);

const createdClientResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/clients", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "temporary-client" }),
}), env);
const createdClient = (await createdClientResp.json()).client;
assert.equal((await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: `Bearer ${createdClient.api_key}` },
}), env)).status, 200);
const updateClientResp = await worker.default.fetch(new Request(`https://gw.test/llmmerge-admin/api/clients/${createdClient.id}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ models: ["glm-4.6"] }),
}), env);
assert.equal(updateClientResp.status, 200);
const updatedClient = (await updateClientResp.json()).client;
assert.deepEqual(updatedClient.models, ["glm-4.6"]);
const deniedAfterUpdateResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${createdClient.api_key}`, "content-type": "application/json" },
  body: JSON.stringify({ model: "gpt-5", messages: [] }),
}), env);
assert.equal(deniedAfterUpdateResp.status, 403);
await worker.default.fetch(new Request(`https://gw.test/llmmerge-admin/api/clients/${createdClient.id}`, { method: "DELETE" }), env);
assert.equal((await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: `Bearer ${createdClient.api_key}` },
}), env)).status, 401);

const restrictedEnv = {
  ...env,
  KV: null,
  UPSTREAMS_JSON: JSON.stringify([
    { name: "nim-restricted", preset: "nvidia-nim", base_url: "https://integrate.api.nvidia.com/v1", api_key: "x", models: ["z-ai/glm-5.2", "openai/gpt-oss-120b"], paths: ["/v1/chat/completions"] },
  ]),
  CLIENTS_JSON: JSON.stringify([
    { name: "glm-only", key: "sk-glm-only", models: ["z-ai/glm-5.2"], upstreams: ["nim-restricted"] },
    { name: "session-locked", key: "sk-session-locked", models: ["*"], upstreams: ["nim-restricted"] },
  ]),
};
const restrictedModelsResp = await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: "Bearer sk-glm-only" },
}), restrictedEnv);
const restrictedModels = await restrictedModelsResp.json();
assert.equal(restrictedModels.data.some((item) => item.id.includes("glm-5.2")), true);
assert.equal(restrictedModels.data.some((item) => item.id.includes("gpt-oss")), false);
const allowedAliasResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-glm-only", "content-type": "application/json" },
  body: JSON.stringify({ model: "nvidia-nim/glm-5.2", messages: [] }),
}), restrictedEnv);
assert.equal(allowedAliasResp.status, 200);
const upstreamCallsBeforeDenied = bodies.length;
for (const [path, body] of [
  ["/v1/chat/completions", { model: "openai/gpt-oss-120b", messages: [] }],
  ["/v1/responses", { model: "openai/gpt-oss-120b", input: "hi" }],
  ["/v1/messages", { model: "openai/gpt-oss-120b", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }],
]) {
  const denied = await worker.default.fetch(new Request(`https://gw.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer sk-glm-only", "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  }), restrictedEnv);
  assert.equal(denied.status, 403);
}
assert.equal(bodies.length, upstreamCallsBeforeDenied);

const sessionHeaders = {
  authorization: "Bearer sk-session-locked", "content-type": "application/json", "session-id": "codex-session-mixed",
  "x-codex-turn-metadata": JSON.stringify({ session_id: "codex-session-mixed", turn_id: "turn-glm" }),
};
assert.equal((await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST", headers: sessionHeaders,
  body: JSON.stringify({ model: "z-ai/glm-5.2", input: "hi" }),
}), restrictedEnv)).status, 200);
const deniedSessionSwitch = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST", headers: sessionHeaders,
  body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "switch" }),
}), restrictedEnv);
assert.equal(deniedSessionSwitch.status, 403);
assert.equal((await deniedSessionSwitch.text()).includes("locked to model: z-ai/glm-5.2"), true);
assert.equal((await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST", headers: { ...sessionHeaders, "x-codex-turn-metadata": JSON.stringify({ session_id: "codex-session-mixed", turn_id: "turn-gpt" }) },
  body: JSON.stringify({ model: "openai/gpt-oss-120b", input: "next turn" }),
}), restrictedEnv)).status, 200);

const kimiBodyStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "moonshotai/kimi-k2-thinking", messages: [] }),
}), env);
assert.deepEqual(bodies[kimiBodyStart].thinking, { type: "enabled", keep: "all" });

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "moonshotai/kimi-k2.7-code", messages: [] }),
}), env);
assert.equal("thinking" in bodies[kimiBodyStart + 1], false);

const nimFamilyBodyStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-ai/deepseek-r1", messages: [], reasoningEffort: "max", reasoningSummary: "auto" }),
}), env);
assert.equal(bodies[nimFamilyBodyStart].reasoning_effort, "max");
assert.equal("reasoning" in bodies[nimFamilyBodyStart], false);
assert.equal("reasoningEffort" in bodies[nimFamilyBodyStart], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "stepfun/step-3", messages: [], reasoning: { effort: "medium" } }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 1].reasoning_effort, "medium");
assert.equal("reasoning" in bodies[nimFamilyBodyStart + 1], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "moonshotai/kimi-k2.5", messages: [], reasoningEffort: "none" }),
}), env);
assert.deepEqual(bodies[nimFamilyBodyStart + 2].thinking, { type: "disabled" });
assert.equal("reasoning_effort" in bodies[nimFamilyBodyStart + 2], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "nvidia/nemotron-3-ultra", messages: [], reasoningEffort: "low", reasoningBudget: 4096 }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 3].chat_template_kwargs.enable_thinking, true);
assert.equal(bodies[nimFamilyBodyStart + 3].chat_template_kwargs.low_effort, true);
assert.equal(bodies[nimFamilyBodyStart + 3].reasoning_budget, 4096);
assert.equal("reasoning_effort" in bodies[nimFamilyBodyStart + 3], false);
assert.equal("reasoningBudget" in bodies[nimFamilyBodyStart + 3], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "mistralai/mistral-medium-3", messages: [], thinking: { type: "enabled" } }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 4].reasoning_effort, "high");
assert.equal("thinking" in bodies[nimFamilyBodyStart + 4], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "openai/gpt-oss-120b", messages: [], reasoningEffort: "medium" }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 5].reasoning_effort, "medium");

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "sarvamai/sarvam-m", messages: [], enable_thinking: true }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 6].reasoning_effort, "high");
assert.equal("enable_thinking" in bodies[nimFamilyBodyStart + 6], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "nvidia/llama-nemotron-ultra", messages: [], reasoning: { effort: "medium" } }),
}), env);
assert.equal(bodies[nimFamilyBodyStart + 7].reasoning_effort, "medium");
assert.equal("reasoning" in bodies[nimFamilyBodyStart + 7], false);

const deepSeekOfficialEnv = {
  ...env,
  KV: {
    async get() { return null; },
    async put() {},
    async delete() {},
  },
  UPSTREAMS_JSON: JSON.stringify([
    { name: "deepseek-official", preset: "deepseek", base_url: "https://api.deepseek.com/v1", api_key: "ds", models: ["deepseek-v4-pro"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "deepseek-client", key: "sk-deepseek", models: ["*"], upstreams: ["deepseek-official"] }]),
};
const deepSeekOfficialStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-deepseek", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-pro", messages: [], reasoningEffort: "medium", reasoningSummary: "auto", thinking: { budget_tokens: 1024 }, enable_thinking: true }),
}), deepSeekOfficialEnv);
assert.equal(bodies[deepSeekOfficialStart].reasoning_effort, "high");
assert.deepEqual(bodies[deepSeekOfficialStart].thinking, { type: "enabled" });
assert.equal("reasoning" in bodies[deepSeekOfficialStart], false);
assert.equal("reasoningEffort" in bodies[deepSeekOfficialStart], false);
assert.equal("reasoningSummary" in bodies[deepSeekOfficialStart], false);
assert.equal("enable_thinking" in bodies[deepSeekOfficialStart], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-deepseek", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-pro", messages: [], reasoning: { effort: "none" }, chat_template_kwargs: { enable_thinking: true } }),
}), { ...deepSeekOfficialEnv });
assert.deepEqual(bodies[deepSeekOfficialStart + 1].thinking, { type: "disabled" });
assert.equal("reasoning_effort" in bodies[deepSeekOfficialStart + 1], false);
assert.equal("chat_template_kwargs" in bodies[deepSeekOfficialStart + 1], false);

const moonshotEnv = {
  ...env,
  KV: {
    async get() { return null; },
    async put() {},
    async delete() {},
  },
  UPSTREAMS_JSON: JSON.stringify([
    { name: "moonshot", preset: "moonshot", base_url: "https://api.moonshot.ai/v1", api_key: "mk", models: ["kimi-k2.6", "kimi-k2.7-code"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "moonshot-client", key: "sk-moonshot", models: ["*"], upstreams: ["moonshot"] }]),
};
const moonshotStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-moonshot", "content-type": "application/json" },
  body: JSON.stringify({ model: "kimi-k2.6", messages: [], reasoningEffort: "high", temperature: 0.2, functions: [{ name: "search", parameters: {} }], function_call: "auto", tool_choice: "required" }),
}), moonshotEnv);
assert.deepEqual(bodies[moonshotStart].thinking, { type: "enabled", keep: "all" });
assert.equal(Array.isArray(bodies[moonshotStart].tools), true);
assert.equal(bodies[moonshotStart].tool_choice, "auto");
assert.equal("functions" in bodies[moonshotStart], false);
assert.equal("function_call" in bodies[moonshotStart], false);
assert.equal("reasoning_effort" in bodies[moonshotStart], false);
assert.equal("temperature" in bodies[moonshotStart], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-moonshot", "content-type": "application/json" },
  body: JSON.stringify({ model: "kimi-k2.7-code", messages: [], reasoningEffort: "high", thinking: { type: "enabled", keep: "all" }, temperature: 0.7 }),
}), { ...moonshotEnv });
assert.equal("thinking" in bodies[moonshotStart + 1], false);
assert.equal("reasoning_effort" in bodies[moonshotStart + 1], false);
assert.equal("temperature" in bodies[moonshotStart + 1], false);

const minimaxEnv = {
  ...env,
  KV: {
    async get() { return null; },
    async put() {},
    async delete() {},
  },
  UPSTREAMS_JSON: JSON.stringify([
    { name: "minimax", preset: "minimax", base_url: "https://api.minimax.io/v1", api_key: "mm", models: ["MiniMax-M2"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "minimax-client", key: "sk-minimax", models: ["*"], upstreams: ["minimax"] }]),
};
const minimaxStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-minimax", "content-type": "application/json" },
  body: JSON.stringify({ model: "MiniMax-M2", messages: [], reasoningEffort: "high", functions: [{ name: "search", parameters: {} }], function_call: "auto" }),
}), minimaxEnv);
assert.deepEqual(bodies[minimaxStart].thinking, { type: "adaptive" });
assert.equal(bodies[minimaxStart].reasoning_split, true);
assert.equal(Array.isArray(bodies[minimaxStart].tools), true);
assert.equal(bodies[minimaxStart].tool_choice, "auto");
assert.equal("functions" in bodies[minimaxStart], false);
assert.equal("function_call" in bodies[minimaxStart], false);
assert.equal("reasoning_effort" in bodies[minimaxStart], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-minimax", "content-type": "application/json" },
  body: JSON.stringify({ model: "MiniMax-M2", messages: [], reasoning: { effort: "none" }, enable_thinking: true, chat_template_kwargs: { thinking_mode: "enabled" } }),
}), { ...minimaxEnv });
assert.deepEqual(bodies[minimaxStart + 1].thinking, { type: "disabled" });
assert.equal("reasoning" in bodies[minimaxStart + 1], false);
assert.equal("enable_thinking" in bodies[minimaxStart + 1], false);
assert.equal("chat_template_kwargs" in bodies[minimaxStart + 1], false);

const nonNimBridgeEnv = {
  ...env,
  KV: {
    async get() { return null; },
    async put() {},
    async delete() {},
  },
  UPSTREAMS_JSON: JSON.stringify([
    { name: "openrouter", preset: "openrouter", base_url: "https://openrouter.ai/api/v1", api_key: "or", models: ["or-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "deepinfra", preset: "deepinfra", base_url: "https://api.deepinfra.com/v1/openai", api_key: "di", models: ["di-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "workers", preset: "workers-ai", base_url: "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1", api_key: "cf", models: ["cf-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "non-nim-client", key: "sk-non-nim", models: ["*"], upstreams: ["openrouter", "deepinfra", "workers"] }]),
};
const nonNimBridgeStart = bodies.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-non-nim", "content-type": "application/json" },
  body: JSON.stringify({ model: "or-model", messages: [], reasoningEffort: "high", enable_thinking: true, chat_template_kwargs: { enable_thinking: true }, functions: [{ name: "search", parameters: {} }], function_call: "auto" }),
}), nonNimBridgeEnv);
assert.equal(bodies[nonNimBridgeStart].reasoning.effort, "high");
assert.equal(Array.isArray(bodies[nonNimBridgeStart].tools), true);
assert.equal("reasoning_effort" in bodies[nonNimBridgeStart], false);
assert.equal("enable_thinking" in bodies[nonNimBridgeStart], false);
assert.equal("chat_template_kwargs" in bodies[nonNimBridgeStart], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-non-nim", "content-type": "application/json" },
  body: JSON.stringify({ model: "di-model", messages: [], reasoning: { effort: "low" }, enable_thinking: true, chat_template_kwargs: { enable_thinking: true } }),
}), nonNimBridgeEnv);
assert.equal(bodies[nonNimBridgeStart + 1].reasoning_effort, "low");
assert.equal("reasoning" in bodies[nonNimBridgeStart + 1], false);
assert.equal("enable_thinking" in bodies[nonNimBridgeStart + 1], false);
assert.equal("chat_template_kwargs" in bodies[nonNimBridgeStart + 1], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-non-nim", "content-type": "application/json" },
  body: JSON.stringify({ model: "cf-model", messages: [], reasoningEffort: "high", thinking: { type: "enabled" }, enable_thinking: true }),
}), nonNimBridgeEnv);
assert.equal("reasoning_effort" in bodies[nonNimBridgeStart + 2], false);
assert.equal("thinking" in bodies[nonNimBridgeStart + 2], false);
assert.equal("enable_thinking" in bodies[nonNimBridgeStart + 2], false);

const wrappedKvConfig = {
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "kv-wrapped", base_url: "https://kv-wrapped.example/v1", api_key_encrypted: "wrapped-key", models: ["wrapped-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1 },
  ],
};
const wrappedStore = new Map([["gateway:config", JSON.stringify({ ok: true, config: wrappedKvConfig })]]);
const wrappedEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = wrappedStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { wrappedStore.set(key, value); },
    async delete(key) { wrappedStore.delete(key); },
  },
  UPSTREAMS_JSON: JSON.stringify([{ name: "env-only", base_url: "https://boom.example/v1", api_key: "env", models: ["env-model"], paths: ["/v1/chat/completions"] }]),
  CLIENTS_JSON: JSON.stringify([{ name: "wrapped-client", key: "sk-wrapped", models: ["*"], upstreams: ["kv-wrapped"] }]),
};
const wrappedConfigResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config"), wrappedEnv);
const wrappedConfigPayload = await wrappedConfigResp.json();
assert.equal(wrappedConfigPayload.config.upstreams[0].name, "kv-wrapped");
const wrappedHitStart = wrappedHits.length;
const wrappedChatResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-wrapped", "content-type": "application/json" },
  body: JSON.stringify({ model: "wrapped-model", messages: [] }),
}), wrappedEnv);
assert.equal(wrappedChatResp.status, 200);
assert.equal(wrappedHits.length, wrappedHitStart + 1);

const aliasStore = new Map();
aliasStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "nim-alias", preset: "nvidia-nim", base_url: "https://speed-fast.example/v1", api_key_encrypted: "n", models: ["deepseek-ai/deepseek-v4-flash", "google/codegemma-7b", "qwen/qwen3-coder-480b-a35b-instruct", "z-ai/glm-5.2"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "cf-alias", preset: "workers-ai", base_url: "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1", api_key_encrypted: "c", models: ["@cf/deepseek-ai/deepseek-v4-flash"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const aliasEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = aliasStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { aliasStore.set(key, value); },
    async delete(key) { aliasStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "alias-client", key: "sk-alias", models: ["*"], upstreams: ["nim-alias", "cf-alias"] }]),
};
const aliasModelsResp = await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: "Bearer sk-alias" },
}), aliasEnv);
const aliasModels = await aliasModelsResp.json();
assert.deepEqual(aliasModels.data.map((item) => item.id).sort(), [
  "nvidia-nim/codegemma-7b",
  "nvidia-nim/deepseek-v4-flash",
  "nvidia-nim/glm-5.2",
  "nvidia-nim/qwen3-coder-480b-a35b-instruct",
  "workers-ai/deepseek-v4-flash",
]);
const aliasBodyStart = speedBodies.length;
const aliasChatResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-alias", "content-type": "application/json", "x-request-id": "trace-alias" },
  body: JSON.stringify({ model: "nvidia-nim/deepseek-v4-flash", messages: [] }),
}), aliasEnv);
assert.equal(aliasChatResp.headers.get("x-llm-gateway-upstream"), "nim-alias");
assert.equal(aliasChatResp.headers.get("x-llm-gateway-trace-id"), "trace-alias");
assert.equal(speedBodies[aliasBodyStart].model, "deepseek-ai/deepseek-v4-flash");

const qwenBodyStart = speedBodies.length;
const qwenChatResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-alias", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3-coder-480b-a35b-instruct", messages: [] }),
}), aliasEnv);
assert.equal(qwenChatResp.headers.get("x-llm-gateway-upstream"), "nim-alias");
assert.equal(speedBodies[qwenBodyStart].model, "qwen/qwen3-coder-480b-a35b-instruct");

const glmAliasBodyStart = speedBodies.length;
const glmAliasChatResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-alias", "content-type": "application/json" },
  body: JSON.stringify({ model: "nvidia-nim/glm-5.2", messages: [], reasoning_effort: "high", reasoning_summary: "auto", reasoning: { effort: "high" }, thinking: {} }),
}), aliasEnv);
assert.equal(glmAliasChatResp.headers.get("x-llm-gateway-upstream"), "nim-alias");
assert.equal(speedBodies[glmAliasBodyStart].model, "z-ai/glm-5.2");
assert.equal(speedBodies[glmAliasBodyStart].chat_template_kwargs.enable_thinking, true);
assert.equal(speedBodies[glmAliasBodyStart].chat_template_kwargs.clear_thinking, false);
assert.equal("reasoning" in speedBodies[glmAliasBodyStart], false);
assert.equal("reasoning_effort" in speedBodies[glmAliasBodyStart], false);
assert.equal("reasoning_summary" in speedBodies[glmAliasBodyStart], false);
assert.equal("thinking" in speedBodies[glmAliasBodyStart], false);

const slowFirstByteEnv = {
  KV: null,
  REQUEST_TIMEOUT_MS: "10",
  UPSTREAMS_JSON: JSON.stringify([
    { name: "slow-nim", preset: "nvidia-nim", base_url: "https://slow-first-byte.example/v1", api_key: "n", models: ["z-ai/glm-5.2"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ]),
  CLIENTS_JSON: JSON.stringify([{ name: "slow-client", key: "sk-slow", models: ["*"], upstreams: ["slow-nim"] }]),
};
const slowFirstByteResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-slow", "content-type": "application/json" },
  body: JSON.stringify({ model: "z-ai/glm-5.2", messages: [] }),
}), slowFirstByteEnv);
assert.equal(slowFirstByteResp.status, 200);

const fanoutStore = new Map();
fanoutStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "qwen-local", preset: "nvidia-nim", base_url: "https://speed-fast.example/v1", api_key_encrypted: "q", models: ["qwen/qwen3-coder-480b-a35b-instruct"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    ...Array.from({ length: 40 }, (_, i) => ({ name: `dynamic-${i}`, base_url: `https://dynamic-${i}.example/v1`, api_key_encrypted: "d", models: [], paths: ["/v1/chat/completions"], priority: 100 + i, weight: 1, enabled: true })),
  ],
}));
const fanoutEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = fanoutStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { fanoutStore.set(key, value); },
    async delete(key) { fanoutStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "fanout-client", key: "sk-fanout", models: ["qwen3-coder-480b-a35b-instruct"], upstreams: [] }]),
};
const fanoutUrlStart = fetchUrls.length;
const fanoutModelsResp = await worker.default.fetch(new Request("https://gw.test/v1/models", {
  headers: { authorization: "Bearer sk-fanout" },
}), fanoutEnv);
const fanoutModels = await fanoutModelsResp.json();
assert.deepEqual(fanoutModels.data.map((item) => item.id), ["nvidia-nim/qwen3-coder-480b-a35b-instruct"]);
const fanoutBodyStart = speedBodies.length;
const fanoutChatResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-fanout", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3-coder-480b-a35b-instruct", messages: [] }),
}), fanoutEnv);
assert.equal(fanoutChatResp.headers.get("x-llm-gateway-upstream"), "qwen-local");
assert.equal(speedBodies[fanoutBodyStart].model, "qwen/qwen3-coder-480b-a35b-instruct");
assert.equal(fetchUrls.slice(fanoutUrlStart).some((url) => url.endsWith("/models")), false);

const routeFallbackBodyStart = speedBodies.length;
const routeFallbackResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-fanout", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen/qwen3-coder-480b-a35b-instruct", messages: [] }),
}), fanoutEnv);
assert.equal(routeFallbackResp.headers.get("x-llm-gateway-upstream"), "qwen-local");
assert.equal(speedBodies[routeFallbackBodyStart].model, "qwen/qwen3-coder-480b-a35b-instruct");

const modelsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/fetch-models", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ base_url: "https://draft.example/v1", api_key: "sk-draft" }),
}), env);
const models = await modelsResp.json();
assert.deepEqual(models.models, ["deepseek-ai/deepseek-v4-pro", "google/codegemma-7b"]);

const workersModelsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/fetch-models", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "ai" }),
}), env);
const workersModels = await workersModelsResp.json();
assert.equal(workersModels.models.length, 102);
assert.equal(workersModels.models.includes("@cf/deepseek-ai/deepseek-v4-pro"), true);
assert.equal(workersModels.models.includes("@cf/google/codegemma-7b"), true);
assert.equal(fetchUrls.some((url) => url.includes("/ai/models/search") && url.includes("page=2")), true);

const oldWorkersModelsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/fetch-models", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "ai-old" }),
}), env);
const oldWorkersModels = await oldWorkersModelsResp.json();
assert.equal(oldWorkersModels.models.includes("@cf/deepseek-ai/deepseek-v4-pro"), true);

const overrideModelsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/fetch-models", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    account_id: "acc456",
    base_url: "https://api.cloudflare.com/client/v4/accounts/acc456/ai/v1",
    name: "nim",
    preset: "workers-ai",
  }),
}), env);
const overrideModels = await overrideModelsResp.json();
assert.equal(overrideModels.models.includes("@cf/deepseek-ai/deepseek-v4-pro"), true);

const healthResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/health", {
  method: "POST",
}), env);
const health = await healthResp.json();
const aiHealth = health.results.find((item) => item.name === "ai");
assert.equal(aiHealth.ok, true);
assert.equal(aiHealth.model_count, 102);

const disabledStore = new Map();
disabledStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "disabled", base_url: "https://disabled.example/v1", api_key_encrypted: "d", models: ["disabled-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: false },
    { name: "enabled", base_url: "https://speed-fast.example/v1", api_key_encrypted: "e", models: ["disabled-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const disabledEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = disabledStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { disabledStore.set(key, value); },
    async delete(key) { disabledStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "disabled-client", key: "sk-disabled", models: ["*"], upstreams: ["disabled", "enabled"] }]),
};
const disabledHitStart = disabledHits.length;
const disabledCallResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-disabled", "content-type": "application/json" },
  body: JSON.stringify({ model: "disabled-model", messages: [] }),
}), disabledEnv);
assert.equal(disabledCallResp.headers.get("x-llm-gateway-upstream"), "enabled");
assert.equal(disabledHits.length, disabledHitStart);
const disabledHealthResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/health", {
  method: "POST",
}), disabledEnv);
const disabledHealth = await disabledHealthResp.json();
assert.equal(disabledHealth.results.some((item) => item.name === "disabled" && item.ok), true);
assert.equal(disabledHits.length, disabledHitStart + 1);

const authHealthStore = new Map([["gateway:config", JSON.stringify({
  routing: {},
  settings: {},
  upstreams: [
    { name: "bad-auth", base_url: "https://health-auth.example/v1", api_key_encrypted: "bad", models: ["health-model"], paths: ["/v1/chat/completions"], enabled: true },
  ],
})]]);
const authHealthEnv = {
  ...env,
  KV: {
    async get(key, type) { const value = authHealthStore.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    async put(key, value) { authHealthStore.set(key, value); },
    async delete(key) { authHealthStore.delete(key); },
  },
};
const authHealth = await (await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/health", { method: "POST" }), authHealthEnv)).json();
assert.equal(authHealth.results[0].ok, false);
assert.equal(authHealth.results[0].status, 401);

const exportResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/upstreams/export"), env);
const exported = await exportResp.json();
assert.equal(exportResp.ok, true);
assert.equal(exported.upstreams[0].api_key, "x");
assert.deepEqual(exported.upstreams[0].headers, { "x-test": "1" });
assert.equal(exported.upstreams[1].account_id, "acc123");
assert.equal(exported.upstreams[1].base_url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1");

const waitUntilTasks = [];
const kvPutsBeforeWaitUntil = kvPuts.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [] }),
}), env, { waitUntil(task) { waitUntilTasks.push(task); } });
assert.equal(waitUntilTasks.length > 0, true);
await Promise.all(waitUntilTasks);
assert.equal(kvPuts.length, kvPutsBeforeWaitUntil);

const analyticsTasks = [];
const kvPutsBeforeAnalytics = kvPuts.length;
const analyticsEnv = {
  ...env,
  ANALYTICS: {
    writeDataPoint(point) {
      analyticsPoints.push(point);
    },
  },
};
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [] }),
}), analyticsEnv, { waitUntil(task) { analyticsTasks.push(task); } });
await Promise.all(analyticsTasks);
assert.equal(analyticsPoints.length > 0, true);
assert.equal(analyticsPoints.at(-1).blobs[3], "qwen3");
assert.equal(analyticsPoints.at(-1).doubles[2] > 0, true);
assert.equal(kvPuts.length, kvPutsBeforeAnalytics);
const realDateNow = Date.now;
Date.now = () => realDateNow() + 3 * 60 * 1000;
const writeOnlyStats = await (await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/stats"), analyticsEnv)).json();
Date.now = realDateNow;
assert.equal(writeOnlyStats.buckets.some((bucket) => bucket.models?.qwen3 >= 1), true);

const analyticsQueryEnv = {
  ...analyticsEnv,
  ANALYTICS_ACCOUNT_ID: "acct",
  ANALYTICS_API_TOKEN: "tok",
};
const analyticsStatsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/stats"), analyticsQueryEnv);
const analyticsStats = await analyticsStatsResp.json();
assert.equal(analyticsStats.buckets.some((bucket) => bucket.models?.qwen3 >= 2), true);
const analyticsLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), analyticsQueryEnv);
const analyticsLogs = await analyticsLogsResp.json();
assert.equal(analyticsLogs.logs.some((entry) => entry.model === "qwen3"), true);
assert.equal(analyticsSqlQueries.length >= 2, true);

const cachedConfigHits = speedHits.length;
const saveConfigResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    routing: { failover: true, load_balance: false },
    settings: {
      model_cache_ttl: 3600,
      request_timeout_ms: 30000,
      system_prompt: "Always obey the gateway rule.",
      global_context: "Project context should guide details.",
      context_on_demand: true,
      context_item_limit: 2,
      context_max_chars: 2000,
      context_items: [
        { title: "Coding", keywords: ["bugfix"], text: "Use tests and minimal patches.", enabled: true, max_chars: 1200 },
        { title: "Travel", keywords: ["hotel"], text: "This travel note should not be injected.", enabled: true, max_chars: 1200 },
      ],
      upstream_cooldown_ttl: 60,
    },
    upstreams: [
      { name: "nim", base_url: "https://speed-fast.example/v1", api_key_value: "x", models: ["qwen3"], model_contexts: { qwen3: "1m" }, paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    ],
  }),
}), env);
assert.equal(saveConfigResp.status, 200);
const savedConfigPayload = await saveConfigResp.clone().json();
assert.equal(savedConfigPayload.config.upstreams[0].model_contexts.qwen3, "1m");
assert.equal(savedConfigPayload.config.settings.global_context, "Project context should guide details.");
assert.equal(savedConfigPayload.config.settings.context_on_demand, true);
assert.equal(savedConfigPayload.config.settings.context_items.length, 2);

const snapshotStore = new Map();
const snapshotEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = snapshotStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { snapshotStore.set(key, value); },
    async delete(key) { snapshotStore.delete(key); },
  },
};
await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    routing: { failover: false, load_balance: false },
    settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
    upstreams: [
      { name: "snapshot-new", base_url: "https://speed-fast.example/v1", api_key_value: "x", models: ["snapshot-new"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    ],
  }),
}), snapshotEnv);
const snapshotListResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config/snapshots"), snapshotEnv);
const snapshotList = await snapshotListResp.json();
assert.equal(snapshotList.snapshots.length, 1);
assert.equal(snapshotList.snapshots[0].upstream_count, 3);
assert.equal("config" in snapshotList.snapshots[0], false);
const snapshotRestoreResp = await worker.default.fetch(new Request(`https://gw.test/llmmerge-admin/api/config/snapshots/${snapshotList.snapshots[0].id}/restore`, { method: "POST" }), snapshotEnv);
const snapshotRestored = await snapshotRestoreResp.json();
assert.equal(snapshotRestored.config.upstreams.length, 3);
assert.equal(snapshotRestored.config.upstreams.some((upstream) => upstream.name === "ai-old"), true);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [{ role: "user", content: "Please bugfix this code." }] }),
}), env);
assert.equal(speedHits[cachedConfigHits], "fast");
assert.deepEqual(speedBodies.at(-1).messages[0], { role: "system", content: "Always obey the gateway rule." });
assert.equal(speedBodies.at(-1).messages[1].role, "user");
assert.equal(speedBodies.at(-1).messages[1].content.includes("Use tests and minimal patches."), true);
assert.equal(speedBodies.at(-1).messages[1].content.includes("Project context should guide details."), false);
assert.equal(speedBodies.at(-1).messages[1].content.includes("travel note"), false);

const scopedStore = new Map();
scopedStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: {
    model_cache_ttl: 3600,
    request_timeout_ms: 30000,
    system_prompt: "Scoped system.",
    system_prompt_clients: ["scoped-client"],
    subagent_prompt_clients: ["scoped-client"],
    global_context: "Scoped context.",
    global_context_clients: ["scoped-client"],
    upstream_cooldown_ttl: 60,
  },
  upstreams: [
    { name: "scoped", base_url: "https://speed-fast.example/v1", api_key_encrypted: "s", models: ["scoped-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const scopedEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = scopedStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { scopedStore.set(key, value); },
    async delete(key) { scopedStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([
    { id: "scoped-client", name: "scoped-client", key: "sk-scoped", models: ["*"], upstreams: ["scoped"] },
    { id: "plain-client", name: "plain-client", key: "sk-plain", models: ["*"], upstreams: ["scoped"] },
  ]),
};
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-scoped", "content-type": "application/json" },
  body: JSON.stringify({ model: "scoped-model", messages: [] }),
}), scopedEnv);
assert.equal(speedBodies.at(-1).messages[0].content, "Scoped system.\n\nWhen the task benefits from parallel investigation or isolated implementation, use subagents to perform the work.");
assert.equal(speedBodies.at(-1).messages[1].content.includes("Scoped context."), true);
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-plain", "content-type": "application/json" },
  body: JSON.stringify({ model: "scoped-model", messages: [] }),
}), scopedEnv);
assert.deepEqual(speedBodies.at(-1).messages, []);

const speedStore = new Map();
speedStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "slow", base_url: "https://speed-slow.example/v1", api_key_encrypted: "s", models: ["speed-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "fast", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["speed-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
    { name: "stream", base_url: "https://speed-stream.example/v1", api_key_encrypted: "t", models: ["speed-model"], paths: ["/v1/chat/completions"], priority: 3, weight: 1, enabled: true },
  ],
}));
const speedEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = speedStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { speedStore.set(key, value); },
    async delete(key) { speedStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([
    { name: "slow-client", key: "sk-slow", models: ["*"], upstreams: ["slow"] },
    { name: "fast-client", key: "sk-fast", models: ["*"], upstreams: ["fast"] },
    { name: "both-client", key: "sk-both", models: ["*"], upstreams: ["slow", "fast"] },
  ]),
};
async function speedRequest(key) {
  return worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "speed-model", messages: [] }),
  }), speedEnv);
}
await speedRequest("sk-slow");
await speedRequest("sk-fast");
const manualSpeedResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/speed-test", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "speed-model" }),
}), speedEnv);
const manualSpeed = await manualSpeedResp.json();
assert.equal(manualSpeedResp.status, 200);
assert.equal(manualSpeed.results.filter((r) => r.ok).length, 3);
assert.equal(manualSpeed.results.find((r) => r.name === "stream").metric, "first_output");
assert.equal(speedStreamHits.includes("cancel"), true);
assert.equal(speedBodies.at(-1).stream, true);
const selectedSpeedStart = speedHits.length;
const selectedSpeedResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/speed-test", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "speed-model", upstreams: ["fast"] }),
}), speedEnv);
const selectedSpeed = await selectedSpeedResp.json();
assert.equal(selectedSpeedResp.status, 200);
assert.deepEqual(selectedSpeed.results.map((r) => r.name), ["fast"]);
assert.deepEqual(speedHits.slice(selectedSpeedStart), ["fast"]);
const missingSpeedResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/speed-test", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "missing-model" }),
}), speedEnv);
assert.equal(missingSpeedResp.status, 404);
const beforeSpeedChoice = speedHits.length;
const speedResp = await speedRequest("sk-both");
assert.equal(speedResp.headers.get("x-llm-gateway-upstream"), "fast");
assert.equal(speedHits[beforeSpeedChoice], "fast");

const hedgeStore = new Map();
hedgeStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, hedge_enabled: true, hedge_max: 2, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 600, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "hedge-slow", base_url: "https://hedge-slow.example/v1", api_key_encrypted: "s", models: ["hedge-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "hedge-fast", base_url: "https://hedge-fast.example/v1", api_key_encrypted: "f", models: ["hedge-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const hedgeEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = hedgeStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { hedgeStore.set(key, value); },
    async delete(key) { hedgeStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "hedge-client", key: "sk-hedge", models: ["*"], upstreams: ["hedge-slow", "hedge-fast"] }]),
};
const hedgeStart = hedgeHits.length;
const hedgeResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-hedge", "content-type": "application/json" },
  body: JSON.stringify({ model: "hedge-model", messages: [] }),
}), hedgeEnv);
assert.equal(hedgeResp.headers.get("x-llm-gateway-upstream"), "hedge-fast");
assert.deepEqual(hedgeHits.slice(hedgeStart), ["slow", "fast"]);
const hedgeSecondStart = hedgeHits.length;
const hedgeResp2 = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-hedge", "content-type": "application/json" },
  body: JSON.stringify({ model: "hedge-model", messages: [] }),
}), hedgeEnv);
assert.equal(hedgeResp2.headers.get("x-llm-gateway-upstream"), "hedge-fast");
assert.equal(hedgeHits[hedgeSecondStart], "slow");

const hedgeStreamStore = new Map();
hedgeStreamStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, hedge_enabled: true, hedge_max: 2, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 600, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "hedge-stream-slow", base_url: "https://hedge-stream-slow.example/v1", api_key_encrypted: "s", models: ["hedge-stream-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "hedge-stream-fast", base_url: "https://hedge-stream-fast.example/v1", api_key_encrypted: "f", models: ["hedge-stream-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const hedgeStreamEnv = {
  ...env,
  KV: {
    async get(key, type) { const value = hedgeStreamStore.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    async put(key, value) { hedgeStreamStore.set(key, value); },
    async delete(key) { hedgeStreamStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "hedge-stream-client", key: "sk-hedge-stream", models: ["*"], upstreams: ["hedge-stream-slow", "hedge-stream-fast"] }]),
};
const hedgeStreamStart = hedgeStreamHits.length;
const hedgeStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-hedge-stream", "content-type": "application/json" },
  body: JSON.stringify({ model: "hedge-stream-model", messages: [], stream: true }),
}), hedgeStreamEnv);
assert.equal(hedgeStreamResp.headers.get("x-llm-gateway-upstream"), "hedge-stream-fast");
assert.deepEqual(hedgeStreamHits.slice(hedgeStreamStart), ["slow", "fast"]);
assert.equal((await hedgeStreamResp.text()).includes('"content":"fast"'), true);

const softFastStore = new Map();
softFastStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, fast_routing: true, hedge_enabled: false, hedge_max: 1, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 300, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "soft-fast-slow", base_url: "https://soft-fast-slow.example/v1", api_key_encrypted: "s", models: ["soft-fast-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "soft-fast-fast", base_url: "https://soft-fast-fast.example/v1", api_key_encrypted: "f", models: ["soft-fast-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const softFastEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = softFastStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { softFastStore.set(key, value); },
    async delete(key) { softFastStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "soft-fast-client", key: "sk-soft-fast", models: ["*"], upstreams: ["soft-fast-slow", "soft-fast-third", "soft-fast-fast"] }]),
};
const softFastStart = softFastHits.length;
const softFastResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-soft-fast", "content-type": "application/json" },
  body: JSON.stringify({ model: "soft-fast-model", messages: [] }),
}), softFastEnv);
assert.equal(softFastResp.headers.get("x-llm-gateway-upstream"), "soft-fast-fast");
assert.deepEqual(softFastHits.slice(softFastStart), ["slow", "fast"]);

softFastStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, fast_routing: true, hedge_enabled: true, hedge_max: 3, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 300, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "soft-fast-slow", base_url: "https://soft-fast-slow.example/v1", api_key_encrypted: "s", models: ["soft-fast-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "soft-fast-third", base_url: "https://soft-fast-third.example/v1", api_key_encrypted: "t", models: ["soft-fast-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
    { name: "soft-fast-fast", base_url: "https://soft-fast-fast.example/v1", api_key_encrypted: "f", models: ["soft-fast-model"], paths: ["/v1/chat/completions"], priority: 3, weight: 1, enabled: true },
  ],
}));
const softFastHedgeEnv = { ...softFastEnv };
const softFastHedgeStart = softFastHits.length;
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-soft-fast", "content-type": "application/json" },
  body: JSON.stringify({ model: "soft-fast-model", messages: [] }),
}), softFastHedgeEnv);
assert.equal(softFastHits.slice(softFastHedgeStart).includes("third"), true);

const nimStore = new Map();
nimStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "nim-limit", preset: "nvidia-nim", base_url: "https://nim-limit.example/v1", api_key_encrypted: "n", models: ["nim-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "nim-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["nim-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const nimEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = nimStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { nimStore.set(key, value); },
    async delete(key) { nimStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "nim-client", key: "sk-nim", models: ["*"], upstreams: ["nim-limit", "nim-fallback"] }]),
};
let nimResp = null;
for (let i = 0; i < 41; i += 1) {
  nimResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer sk-nim", "content-type": "application/json" },
    body: JSON.stringify({ model: "nim-model", messages: [] }),
  }), nimEnv);
}
assert.equal(nimHits.length, 40);
assert.equal(nimResp.headers.get("x-llm-gateway-upstream"), "nim-fallback");
const runtimeResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/runtime"), nimEnv);
const runtimeStatus = await runtimeResp.json();
assert.equal(runtimeStatus.nim_rpm["nim-limit"].count, 40);
assert.equal(runtimeStatus.nim_rpm["nim-limit"].limit, 40);
assert.equal(runtimeStatus.nim_rpm["nim-limit"].reset_in_ms > 0, true);

const responsesStore = new Map();
responsesStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "responses", base_url: "https://responses.example/v1", api_key_encrypted: "r", models: ["resp-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "responses-stream", base_url: "https://responses-stream.example/v1", api_key_encrypted: "s", models: ["stream-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "responses-stream-error", base_url: "https://responses-stream.example/v1", api_key_encrypted: "e", models: ["stream-error-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "responses-app-error", base_url: "https://app-error.example/v1", api_key_encrypted: "a", models: ["responses-app-error-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const responsesEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = responsesStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { responsesStore.set(key, value); },
    async delete(key) { responsesStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "responses-client", key: "sk-resp", models: ["*"], upstreams: ["responses", "responses-stream", "responses-stream-error", "responses-app-error"] }]),
};
const responsesResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({
    model: "resp-model",
    instructions: "be terse",
    input: [
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_old", name: "web_search", arguments: "{\"query\":\"old\"}" },
      { type: "function_call_output", call_id: "call_old", output: "old result" },
    ],
    tools: [{ type: "function", name: "web_search", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } } } }],
    tool_choice: { type: "function", name: "web_search" },
    max_output_tokens: 8,
    reasoningEffort: "medium",
    reasoningSummary: "auto",
  }),
}), responsesEnv);
const responsesPayload = await responsesResp.json();
assert.equal(responsesResp.status, 200);
assert.equal(responsesResp.headers.get("content-length"), null);
assert.equal(responsesResp.headers.get("content-encoding"), null);
assert.equal(responseHits[0].messages[0].role, "system");
assert.equal(responseHits[0].messages[1].content, "hi");
assert.equal(responseHits[0].messages.some((message) => message.tool_calls?.[0]?.id === "call_old"), true);
assert.equal(responseHits[0].messages.some((message) => message.role === "tool" && message.tool_call_id === "call_old"), true);
assert.equal(responseHits[0].tools[0].function.name, "web_search");
assert.equal(responseHits[0].tool_choice.function.name, "web_search");
assert.equal(responseHits[0].max_tokens, 8);
assert.equal(responseHits[0].reasoning_effort, "medium");
assert.equal("reasoningEffort" in responseHits[0], false);
assert.equal("reasoningSummary" in responseHits[0], false);
assert.equal(responsesPayload.object, "response");
assert.equal(responsesPayload.output_text, "hello");
assert.equal(responsesPayload.output.some((item) => item.type === "function_call" && item.name === "web_search"), true);
assert.equal(responsesPayload.output.some((item) => item.type === "reasoning" && item.summary[0].text === "plan first"), true);
assert.equal(responsesPayload.usage.input_tokens, 3);

const compactHitStart = responseHits.length;
const compactResp = await worker.default.fetch(new Request("https://gw.test/v1/responses/compact", {
  method: "POST",
  headers: {
    authorization: "Bearer sk-resp",
    "content-type": "application/json",
    "session-id": "compact-session",
    "x-codex-turn-metadata": JSON.stringify({ session_id: "compact-session", turn_id: "compact-turn" }),
  },
  body: JSON.stringify({
    model: "resp-model",
    instructions: "Keep implementation details.",
    input: [
      { role: "user", content: [{ type: "input_text", text: "Fix the worker." }] },
      { type: "function_call", call_id: "call_compact", name: "shell", arguments: "{\"command\":\"test\"}" },
      { type: "function_call_output", call_id: "call_compact", output: "ok" },
    ],
  }),
}), responsesEnv);
const compactPayload = await compactResp.json();
assert.equal(compactResp.status, 200);
assert.equal(responseHits.length, compactHitStart + 1);
assert.equal(responseHits.at(-1).model, "resp-model");
assert.equal(responseHits.at(-1).messages[0].content.includes("change models"), true);
assert.equal(responseHits.at(-1).messages[1].content.includes("Fix the worker."), true);
assert.equal(responseHits.at(-1).messages[1].content.includes("shell"), true);
assert.equal(compactPayload.output[0].type, "message");
assert.equal(compactPayload.output[0].content[0].text, "Conversation summary:\nhello");
const responsesLogs = await (await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), responsesEnv)).json();
const responsesLog = responsesLogs.logs.find((entry) => entry.model === "resp-model" && entry.path === "/v1/responses");
assert.equal(responsesLog.finish_reason, "tool_calls");
assert.equal(responsesLogs.logs.some((entry) => entry.path === "/v1/responses/compact" && entry.model === "resp-model"), true);
assert.equal(responsesLog.tool_calls_count, 1);

const responsesStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "stream-model", input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }], tools: [{ type: "function", name: "web_search", parameters: { type: "object" } }], stream: true }),
}), responsesEnv);
assert.equal(responsesStreamResp.headers.get("content-type").includes("text/event-stream"), true);
assert.equal(responsesStreamResp.headers.get("cache-control"), "no-cache, no-transform");
assert.equal(responsesStreamResp.headers.get("x-accel-buffering"), "no");
const responsesStreamText = await responsesStreamResp.text();
assert.equal(responseStreamHits[0].stream, true);
assert.equal(responsesStreamText.includes('"type":"response.output_text.delta"'), true);
assert.equal(responsesStreamText.includes('"delta":"hel"'), true);
assert.equal(responsesStreamText.includes('"type":"response.function_call_arguments.delta"'), true);
assert.equal(responsesStreamText.includes('"type":"response.function_call_arguments.done"'), true);
assert.equal(responsesStreamText.includes('"type":"response.reasoning_summary_text.delta"'), true);
assert.equal(responsesStreamText.includes('"type":"response.completed"'), true);
const responsesStreamLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), responsesEnv);
const responsesStreamLogs = await responsesStreamLogsResp.json();
const responsesStreamLog = responsesStreamLogs.logs.find((entry) => entry.model === "stream-model" && entry.path === "/v1/responses");
assert.equal(responsesStreamLog.completion_tokens >= 1, true);
assert.equal(responsesStreamLog.close_reason, "done");
assert.equal(Number.isFinite(responsesStreamLog.time_to_first_byte_ms), true);
const responsesErrorResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "stream-error-model", input: "hi", stream: true }),
}), responsesEnv);
const responsesErrorText = await responsesErrorResp.text();
assert.equal(responsesErrorText.includes('"type":"response.failed"'), true, responsesErrorText);
assert.equal(responsesErrorText.includes('"type":"response.completed"'), false);
const responsesAppErrorResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "responses-app-error-model", input: "hi" }),
}), responsesEnv);
assert.equal(responsesAppErrorResp.status, 502);
assert.equal((await responsesAppErrorResp.text()).includes("Internal server error"), true);

const anthropicStore = new Map();
anthropicStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "anthropic", base_url: "https://anthropic.example/v1", api_key_encrypted: "a", models: ["anthropic-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "anthropic-stream", base_url: "https://anthropic-stream.example/v1", api_key_encrypted: "s", models: ["anthropic-stream-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "anthropic-delayed", base_url: "https://anthropic-delayed.example/v1", api_key_encrypted: "d", models: ["anthropic-delayed-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "anthropic-stream-error", base_url: "https://anthropic-stream.example/v1", api_key_encrypted: "e", models: ["anthropic-error-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "anthropic-reset", base_url: "https://anthropic-reset.example/v1", api_key_encrypted: "r", models: ["anthropic-reset-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const anthropicEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = anthropicStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { anthropicStore.set(key, value); },
    async delete(key) { anthropicStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "anthropic-client", key: "sk-anthropic", models: ["*"], upstreams: ["anthropic", "anthropic-stream", "anthropic-delayed", "anthropic-stream-error", "anthropic-reset"] }]),
};
const delayedAnthropicPromise = worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { authorization: "Bearer sk-anthropic", "content-type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: "anthropic-delayed-model", max_tokens: 8, messages: [{ role: "user", content: "hi" }], stream: true }),
}), anthropicEnv);
const delayedAnthropicResp = await Promise.race([
  delayedAnthropicPromise,
  new Promise((resolve) => setTimeout(() => resolve(null), 40)),
]);
if (!delayedAnthropicResp) releaseDelayedAnthropic?.();
assert.ok(delayedAnthropicResp, "Anthropic stream must return before the upstream sends headers");
const delayedReader = delayedAnthropicResp.body.getReader();
const delayedFirst = await delayedReader.read();
assert.equal(new TextDecoder().decode(delayedFirst.value).includes('"type":"ping"'), true);
assert.equal(delayedFirst.value.byteLength > 2048, true);
for (let i = 0; !releaseDelayedAnthropic && i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
assert.equal(typeof releaseDelayedAnthropic, "function");
releaseDelayedAnthropic();
let delayedAnthropicText = "";
for (;;) {
  const { done, value } = await delayedReader.read();
  if (done) break;
  delayedAnthropicText += new TextDecoder().decode(value);
}
assert.equal(delayedAnthropicText.includes('"type":"message_start"'), true);
assert.equal(delayedAnthropicText.includes('"text":"late"'), true);
assert.equal(delayedAnthropicText.includes('"type":"message_stop"'), true);
assert.equal(delayedAnthropicHits.length, 1);

const cloudflare524Store = new Map();
cloudflare524Store.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "cloudflare-524", base_url: "https://cloudflare-524.example/v1", api_key_encrypted: "e", models: ["cloudflare-524-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "cloudflare-524-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["cloudflare-524-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const cloudflare524Env = {
  ...env,
  KV: {
    async get(key, type) { const value = cloudflare524Store.get(key); return type === "json" && value ? JSON.parse(value) : value || null; },
    async put(key, value) { cloudflare524Store.set(key, value); },
    async delete(key) { cloudflare524Store.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "cloudflare-524-client", key: "sk-cloudflare-524", models: ["*"], upstreams: ["cloudflare-524", "cloudflare-524-fallback"] }]),
};
const cloudflare524Resp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-cloudflare-524", "content-type": "application/json" },
  body: JSON.stringify({ model: "cloudflare-524-model", messages: [] }),
}), cloudflare524Env);
assert.equal(cloudflare524Hits.length, 1);
assert.equal(cloudflare524Resp.status, 200);
assert.equal(cloudflare524Resp.headers.get("x-llm-gateway-upstream"), "cloudflare-524-fallback");
const anthropicResp = await worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { authorization: "Bearer sk-anthropic", "content-type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: "anthropic-model",
    max_tokens: 64,
    system: [{ type: "text", text: "System rules." }],
    messages: [
      { role: "user", content: [{ type: "text", text: "Find info." }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "private chain" }, { type: "text", text: "Sure." }, { type: "tool_use", id: "call_prev", name: "web_search", input: { query: "old" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_prev", content: [{ type: "text", text: "old result" }] }] },
    ],
    tools: [{ name: "web_search", description: "Search web", input_schema: { type: "object", properties: { query: { type: "string" } } } }],
    tool_choice: { type: "tool", name: "web_search" },
  }),
}), anthropicEnv);
const anthropicPayload = await anthropicResp.json();
assert.equal(anthropicResp.status, 200);
assert.equal(anthropicHits[0].messages[0].role, "system");
assert.equal(anthropicHits[0].messages.some((msg) => msg.role === "tool" && msg.tool_call_id === "call_prev"), true);
assert.equal(anthropicHits[0].messages.some((msg) => msg.role === "assistant" && msg.tool_calls?.[0]?.function?.name === "web_search"), true);
assert.equal(anthropicHits[0].messages.some((msg) => String(msg.content || "").includes("private chain")), false);
assert.equal(anthropicHits[0].tools[0].function.parameters.properties.query.type, "string");
assert.equal(anthropicHits[0].tool_choice === "auto" || anthropicHits[0].tool_choice?.function?.name === "web_search", true);
assert.equal(anthropicPayload.type, "message");
assert.equal(anthropicPayload.stop_reason, "tool_use");
assert.equal(anthropicPayload.content.some((block) => block.type === "thinking" && block.thinking.includes("use a tool")), true);
assert.equal(anthropicPayload.content.some((block) => block.type === "tool_use" && block.input.query === "llm"), true);
assert.equal(anthropicPayload.usage.input_tokens, 17);
assert.equal(anthropicPayload.usage.output_tokens, 8);

const anthropicStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { "x-api-key": "sk-anthropic", "content-type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({
    model: "anthropic-stream-model",
    max_tokens: 64,
    temperature: "[undefined]",
    top_p: "[undefined]",
    stop_sequences: "[undefined]",
    stream: true,
    system: [{ type: "text", text: "test", cache_control: "[undefined]" }],
    messages: [{ role: "user", content: [{ type: "text", text: "Use a tool.", cache_control: "[undefined]" }] }],
    tools: "[undefined]",
    tool_choice: "[undefined]",
  }),
}), anthropicEnv);
assert.equal(anthropicStreamResp.headers.get("content-type").includes("text/event-stream"), true);
const anthropicStreamText = await anthropicStreamResp.text();
assert.equal(anthropicStreamHits[0].stream, true);
assert.equal("temperature" in anthropicStreamHits[0], false);
assert.equal("top_p" in anthropicStreamHits[0], false);
assert.equal("stop" in anthropicStreamHits[0], false);
assert.equal("tools" in anthropicStreamHits[0], false);
assert.equal("tool_choice" in anthropicStreamHits[0], false);
assert.equal(anthropicStreamText.includes("event: message_start"), true);
assert.equal(anthropicStreamText.includes("event: ping"), true);
assert.equal(anthropicStreamText.includes('"type":"thinking_delta","thinking":"Checking sources. "'), true);
assert.equal(anthropicStreamText.includes('"type":"text_delta","text":"Checking "'), true);
assert.equal(anthropicStreamText.includes('"type":"input_json_delta","partial_json":"{\\"query\\":"'), true);
assert.equal(anthropicStreamText.includes('"stop_reason":"tool_use"'), true);
assert.equal(anthropicStreamText.includes("event: message_stop"), true);
const anthropicLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), anthropicEnv);
const anthropicLogs = await anthropicLogsResp.json();
const anthropicStreamLog = anthropicLogs.logs.find((entry) => entry.model === "anthropic-stream-model" && entry.path === "/v1/messages");
assert.equal(anthropicStreamLog.finish_reason, "tool_calls");
assert.equal(anthropicStreamLog.tool_calls_count, 1);
const anthropicErrorResp = await worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { "x-api-key": "sk-anthropic", "content-type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: "anthropic-error-model", max_tokens: 8, messages: [{ role: "user", content: "hi" }], stream: true }),
}), anthropicEnv);
const anthropicErrorText = await anthropicErrorResp.text();
assert.equal(anthropicErrorText.includes("event: error"), true, anthropicErrorText);
assert.equal(anthropicErrorText.includes("event: message_stop"), false);

const anthropicResetResp = await worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { "x-api-key": "sk-anthropic", "content-type": "application/json", "anthropic-version": "2023-06-01" },
  body: JSON.stringify({ model: "anthropic-reset-model", max_tokens: 8, messages: [{ role: "user", content: "hi" }], stream: true }),
}), anthropicEnv);
assert.equal(anthropicResetResp.status, 200);
const anthropicResetText = await anthropicResetResp.text();
assert.equal(anthropicResetText.includes('"text":"partial"'), true);
assert.equal(anthropicResetText.includes("event: error"), true, anthropicResetText);

const paymentStore = new Map();
paymentStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "empty-balance", base_url: "https://payment-required.example/v1", api_key_encrypted: "p", models: ["paid-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "paid-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["paid-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const paymentEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = paymentStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { paymentStore.set(key, value); },
    async delete(key) { paymentStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "payment-client", key: "sk-pay", models: ["*"], upstreams: ["empty-balance", "paid-fallback"] }]),
};
const paymentResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-pay", "content-type": "application/json" },
  body: JSON.stringify({ model: "paid-model", messages: [] }),
}), paymentEnv);
assert.equal(paymentHits.length, 1);
assert.equal(paymentResp.headers.get("x-llm-gateway-upstream"), "paid-fallback");

const appErrorStore = new Map();
appErrorStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "app-error", base_url: "https://app-error.example/v1", api_key_encrypted: "e", models: ["minimax-m3"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "app-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["minimax-m3"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const appErrorEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = appErrorStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { appErrorStore.set(key, value); },
    async delete(key) { appErrorStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "app-error-client", key: "sk-app-error", models: ["*"], upstreams: ["app-error", "app-fallback"] }]),
};
const appErrorHitStart = appErrorHits.length;
const appErrorResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-app-error", "content-type": "application/json" },
  body: JSON.stringify({ model: "minimax-m3", messages: [] }),
}), appErrorEnv);
assert.equal(appErrorHits.length, appErrorHitStart + 1);
assert.equal(appErrorResp.headers.get("x-llm-gateway-upstream"), "app-fallback");
const appErrorSpeed = await (await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/speed-test", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "minimax-m3", upstreams: ["app-error"] }),
}), appErrorEnv)).json();
assert.equal(appErrorSpeed.results[0].ok, false);
assert.equal(appErrorSpeed.results[0].status, 502);

const htmlStore = new Map();
htmlStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "html-error", base_url: "https://html-error.example/v1", api_key_encrypted: "h", models: ["html-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "html-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["html-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const htmlEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = htmlStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { htmlStore.set(key, value); },
    async delete(key) { htmlStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "html-client", key: "sk-html", models: ["*"], upstreams: ["html-error", "html-fallback"] }]),
};
const htmlResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-html", "content-type": "application/json" },
  body: JSON.stringify({ model: "html-model", messages: [] }),
}), htmlEnv);
assert.equal(htmlHits.length, 1);
assert.equal(htmlResp.headers.get("x-llm-gateway-upstream"), "html-fallback");
assert.equal((await htmlResp.text()).includes("<!DOCTYPE html>"), false);

const htmlResponsesStore = new Map();
htmlResponsesStore.set("gateway:config", JSON.stringify({
  routing: { failover: false, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "html-response", base_url: "https://html-error.example/v1", api_key_encrypted: "h", models: ["html-response-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const htmlResponsesEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = htmlResponsesStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { htmlResponsesStore.set(key, value); },
    async delete(key) { htmlResponsesStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "html-responses-client", key: "sk-html-resp", models: ["*"], upstreams: ["html-response"] }]),
};
const htmlResponsesResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-html-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "html-response-model", input: "hi" }),
}), htmlResponsesEnv);
const htmlResponsesBody = await htmlResponsesResp.text();
assert.equal(htmlResponsesResp.status, 502);
assert.equal(htmlResponsesBody.includes("<!DOCTYPE html>"), false);
assert.equal(JSON.parse(htmlResponsesBody).error.type, "server_error");

const degradedStore = new Map();
degradedStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "degraded", base_url: "https://degraded.example/v1", api_key_encrypted: "d", models: ["deepseek-v4-flash"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "degraded-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["deepseek-v4-flash"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const degradedEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = degradedStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { degradedStore.set(key, value); },
    async delete(key) { degradedStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "degraded-client", key: "sk-degraded", models: ["*"], upstreams: ["degraded", "degraded-fallback"] }]),
};
const degradedResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-degraded", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
}), degradedEnv);
assert.equal(degradedHits.length, 1);
assert.equal(degradedResp.headers.get("x-llm-gateway-upstream"), "degraded-fallback");

const missingFunctionStore = new Map();
missingFunctionStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "missing-function", base_url: "https://missing-function.example/v1", api_key_encrypted: "m", models: ["deepseek-v4-flash"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "missing-function-fallback", base_url: "https://speed-fast.example/v1", api_key_encrypted: "f", models: ["deepseek-v4-flash"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const missingFunctionEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = missingFunctionStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { missingFunctionStore.set(key, value); },
    async delete(key) { missingFunctionStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "missing-function-client", key: "sk-missing-function", models: ["*"], upstreams: ["missing-function", "missing-function-fallback"] }]),
};
const missingFunctionResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-missing-function", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-v4-flash", messages: [] }),
}), missingFunctionEnv);
assert.equal(missingFunctionHits.length, 1);
assert.equal(missingFunctionResp.headers.get("x-llm-gateway-upstream"), "missing-function-fallback");

const longStreamStore = new Map();
longStreamStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 80, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "long-stream", base_url: "https://long-stream.example/v1", api_key_encrypted: "l", models: ["long-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const longStreamEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = longStreamStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { longStreamStore.set(key, value); },
    async delete(key) { longStreamStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "long-stream-client", key: "sk-long-stream", models: ["*"], upstreams: ["long-stream"] }]),
};
const longStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-long-stream", "content-type": "application/json" },
  body: JSON.stringify({ model: "long-model", messages: [] }),
}), longStreamEnv);
const longActiveRuntimeResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/runtime"), longStreamEnv);
const longActiveRuntime = await longActiveRuntimeResp.json();
assert.equal(longActiveRuntime.active_upstreams["long-stream"] > 0, true);
assert.equal(await longStreamResp.text(), "xxxxx");
const longIdleRuntimeResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/runtime"), longStreamEnv);
const longIdleRuntime = await longIdleRuntimeResp.json();
assert.equal(longIdleRuntime.active_upstreams["long-stream"], undefined);
assert.equal(longStreamHits.length, 1);

const spreadStore = new Map();
spreadStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "busy", base_url: "https://long-stream.example/v1", api_key_encrypted: "b", models: ["spread-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "idle", base_url: "https://speed-fast.example/v1", api_key_encrypted: "i", models: ["spread-model"], paths: ["/v1/chat/completions"], priority: 2, weight: 1, enabled: true },
  ],
}));
const spreadEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = spreadStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { spreadStore.set(key, value); },
    async delete(key) { spreadStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "spread-client", key: "sk-spread", models: ["*"], upstreams: ["busy", "idle"] }]),
};
const spreadBusyResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-spread", "content-type": "application/json" },
  body: JSON.stringify({ model: "spread-model", messages: [] }),
}), spreadEnv);
const spreadResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-spread", "content-type": "application/json" },
  body: JSON.stringify({ model: "spread-model", messages: [] }),
}), spreadEnv);
assert.equal(spreadResp.headers.get("x-llm-gateway-upstream"), "idle");
await spreadBusyResp.text();

const usageStore = new Map();
usageStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "usage-json", base_url: "https://usage.example/v1", api_key_encrypted: "u", models: ["usage-json"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
    { name: "usage-stream", base_url: "https://usage-stream.example/v1", api_key_encrypted: "s", models: ["usage-stream"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const usageEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = usageStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { usageStore.set(key, value); },
    async delete(key) { usageStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "usage-client", key: "sk-usage", models: ["*"], upstreams: ["usage-json", "usage-stream"] }]),
};
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-usage", "content-type": "application/json" },
  body: JSON.stringify({ model: "usage-json", messages: [] }),
}), usageEnv);
const usageJsonResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-usage", "content-type": "application/json" },
  body: JSON.stringify({ model: "usage-json", messages: [] }),
}), usageEnv);
assert.equal(usageJsonResp.headers.get("content-length"), null);
assert.equal(usageJsonResp.headers.get("content-encoding"), null);
const messagesResp = await worker.default.fetch(new Request("https://gw.test/v1/messages", {
  method: "POST",
  headers: { authorization: "Bearer sk-usage", "content-type": "application/json" },
  body: JSON.stringify({ model: "usage-json", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }),
}), usageEnv);
assert.equal(messagesResp.headers.get("content-length"), null);
assert.equal(messagesResp.headers.get("content-encoding"), null);
const usageStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-usage", "content-type": "application/json" },
  body: JSON.stringify({ model: "usage-stream", messages: [], stream: true }),
}), usageEnv);
assert.equal(usageStreamResp.headers.get("content-length"), null);
assert.equal(usageStreamResp.headers.get("content-encoding"), null);
assert.equal(usageStreamResp.headers.get("cache-control"), "no-cache, no-transform");
assert.equal(usageStreamResp.headers.get("x-accel-buffering"), "no");
await usageStreamResp.text();
const usageLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), usageEnv);
const usageLogs = await usageLogsResp.json();
assert.equal(usageLogs.logs.some((entry) => entry.model === "usage-json" && entry.prompt_tokens === 11 && entry.completion_tokens === 22), true);
assert.equal(usageLogs.logs.some((entry) => entry.model === "usage-stream" && entry.prompt_tokens === 7 && entry.completion_tokens === 9), true);
const usageStreamLog = usageLogs.logs.find((entry) => entry.model === "usage-stream");
assert.equal(usageStreamLog.close_reason, "done");
assert.equal(Number.isFinite(usageStreamLog.time_to_first_byte_ms), true);
assert.equal(Number.isFinite(usageStreamLog.time_to_first_token_ms), true);
assert.equal(Number.isFinite(usageStreamLog.max_stream_gap_ms), true);

const toolLogStore = new Map();
toolLogStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "tool-call", base_url: "https://tool-call.example/v1", api_key_encrypted: "t", models: ["tool-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const toolLogEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = toolLogStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { toolLogStore.set(key, value); },
    async delete(key) { toolLogStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "tool-client", key: "sk-tool", models: ["*"], upstreams: ["tool-call"] }]),
};
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-tool", "content-type": "application/json" },
  body: JSON.stringify({ model: "tool-model", messages: [], tools: [{ type: "function", function: { name: "web_search", parameters: {} } }] }),
}), toolLogEnv);
const toolLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), toolLogEnv);
const toolLogs = await toolLogsResp.json();
const toolLog = toolLogs.logs.find((entry) => entry.model === "tool-model");
assert.equal(toolLog.tools_count, 1);
assert.equal(toolLog.tool_calls_count, 1);

const toolStreamStore = new Map();
toolStreamStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "tool-stream", base_url: "https://tool-stream.example/v1", api_key_encrypted: "t", models: ["tool-stream-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const toolStreamEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = toolStreamStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { toolStreamStore.set(key, value); },
    async delete(key) { toolStreamStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "tool-stream-client", key: "sk-tool-stream", models: ["*"], upstreams: ["tool-stream"] }]),
};
const toolStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-tool-stream", "content-type": "application/json" },
  body: JSON.stringify({
    model: "tool-stream-model",
    messages: [],
    stream: true,
    tools: [{ type: "function", function: { name: "web_search", parameters: {} } }],
  }),
}), toolStreamEnv);
const toolStreamText = await toolStreamResp.text();
assert.equal(toolStreamText.includes('"finish_reason":"tool_calls"'), true);
assert.equal(toolStreamText.endsWith("data: [DONE]\n\n"), true);
const toolStreamLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), toolStreamEnv);
const toolStreamLogs = await toolStreamLogsResp.json();
const toolStreamLog = toolStreamLogs.logs.find((entry) => entry.model === "tool-stream-model");
assert.equal(toolStreamLog.close_reason, "finish_grace");
assert.equal(toolStreamLog.finish_reason, "tool_calls");
assert.equal(toolStreamLog.tools_count, 1);
assert.equal(toolStreamLog.tool_calls_count, 1);

const failStore = new Map();
failStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 30000, upstream_cooldown_ttl: 60 },
  upstreams: [
    { name: "boom", base_url: "https://boom.example/v1", api_key_encrypted: "b", models: ["boom-model"], paths: ["/v1/chat/completions"], priority: 1, weight: 1, enabled: true },
  ],
}));
const failEnv = {
  ...env,
  KV: {
    async get(key, type) {
      const value = failStore.get(key);
      return type === "json" && value ? JSON.parse(value) : value || null;
    },
    async put(key, value) { failStore.set(key, value); },
    async delete(key) { failStore.delete(key); },
  },
  CLIENTS_JSON: JSON.stringify([{ name: "fail-client", key: "sk-fail", models: ["*"], upstreams: ["boom"] }]),
};
const failResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-fail", "content-type": "application/json", "x-trace-id": "trace-fail" },
  body: JSON.stringify({ model: "boom-model", messages: [] }),
}), failEnv);
assert.equal(failResp.status, 502);
assert.equal(failResp.headers.get("retry-after"), "1");
assert.equal(failResp.headers.get("x-llm-gateway-trace-id"), "trace-fail");
const failLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), failEnv);
const failLogs = await failLogsResp.json();
assert.equal(failLogs.logs.some((entry) => entry.upstream === "boom" && entry.status === 502), true);
assert.equal(failLogs.logs.some((entry) => entry.trace_id === "trace-fail"), true);

console.log("ok");
