import {
  chatContentToText,
  modelsMatch,
  normalizeStringArray,
  parseNonNegativeInt,
  stableHash32,
} from "./gateway-primitives.js";

const SUBAGENT_PROMPT = "When the task benefits from parallel investigation or isolated implementation, use subagents to perform the work.";

export function normalizeContextItems(items) {
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

export function prepareGatewayChatBody(bodyText, settings, client) {
  if (!bodyText) return { bodyText, injection: null };
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { bodyText, injection: null };
  }

  if (!Array.isArray(payload.messages)) return { bodyText, injection: null };
  const injection = gatewayInjectionSnapshot(payload, settings, client);
  const injected = [];
  if (injection.system_text) {
    injected.push({ role: "system", content: injection.system_text });
  }
  if (injection.context_text) {
    injected.push({
      role: settings?.context_role || "system",
      content: gatewayContextText(injection.context_text),
    });
  }
  const originalMessages = payload.messages;
  const trimmedMessages = trimGatewayHistory(originalMessages, settings?.history_max_chars);
  const historyTrimmed = trimmedMessages.length < originalMessages.length;
  if (!injection.applied && !historyTrimmed) return { bodyText, injection };
  payload.messages = injected.concat(trimmedMessages);
  injection.history_trimmed = historyTrimmed;
  injection.hash = gatewayInjectionHash(injection, settings);
  return { bodyText: JSON.stringify(payload), injection };
}

export function prepareGatewayCompletionsBody(bodyText, settings, client) {
  let payload;
  try { payload = JSON.parse(bodyText); } catch { return { bodyText, injection: null }; }
  const prompts = Array.isArray(payload?.prompt)
    ? payload.prompt.map((value) => String(value == null ? "" : value))
    : [String(payload?.prompt || "")];
  const prompt = prompts.join("\n\n");
  const injection = gatewayInjectionSnapshot({ model: payload?.model, messages: [{ role: "user", content: prompt }] }, settings, client);
  if (!injection.applied) return { bodyText, injection };
  const prefix = [
    injection.system_text,
    injection.context_text ? gatewayContextText(injection.context_text) : "",
  ].filter(Boolean).join("\n\n");
  const prepend = (value) => [prefix, value].filter(Boolean).join("\n\n");
  payload.prompt = Array.isArray(payload.prompt) ? prompts.map(prepend) : prepend(prompts[0]);
  return { bodyText: JSON.stringify(payload), injection };
}

export function gatewayInjectionSnapshot(payload, settings, client) {
  const plan = gatewayInjectionPlan(payload, settings, client);
  const snapshot = {
    applied: Boolean(plan.systemText || plan.contextText),
    model: String(payload?.model || ""),
    system_text: plan.systemText,
    context_text: plan.contextText,
    system_chars: plan.systemText.length,
    context_chars: plan.contextText.length,
    item_count: plan.contextText ? (plan.contextText.match(/^\[[^\]]+\]/gm) || []).length : 0,
    history_trimmed: false,
  };
  snapshot.hash = gatewayInjectionHash(snapshot, settings);
  return snapshot;
}

export function gatewayContextText(contextText) {
  return "Gateway reference context. Use it when relevant, but do not mention it unless the user asks.\n\n" + contextText;
}

export function gatewayInjectionPlan(payload, settings, client) {
  const clientIds = clientIdentitySet(client);
  const systemText = promptAppliesToClient(settings?.system_prompt_clients, client, clientIds) ? String(settings?.system_prompt || "").trim() : "";
  const subagentClients = normalizeStringArray(settings?.subagent_prompt_clients);
  const subagentText = subagentClients.length && promptAppliesToClient(subagentClients, client, clientIds) ? SUBAGENT_PROMPT : "";
  const items = Array.isArray(settings?.context_items) ? settings.context_items : [];
  const hasContext = (promptAppliesToClient(settings?.global_context_clients, client, clientIds) && String(settings?.global_context || "").trim()) ||
    (settings?.context_on_demand === true && items.some((item) => item && item.enabled !== false && item.text));
  return {
    systemText: [systemText, subagentText].filter(Boolean).join("\n\n"),
    contextText: hasContext ? selectGatewayContext(payload, settings, client, clientIds) : "",
  };
}

function gatewayInjectionHash(injection, settings) {
  return stableHash32([
    injection.model || "",
    injection.system_text || "",
    injection.context_text || "",
    settings?.context_role || "system",
    settings?.history_max_chars || 0,
  ].join("\n")).toString(16).padStart(8, "0");
}

function trimGatewayHistory(messages, maxChars) {
  const limit = parseNonNegativeInt(maxChars, 0, 2_000_000);
  if (!limit || !Array.isArray(messages) || messages.length < 2) return messages;

  const instructions = [];
  const history = [];
  for (const message of messages) {
    if (["system", "developer"].includes(String(message?.role || ""))) instructions.push(message);
    else history.push(message);
  }
  const budget = Math.max(0, limit - chatMessagesChars(instructions));
  if (!history.length || budget <= 0) return instructions.concat(history.slice(-1));

  const groups = chatHistoryGroups(history);
  const kept = [];
  let used = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    const chars = chatMessagesChars(group);
    if (!kept.length || used + chars <= budget) {
      kept.unshift(...group);
      used += chars;
    } else {
      break;
    }
  }
  return instructions.concat(kept);
}

function chatHistoryGroups(messages) {
  const groups = [];
  let current = [];
  for (const message of messages) {
    if (String(message?.role || "") === "user" && current.length) {
      groups.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) groups.push(current);
  return groups;
}

function chatMessagesChars(messages) {
  try {
    return JSON.stringify(messages || []).length;
  } catch {
    return (messages || []).map((message) => chatContentToText(message?.content || "")).join("").length;
  }
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
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority);
  const alwaysClients = normalizeStringArray(settings?.context_always_clients);
  const forceAll = alwaysClients.length && promptAppliesToClient(alwaysClients, client, clientIds);
  const picked = forceAll
    ? candidates
    : candidates.filter((hit) => hit.score > 0).slice(0, Math.max(1, Math.min(3, Number(settings.context_item_limit || 1))));
  if (!picked.length) return base;

  let remaining = Math.max(500, Number(settings.context_max_chars || 800));
  const parts = [];
  for (const { item } of picked) {
    if (remaining <= 0) break;
    const text = item.text.slice(0, Math.min(remaining, item.max_chars || remaining));
    parts.push(`[${item.title}]\n${text}`);
    remaining -= text.length;
  }
  return [base, ...parts].filter(Boolean).join("\n\n");
}

function contextScopeMatches(scope, client, clientIds) {
  return !normalizeStringArray(scope).length || promptAppliesToClient(scope, client, clientIds);
}

function contextModelMatches(scope, model) {
  const list = Array.isArray(scope) ? scope : normalizeStringArray(scope);
  if (!list.length || list.includes("*")) return true;
  return list.some((item) => modelsMatch(model, item));
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

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
