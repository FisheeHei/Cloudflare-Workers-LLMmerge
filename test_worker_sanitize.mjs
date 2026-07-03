import fs from "node:fs";
import assert from "node:assert/strict";

const code = fs.readFileSync("_worker.js", "utf8");
const worker = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const bodies = [];
const fetchUrls = [];
const speedHits = [];
const kvPuts = [];
const kvStore = new Map();
globalThis.fetch = async (url, init) => {
  fetchUrls.push(String(url));
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

const statsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/stats"), env);
const stats = await statsResp.json();
assert.equal(stats.buckets.some((b) => b.total >= 2), true);
assert.equal(stats.last_model, "minimax-m3");

const logsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), env);
const logs = await logsResp.json();
assert.equal(logs.logs.length, 2);
assert.equal(kvPuts.length, 0);

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

const exportResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/upstreams/export"), env);
const exported = await exportResp.json();
assert.equal(exportResp.ok, true);
assert.equal(exported.upstreams[0].api_key, "x");
assert.deepEqual(exported.upstreams[0].headers, { "x-test": "1" });
assert.equal(exported.upstreams[1].account_id, "acc123");
assert.equal(exported.upstreams[1].base_url, "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1");

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
const beforeSpeedChoice = speedHits.length;
const speedResp = await speedRequest("sk-both");
assert.equal(speedResp.headers.get("x-llm-gateway-upstream"), "fast");
assert.equal(speedHits[beforeSpeedChoice], "fast");

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
  headers: { authorization: "Bearer sk-fail", "content-type": "application/json" },
  body: JSON.stringify({ model: "boom-model", messages: [] }),
}), failEnv);
assert.equal(failResp.status, 502);
const failLogsResp = await worker.default.fetch(new Request("https://gw.test/llmmerge-admin/api/logs"), failEnv);
const failLogs = await failLogsResp.json();
assert.equal(failLogs.logs.some((entry) => entry.upstream === "boom" && entry.status === 502), true);

console.log("ok");
