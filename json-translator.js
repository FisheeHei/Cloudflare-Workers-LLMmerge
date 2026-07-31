const JP_OR_CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
const NUMBER_ONLY = /^[\s\d.,:+\-*\/%()\[\]{}]+$/;
const ASCII_ONLY = /^[\x00-\x7f]+$/;
const ASCII_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_./\\-]*(?:\([^\r\n]*\))?$/;
const ENGLISH_WORD = /[A-Za-z]{2,}/;
const NATURAL_TEXT_SEPARATOR = /[\s.,!?;:'"()[\]{}]/;
const CREDIT_LINE = /(?:制作|作曲|音楽|BGM|SE|著作|原画|声優|CV)\s*[:：]/i;
const PROTECTED = /\\(?:V|N|P|G|C|I)\[\d+\]|\\[{}$.|!^><]|\bEV\d+\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_./\\-]*\b|https?:\/\/\S+|`[^`]*`/g;

export const TRANSLATOR_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const TRANSLATOR_MAX_STATE_BYTES = 20 * 1024 * 1024;
export const TRANSLATOR_BATCH_SIZE = 45;
export const TRANSLATOR_BATCH_MAX_CHARS = 6000;

export const TRANSLATOR_SYSTEM_PROMPT = `You are a professional Japanese-or-English-to-Simplified-Chinese game localizer.
The source may contain Japanese, English, Chinese, or mixed text; translate natural Japanese and English text into Simplified Chinese.
Translate only the current values naturally and faithfully. Preserve tone, variables, RPGMaker control codes,
resource IDs, URLs, protected tokens, and line breaks. Do not translate names, credits, filenames, script commands,
or ASCII identifiers. Adult content is allowed and must be translated faithfully without omission or moralizing.
Return JSON only: {"translations":[{"id":0,"text":"..."}]}. Include every requested id exactly once.`;

export const TRANSLATOR_REVIEW_PROMPT = `Review Japanese or English game translations into Simplified Chinese. Return JSON only:
{"reviews":[{"id":0,"ok":true,"reason":"","suggestion":"","translation":"full Chinese value"}]}.
Mark ok=false only for a real mistranslation, omission, untranslated Japanese, damaged protected token, or broken control code.
Return every requested id exactly once and preserve an acceptable translation unchanged.`;

export function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Source must be a JSON object.");
  }
  for (const value of Object.values(source)) {
    if (typeof value !== "string") throw new Error("Every JSON value must be a string.");
  }
  return source;
}

function shouldSkip(text) {
  const value = String(text || "");
  const stripped = value.trim();
  if (!stripped || NUMBER_ONLY.test(stripped) || CREDIT_LINE.test(value)) return true;
  if (ASCII_ONLY.test(value) && (value.includes("_") || ASCII_IDENTIFIER.test(stripped))) return true;
  if (JP_OR_CJK.test(value)) return false;
  if (ASCII_ONLY.test(value) && ENGLISH_WORD.test(value) && NATURAL_TEXT_SEPARATOR.test(stripped)) return false;
  return true;
}

function protect(text) {
  const values = [];
  const protectedText = String(text || "").replace(PROTECTED, (value) => {
    values.push(value);
    return `__KEEP_${values.length - 1}__`;
  });
  return { text: protectedText, values };
}

function restore(text, values) {
  return values.reduce((result, value, index) => result.replaceAll(`__KEEP_${index}__`, value), String(text || ""));
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
}

export function buildTranslationItems(source) {
  return Object.entries(validateSource(source)).flatMap(([key, value], index) => {
    const text = String(value).replace(/\r\n?/g, "\n");
    if (shouldSkip(text)) return [];
    const protectedValue = protect(text);
    return [{ id: index, key, source: text, text: protectedValue.text, tokens: protectedValue.values }];
  });
}

export function buildBatches(items, size = TRANSLATOR_BATCH_SIZE, maxChars = TRANSLATOR_BATCH_MAX_CHARS) {
  const batches = [];
  let batch = [];
  let chars = 0;
  for (const item of items) {
    const itemChars = item.text.length;
    if (batch.length && (batch.length >= size || chars + itemChars > maxChars)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(item);
    chars += itemChars;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function translationRequestBody(model, batch, extraPrompt = "", reasoningEffort = "low") {
  const systemPrompt = extraPrompt
    ? TRANSLATOR_SYSTEM_PROMPT + "\n\nAdditional translation requirement:\n" + String(extraPrompt).trim()
    : TRANSLATOR_SYSTEM_PROMPT;
  return {
    model,
    stream: false,
    temperature: 0.2,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ items: batch.map(({ id, text }) => ({ id, text })) }) },
    ],
  };
}

export function reviewRequestBody(model, batch, translated, reasoningEffort = "low") {
  return {
    model,
    stream: false,
    temperature: 0.1,
    reasoning_effort: reasoningEffort,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TRANSLATOR_REVIEW_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          items: batch.map((item) => ({ id: item.id, source: item.source, translation: translated[item.id] || item.source })),
        }),
      },
    ],
  };
}

function responseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
}

function parseJsonContent(payload) {
  const content = responseContent(payload).replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Translator returned no JSON object.");
  return JSON.parse(content.slice(start, end + 1));
}

export function parseTranslationResponse(payload, batch) {
  const rows = parseJsonContent(payload).translations;
  if (!Array.isArray(rows)) throw new Error("Translator response has no translations array.");
  const expected = new Map(batch.map((item) => [item.id, item]));
  const result = {};
  for (const row of rows) {
    const id = Number(row?.id);
    if (!expected.has(id) || typeof row?.text !== "string" || Object.prototype.hasOwnProperty.call(result, id)) {
      throw new Error("Translator response contains invalid or duplicate ids.");
    }
    result[id] = restore(row.text, expected.get(id).tokens);
  }
  if (Object.keys(result).length !== batch.length) throw new Error("Translator response is missing ids.");
  return result;
}

export function parseReviewResponse(payload, batch) {
  const rows = parseJsonContent(payload).reviews;
  if (!Array.isArray(rows)) throw new Error("Review response has no reviews array.");
  const expected = new Map(batch.map((item) => [item.id, item]));
  const result = {};
  for (const row of rows) {
    const id = Number(row?.id);
    if (!expected.has(id) || typeof row?.translation !== "string" || Object.prototype.hasOwnProperty.call(result, id)) {
      throw new Error("Review response contains invalid or duplicate ids.");
    }
    result[id] = {
      ok: row.ok === true,
      reason: String(row.reason || ""),
      suggestion: String(row.suggestion || ""),
      translation: restore(row.translation, expected.get(id).tokens),
    };
  }
  if (Object.keys(result).length !== batch.length) throw new Error("Review response is missing ids.");
  return result;
}

export function applyBatch(result, updates) {
  const next = { ...result };
  for (const [id, value] of Object.entries(updates)) {
    const item = String(id);
    if (typeof value === "string") setOwn(next, item, value);
    else if (value && typeof value.translation === "string") setOwn(next, item, value.translation);
  }
  return next;
}

export function sourceToResult(source, items) {
  const result = Object.create(null);
  for (const [key, value] of Object.entries(validateSource(source))) setOwn(result, key, value);
  for (const item of items) setOwn(result, item.key, item.source);
  return result;
}

export function resultFromItems(source, items, resultById) {
  const result = sourceToResult(source, items);
  for (const item of items) setOwn(result, item.key, resultById[item.id] || item.source);
  return result;
}

export function reviewIssues(reviews) {
  return Object.entries(reviews)
    .filter(([, review]) => review && review.ok !== true)
    .map(([id, review]) => ({ id: Number(id), reason: review.reason, suggestion: review.suggestion }));
}
