import fs from "node:fs";
import assert from "node:assert/strict";

const code = fs.readFileSync("_worker.js", "utf8");
const worker = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const bodies = [];
const kvPuts = [];
const kvStore = new Map();
globalThis.fetch = async (_url, init) => {
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
    { name: "nim", base_url: "https://integrate.api.nvidia.com/v1", api_key: "x", models: ["*"], paths: ["/v1/chat/completions"] },
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

console.log("ok");
