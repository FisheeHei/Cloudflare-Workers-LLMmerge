import fs from "node:fs";
import assert from "node:assert/strict";

const code = fs.readFileSync("_worker.js", "utf8");
const worker = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
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
const fetchUrls = [];
const speedHits = [];
const speedBodies = [];
const hedgeHits = [];
const softFastHits = [];
const nimHits = [];
const responseHits = [];
const responseStreamHits = [];
const paymentHits = [];
const degradedHits = [];
const missingFunctionHits = [];
const disabledHits = [];
const longStreamHits = [];
const usageHits = [];
const wrappedHits = [];
const appErrorHits = [];
const htmlHits = [];
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
    responseStreamHits.push(JSON.parse(init.body));
    return new Response([
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
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
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (String(url).includes("hedge-slow.example")) {
    hedgeHits.push("slow");
    await new Promise((resolve) => setTimeout(resolve, 180));
    return new Response(JSON.stringify({ id: "hedge-slow", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    await new Promise((resolve) => setTimeout(resolve, 180));
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
  if (String(url).includes("nim-limit.example")) {
    nimHits.push("nim");
    return new Response(JSON.stringify({ id: "nim", choices: [{ message: { content: "ok" } }] }), {
      status: 200,
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
  if (String(url).includes("speed-fast.example")) {
    speedHits.push("fast");
    speedBodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "fast", choices: [{ message: { content: "ok" } }] }), {
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
assert.equal(adminPage.includes("upstream-status-emoji"), true);
assert.equal(adminPage.includes("picker-apply-same-preset"), true);
assert.equal(adminPage.includes("class=\"apply-models-same-preset\""), false);
assert.equal(adminPage.includes("toggle-log-expanded"), true);
assert.equal(adminPage.includes("system-prompt-modal"), true);
assert.equal(adminPage.includes("global-context-input"), true);
assert.equal(adminPage.includes("system-prompt-client-scope"), true);
assert.equal(adminPage.includes("global-context-client-scope"), true);
assert.equal(adminPage.includes("prompt-splitter-input"), true);
assert.equal(adminPage.includes("splitPromptContextDraft"), true);
assert.equal(adminPage.includes("context-on-demand"), true);
assert.equal(adminPage.includes("context-items"), true);
assert.equal(adminPage.includes("classifyContextItemsDraft"), true);
assert.equal(adminPage.includes("180000"), true);
assert.equal(adminPage.includes("stream-idle-timeout"), true);
assert.equal(adminPage.includes("900000"), true);
assert.equal(adminPage.includes("@media (max-width: 700px)"), true);
assert.equal(adminPage.includes("id=\"stat-tip\""), true);
assert.equal(adminPage.includes("data-stat-kind"), true);
assert.equal(adminPage.includes("bar-hit"), true);
assert.equal(adminPage.includes("model-tag-filter"), true);
assert.equal(adminPage.includes("renderModelTags"), true);
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
assert.equal(adminPage.includes("upstream-enable-toggle"), true);
assert.equal(adminPage.includes("upstream-group"), true);
assert.equal(adminPage.includes("model-entry-list"), true);
assert.equal(adminPage.includes("model-context-input"), true);
assert.equal(adminPage.includes("delete-model-row"), true);
const configResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/config"), env);
const configPayload = await configResp.json();
assert.equal(configPayload.config.settings.stream_idle_timeout_ms, 900000);
const openRouterPreset = configPayload.presets.find((item) => item.id === "openrouter");
assert.equal(openRouterPreset.name, "OpenRouter");
assert.equal(openRouterPreset.base_url, "https://openrouter.ai/api/v1");
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
  body: JSON.stringify({ model: "minimax-m3", messages: [], reasoning_split: true, enable_thinking: true }),
}), env);

assert.equal("reasoning_split" in bodies[1], false);
assert.equal("enable_thinking" in bodies[1], false);
assert.equal("chat_template_kwargs" in bodies[1], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-reasoner", messages: [], reasoningEffort: "high", reasoningSummary: "auto" }),
}), env);

assert.equal(bodies[2].reasoning_effort, "high");
assert.equal(bodies[2].reasoning.summary, "auto");
assert.equal("reasoningEffort" in bodies[2], false);
assert.equal("reasoningSummary" in bodies[2], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "deepseek-reasoner", messages: [], providerOptions: { openai: { reasoningEffort: "medium", reasoningSummary: "auto", reasoning: { effort: "medium" } } } }),
}), env);

assert.equal(bodies[3].reasoning_effort, "medium");
assert.equal(bodies[3].reasoning.summary, "auto");
assert.equal("providerOptions" in bodies[3], false);

await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "glm-4.6", messages: [], reasoning: { effort: "high" }, reasoningEffort: "high", thinking: {} }),
}), env);

assert.equal("reasoning" in bodies[4], false);
assert.equal("reasoning_effort" in bodies[4], false);
assert.equal("reasoningEffort" in bodies[4], false);
assert.equal("thinking" in bodies[4], false);

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

const exportResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/upstreams/export"), env);
const exported = await exportResp.json();
assert.equal(exportResp.ok, true);
assert.equal(exported.upstreams[0].api_key, "x");
assert.deepEqual(exported.upstreams[0].headers, { "x-test": "1" });
assert.equal(exported.upstreams[1].account_id, "acc123");
assert.equal(exported.upstreams[1].base_url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1");

const waitUntilTasks = [];
await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-test", "content-type": "application/json" },
  body: JSON.stringify({ model: "qwen3", messages: [] }),
}), env, { waitUntil(task) { waitUntilTasks.push(task); } });
assert.equal(waitUntilTasks.length > 0, true);
await Promise.all(waitUntilTasks);
assert.equal(kvPuts.includes("gateway:logs"), true);
assert.equal(kvPuts.some((key) => key.startsWith("gateway:stats:")), true);

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
assert.equal(speedBodies.at(-1).messages[0].content, "Scoped system.");
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
assert.equal(manualSpeed.results.filter((r) => r.ok).length, 2);
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
const beforeSpeedChoice = speedHits.length;
const speedResp = await speedRequest("sk-both");
assert.equal(speedResp.headers.get("x-llm-gateway-upstream"), "fast");
assert.equal(speedHits[beforeSpeedChoice], "fast");

const hedgeStore = new Map();
hedgeStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, hedge_enabled: true, hedge_max: 2, load_balance: false },
  settings: { model_cache_ttl: 3600, request_timeout_ms: 300, upstream_cooldown_ttl: 60 },
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

const softFastStore = new Map();
softFastStore.set("gateway:config", JSON.stringify({
  routing: { failover: true, fast_routing: true, hedge_enabled: false, hedge_max: 2, load_balance: false },
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
  CLIENTS_JSON: JSON.stringify([{ name: "soft-fast-client", key: "sk-soft-fast", models: ["*"], upstreams: ["soft-fast-slow", "soft-fast-fast"] }]),
};
const softFastStart = softFastHits.length;
const softFastResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-soft-fast", "content-type": "application/json" },
  body: JSON.stringify({ model: "soft-fast-model", messages: [] }),
}), softFastEnv);
assert.equal(softFastResp.headers.get("x-llm-gateway-upstream"), "soft-fast-fast");
assert.deepEqual(softFastHits.slice(softFastStart), ["slow", "fast"]);

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
  CLIENTS_JSON: JSON.stringify([{ name: "responses-client", key: "sk-resp", models: ["*"], upstreams: ["responses", "responses-stream"] }]),
};
const responsesResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "resp-model", instructions: "be terse", input: "hi", max_output_tokens: 8, reasoningEffort: "medium", reasoningSummary: "auto" }),
}), responsesEnv);
const responsesPayload = await responsesResp.json();
assert.equal(responsesResp.status, 200);
assert.equal(responsesResp.headers.get("content-length"), null);
assert.equal(responsesResp.headers.get("content-encoding"), null);
assert.equal(responseHits[0].messages[0].role, "system");
assert.equal(responseHits[0].messages[1].content, "hi");
assert.equal(responseHits[0].max_tokens, 8);
assert.equal(responseHits[0].reasoning_effort, "medium");
assert.equal("reasoningEffort" in responseHits[0], false);
assert.equal("reasoningSummary" in responseHits[0], false);
assert.equal(responsesPayload.object, "response");
assert.equal(responsesPayload.output_text, "hello");
assert.equal(responsesPayload.usage.input_tokens, 3);

const responsesStreamResp = await worker.default.fetch(new Request("https://gw.test/v1/responses", {
  method: "POST",
  headers: { authorization: "Bearer sk-resp", "content-type": "application/json" },
  body: JSON.stringify({ model: "stream-model", input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }], stream: true }),
}), responsesEnv);
assert.equal(responsesStreamResp.headers.get("content-type").includes("text/event-stream"), true);
assert.equal(responsesStreamResp.headers.get("cache-control"), "no-cache, no-transform");
assert.equal(responsesStreamResp.headers.get("x-accel-buffering"), "no");
const responsesStreamText = await responsesStreamResp.text();
assert.equal(responseStreamHits[0].stream, true);
assert.equal(responsesStreamText.includes('"type":"response.output_text.delta"'), true);
assert.equal(responsesStreamText.includes('"delta":"hel"'), true);
assert.equal(responsesStreamText.includes('"type":"response.completed"'), true);

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
const appErrorResp = await worker.default.fetch(new Request("https://gw.test/v1/chat/completions", {
  method: "POST",
  headers: { authorization: "Bearer sk-app-error", "content-type": "application/json" },
  body: JSON.stringify({ model: "minimax-m3", messages: [] }),
}), appErrorEnv);
assert.equal(appErrorHits.length, 1);
assert.equal(appErrorResp.headers.get("x-llm-gateway-upstream"), "app-fallback");

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
