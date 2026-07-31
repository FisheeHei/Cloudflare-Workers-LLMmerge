import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const worker = await import(`${pathToFileURL(`${process.cwd()}/_worker.js`).href}?translator=${Date.now()}`);
const store = new Map();
const jsonValue = (value) => typeof value === "string" ? JSON.parse(value) : value;

globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target.includes("stdtime.gov.hk")) return new Response(null, { status: 200, headers: { date: "Fri, 31 Jul 2026 04:00:00 GMT" } });
  if (target.includes("translate.example")) {
    const request = JSON.parse(init.body);
    const items = JSON.parse(request.messages[1].content).items;
    const isReview = request.messages[0].content.includes("Review Japanese or English game translations");
    const content = isReview
      ? { reviews: items.map((item) => ({ id: item.id, ok: false, reason: "test", suggestion: "", translation: "复核后的中文" })) }
      : { translations: items.map((item) => ({ id: item.id, text: "测试中文" })) };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`Unexpected fetch: ${target}`);
};

const env = {
  ADMIN_TOKEN: "admin",
  KV: {
    async get(key, type) {
      const value = store.get(key);
      if (value == null) return null;
      return type === "json" || type?.type === "json" ? jsonValue(value) : value;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  },
  UPSTREAMS_JSON: JSON.stringify([{ name: "translate", base_url: "https://translate.example/v1", api_key: "test", models: ["translate-model"], paths: ["/v1/chat/completions"] }]),
  CLIENTS_JSON: JSON.stringify([{ id: "translator-client", name: "translator-client", key: "sk-translator", models: ["*"], upstreams: ["translate"] }]),
};
const ctx = { waitUntil() {} };
const admin = (path, init) => worker.default.fetch(new Request(`https://gw.test/admin/api${path}`, init), env, ctx);

const create = await admin("/translator/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ source: { greeting: "Hello, world!", japanese: "こんにちは", code: "MENU_START" }, client_id: "translator-client", model: "translate-model" }),
});
assert.equal(create.status, 201);
const created = await create.json();
assert.equal(created.job.status, "running");

await worker.default.scheduled({}, env, ctx);
const statusResponse = await admin(`/translator/jobs/${created.job.id}`);
const status = await statusResponse.json();
assert.equal(status.job.status, "completed");
assert.equal(status.job.completed_batches, 1);

const download = await admin(`/translator/jobs/${created.job.id}/download`);
assert.equal(download.status, 200);
const translated = await download.json();
assert.equal(translated.greeting, "测试中文");
assert.equal(translated.japanese, "测试中文");
assert.equal(translated.code, "MENU_START");

const review = await admin(`/translator/jobs/${created.job.id}/review`, { method: "POST" });
assert.equal(review.status, 202);
await worker.default.scheduled({}, env, ctx);
const reviewed = await (await admin(`/translator/jobs/${created.job.id}`)).json();
assert.equal(reviewed.job.status, "completed");
assert.equal(reviewed.job.phase, "review");
const reviewedResult = await (await admin(`/translator/jobs/${created.job.id}/download`)).json();
assert.equal(reviewedResult.greeting, "复核后的中文");
assert.equal(reviewedResult.japanese, "复核后的中文");
assert.equal(reviewedResult.code, "MENU_START");

console.log("json translator ok");
