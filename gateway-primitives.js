export function modelSuffix(model) {
  const clean = String(model || "").replace(/^@cf\//, "");
  const parts = clean.split("/").filter(Boolean);
  return parts[parts.length - 1] || clean;
}

function isQwenModel(model) {
  return String(model || "").toLowerCase().includes("qwen");
}

function isLooseAliasModel(model) {
  return isQwenModel(model) || /(^|[\/_\.-])glm([\/_\.-]|$)/i.test(String(model || ""));
}

export function modelsMatch(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!isLooseAliasModel(a) && !isLooseAliasModel(b)) return false;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  return lowerA === lowerB || modelSuffix(a).toLowerCase() === modelSuffix(b).toLowerCase();
}

export function chatContentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : String(part?.text || part?.content || "")).join("");
}

export function parseNonNegativeInt(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export function stableHash32(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}
