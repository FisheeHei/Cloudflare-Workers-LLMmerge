export function isNvidiaNimUpstream(upstream) {
  return String(upstream?.preset || "") === "nvidia-nim" || String(upstream?.base_url || "").toLowerCase().includes("integrate.api.nvidia.com");
}

export function sanitizeProxyBody(bodyText, upstream) {
  if (!bodyText) return bodyText;

  const bodyLower = bodyText.toLowerCase();
  if (!bodyNeedsSanitizing(bodyText, bodyLower)) return bodyText;

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  let changed = false;
  const modelName = String(payload.model || "").toLowerCase();
  const bridge = providerModelBridge(upstream, modelName);
  const isGlm = isGlmModel(modelName);
  const wantsKimiPreservedThinking = (bridge.provider === "nim" || bridge.provider === "moonshot") && kimiPreservedThinkingRequested(payload, modelName);
  changed = applyProviderReasoningOptions(payload) || changed;
  changed = normalizeReasoningFields(payload, isGlm && bridge.provider !== "zhipu", wantsKimiPreservedThinking || bridge.provider !== "none") || changed;
  changed = applyKimiPreservedThinking(payload, wantsKimiPreservedThinking) || changed;
  if (bridge.provider === "deepseek") changed = applyDeepSeekBridge(payload) || changed;
  if (bridge.provider === "moonshot") changed = applyMoonshotBridge(payload, modelName) || changed;
  if (bridge.provider === "minimax") changed = applyMiniMaxBridge(payload) || changed;
  if (bridge.provider === "openrouter") changed = applyOpenRouterBridge(payload) || changed;
  if (bridge.provider === "zhipu") changed = applyZhipuBridge(payload) || changed;
  if (bridge.provider === "openai") changed = applyGenericOpenAiBridge(payload, { keepReasoningEffort: bridge.family !== "workers-ai" }) || changed;
  if (bridge.provider === "nim") changed = applyNimBridge(payload, modelName, bridge.family) || changed;

  return changed ? JSON.stringify(payload) : bodyText;
}

function providerModelBridge(upstream, modelName) {
  if (isNvidiaNimUpstream(upstream)) return { provider: "nim", family: modelFamily(modelName) };
  if (isDeepSeekUpstream(upstream)) return { provider: "deepseek", family: modelFamily(modelName) };
  if (isMoonshotUpstream(upstream)) return { provider: "moonshot", family: modelFamily(modelName) };
  if (isMiniMaxUpstream(upstream)) return { provider: "minimax", family: modelFamily(modelName) };
  if (isOpenRouterUpstream(upstream)) return { provider: "openrouter", family: modelFamily(modelName) };
  if (isZhipuUpstream(upstream)) return { provider: "zhipu", family: modelFamily(modelName) };
  if (isGenericOpenAiUpstream(upstream)) return { provider: "openai", family: isWorkersAiUpstream(upstream) ? "workers-ai" : modelFamily(modelName) };
  return { provider: "none", family: modelFamily(modelName) };
}

function modelFamily(modelName) {
  if (isGlmModel(modelName)) return "glm";
  if (isMiniMaxM3Model(modelName)) return "minimax-m3";
  if (isKimiModel(modelName)) return "kimi";
  if (isDeepSeekModel(modelName)) return "deepseek";
  if (String(modelName).includes("qwen")) return "qwen";
  if (isNemotron3Model(modelName)) return "nemotron-3";
  if (isNemotronModel(modelName)) return "nemotron";
  if (isMistralModel(modelName)) return "mistral";
  if (isStepModel(modelName)) return "step";
  if (isGptOssModel(modelName)) return "gpt-oss";
  if (isSarvamModel(modelName)) return "sarvam";
  return "generic";
}

function glmThinkingRequested(payload) {
  return Boolean(
    payload?.reasoning ||
    payload?.reasoning_effort ||
    payload?.reasoningEffort ||
    payload?.reasoning_summary ||
    payload?.reasoningSummary ||
    payload?.thinking ||
    payload?.enable_thinking === true ||
    payload?.chat_template_kwargs?.enable_thinking === true
  );
}

function bodyNeedsSanitizing(bodyText, bodyLower) {
  return bodyText.includes('"thinking"') ||
    bodyText.includes('"reasoning"') ||
    bodyText.includes('"reasoning_effort"') ||
    bodyText.includes('"reasoningEffort"') ||
    bodyText.includes('"reasoning_summary"') ||
    bodyText.includes('"reasoningSummary"') ||
    bodyText.includes('"providerOptions"') ||
    bodyText.includes('"provider_options"') ||
    bodyText.includes('"reasoning_split"') ||
    bodyText.includes('"enable_thinking"') ||
    bodyText.includes('"chat_template_kwargs"') ||
    bodyLower.includes("kimi-k2") ||
    bodyText.includes('"functions"') ||
    bodyText.includes('"function_call"') ||
    bodyText.includes('"tool_choice"') ||
    bodyText.includes('"temperature"') ||
    bodyLower.includes("minimax-m3");
}

function applyProviderReasoningOptions(payload) {
  let changed = false;
  const providerOptions = payload.providerOptions || payload.provider_options;
  const openaiOptions = providerOptions && typeof providerOptions === "object"
    ? providerOptions.openai || providerOptions.openAI || providerOptions.gateway
    : null;
  if (openaiOptions && typeof openaiOptions === "object") {
    if (openaiOptions.reasoningEffort != null && !("reasoning_effort" in payload)) {
      payload.reasoning_effort = openaiOptions.reasoningEffort;
      changed = true;
    }
    if (openaiOptions.reasoning_effort != null && !("reasoning_effort" in payload)) {
      payload.reasoning_effort = openaiOptions.reasoning_effort;
      changed = true;
    }
    if (openaiOptions.reasoning != null && !("reasoning" in payload)) {
      payload.reasoning = openaiOptions.reasoning;
      changed = true;
    }
    if (openaiOptions.reasoningSummary != null && !payload.reasoning?.summary) {
      changed = setReasoningSummary(payload, openaiOptions.reasoningSummary) || changed;
    }
  }
  if ("providerOptions" in payload) {
    delete payload.providerOptions;
    changed = true;
  }
  if ("provider_options" in payload) {
    delete payload.provider_options;
    changed = true;
  }
  return changed;
}

function normalizeReasoningFields(payload, isGlm, keepThinking = false) {
  let changed = false;
  if (!isGlm && payload.reasoning && typeof payload.reasoning === "object" && payload.reasoning.effort != null && !("reasoning_effort" in payload)) {
    payload.reasoning_effort = payload.reasoning.effort;
    changed = true;
  }
  if ("reasoningSummary" in payload && !payload.reasoning?.summary) {
    changed = setReasoningSummary(payload, payload.reasoningSummary) || changed;
  }
  if (!isGlm && "reasoningEffort" in payload && !("reasoning_effort" in payload)) {
    payload.reasoning_effort = payload.reasoningEffort;
    changed = true;
  }
  if ("reasoningEffort" in payload) {
    delete payload.reasoningEffort;
    changed = true;
  }
  if ("reasoningSummary" in payload) {
    delete payload.reasoningSummary;
    changed = true;
  }
  if ("reasoning_summary" in payload) {
    delete payload.reasoning_summary;
    changed = true;
  }
  if ("thinking" in payload && !keepThinking) {
    delete payload.thinking;
    changed = true;
  }
  return changed;
}

function kimiPreservedThinkingRequested(payload, modelName) {
  if (!isKimiModel(modelName) || /kimi[\/_.-]*k2[\/_.-]*7[\/_.-]*code/i.test(modelName)) return false;
  return /kimi[\/_.-]*k2/i.test(modelName) || glmThinkingRequested(payload);
}

function applyKimiPreservedThinking(payload, enabled) {
  if (!enabled) return false;
  const current = payload.thinking && typeof payload.thinking === "object" ? payload.thinking : {};
  if (current.type === "enabled" && current.keep === "all") return false;
  payload.thinking = { ...current, type: "enabled", keep: "all" };
  return true;
}

export function isGlmModel(modelName) {
  return /(^|[\/_.-])glm([\/_.-]|$)/i.test(String(modelName || ""));
}

export function isMiniMaxM3Model(modelName) {
  return /(^|[\/_.-])minimax[\/_.-]*m3([\/_.-]|$)/i.test(String(modelName || ""));
}

function isKimiModel(model) {
  return /(^|[\/_.-])kimi([\/_.-]|$)/i.test(String(model || ""));
}

function isDeepSeekModel(modelName) {
  return /(^|[\/_.-])deepseek([\/_.-]|$)/i.test(String(modelName || ""));
}

function isDeepSeekUpstream(upstream) {
  return String(upstream?.preset || "") === "deepseek" || String(upstream?.base_url || "").toLowerCase().includes("api.deepseek.com");
}

function isMoonshotUpstream(upstream) {
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return String(upstream?.preset || "") === "moonshot" || baseUrl.includes("api.moonshot.ai") || baseUrl.includes("api.kimi.com");
}

function isMiniMaxUpstream(upstream) {
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return String(upstream?.preset || "") === "minimax" || baseUrl.includes("api.minimax.io") || baseUrl.includes("api.minimaxi.com");
}

function isOpenRouterUpstream(upstream) {
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return String(upstream?.preset || "") === "openrouter" || baseUrl.includes("openrouter.ai");
}

function isZhipuUpstream(upstream) {
  const preset = String(upstream?.preset || "");
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return preset === "zhipu" || preset === "zhipu-coding" || baseUrl.includes("open.bigmodel.cn");
}

function isWorkersAiUpstream(upstream) {
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return String(upstream?.preset || "") === "workers-ai" || (baseUrl.includes("api.cloudflare.com/client/v4/accounts/") && baseUrl.includes("/ai/v1"));
}

function isGenericOpenAiUpstream(upstream) {
  const preset = String(upstream?.preset || "");
  const baseUrl = String(upstream?.base_url || "").toLowerCase();
  return ["deepinfra", "together", "workers-ai", "custom"].includes(preset) ||
    baseUrl.includes("deepinfra.com") ||
    baseUrl.includes("together.xyz") ||
    isWorkersAiUpstream(upstream);
}

function isStepModel(modelName) {
  return /(^|[\/_.-])(step|stepfun|step-ai)([\/_.-]|$)/i.test(String(modelName || ""));
}

function isNemotronModel(modelName) {
  return /(^|[\/_.-])nemotron([\/_.-]|$)/i.test(String(modelName || ""));
}

function isNemotron3Model(modelName) {
  return /(^|[\/_.-])nemotron[\/_.-]*3([\/_.-]|$)/i.test(String(modelName || ""));
}

function isMistralModel(modelName) {
  return /(^|[\/_.-])(mistral|mixtral|codestral|magistral)([\/_.-]|$)/i.test(String(modelName || ""));
}

function isGptOssModel(modelName) {
  return /(^|[\/_.-])gpt[\/_.-]*oss([\/_.-]|$)/i.test(String(modelName || ""));
}

function isSarvamModel(modelName) {
  return /(^|[\/_.-])sarvam([\/_.-]|$)/i.test(String(modelName || ""));
}

function applyDeepSeekBridge(payload) {
  let changed = false;
  if (deepSeekReasoningRequested(payload)) {
    const disabled = deepSeekReasoningDisabled(payload);
    payload.thinking = { type: disabled ? "disabled" : "enabled" };
    changed = true;
    if (disabled) {
      if ("reasoning_effort" in payload) { delete payload.reasoning_effort; changed = true; }
    } else {
      const effort = mapDeepSeekEffort(deepSeekEffortInput(payload));
      if (effort) { payload.reasoning_effort = effort; changed = true; }
      else if ("reasoning_effort" in payload) { delete payload.reasoning_effort; changed = true; }
    }
  }
  for (const key of ["reasoning", "reasoning_budget", "reasoningBudget", "reasoning_split", "enable_thinking", "chat_template_kwargs"]) {
    if (key in payload) { delete payload[key]; changed = true; }
  }
  return changed;
}

function deepSeekReasoningRequested(payload) {
  return Boolean(
    payload?.reasoning ||
    payload?.reasoning_effort ||
    payload?.reasoningEffort ||
    payload?.reasoning_summary ||
    payload?.reasoningSummary ||
    payload?.thinking != null ||
    payload?.enable_thinking != null ||
    payload?.chat_template_kwargs?.enable_thinking != null
  );
}

function deepSeekReasoningDisabled(payload) {
  const effort = String(payload?.reasoning_effort || payload?.reasoning?.effort || payload?.reasoningEffort || "").toLowerCase();
  const thinkingType = String(payload?.thinking?.type || "").toLowerCase();
  return payload?.enable_thinking === false || thinkingType === "disabled" || effort === "none" || effort === "disabled" || effort === "off";
}

function deepSeekEffortInput(payload) {
  if (deepSeekReasoningDisabled(payload)) return "none";
  return String(payload?.reasoning_effort || payload?.reasoning?.effort || payload?.reasoningEffort || payload?.reasoning?.enabled || payload?.enable_thinking || "").toLowerCase();
}

function mapDeepSeekEffort(raw) {
  const value = String(raw || "").toLowerCase();
  if (value === "high" || value === "max") return value;
  if (value === "xhigh" || value === "maximum") return "max";
  if (value === "minimal") return "high";
  if (value === "false" || value === "off" || value === "disabled") return "none";
  return "high";
}

function applyMoonshotBridge(payload, modelName) {
  let changed = false;
  const isK27Code = /kimi[\/_.-]*k2[\/_.-]*7[\/_.-]*code/i.test(modelName);
  const isK26 = /kimi[\/_.-]*k2[\/_.-]*6/i.test(modelName);
  const isK25 = /kimi[\/_.-]*k2[\/_.-]*5/i.test(modelName);
  const wantsThinking = nimReasoningRequested(payload) || glmThinkingRequested(payload);
  if (wantsThinking) {
    if (isK27Code) {
      if ("thinking" in payload) delete payload.thinking;
    } else {
      const enabled = !nimReasoningDisabled(payload);
      payload.thinking = { type: enabled ? "enabled" : "disabled" };
      if (enabled && isK26) payload.thinking.keep = "all";
    }
    changed = true;
  }
  if (isK27Code || isK26 || isK25) {
    changed = deleteKeys(payload, ["temperature", "top_p", "presence_penalty", "frequency_penalty"]) || changed;
  }
  changed = normalizeLegacyToolPayload(payload, true) || changed;
  changed = removeMoonshotIncompatibleReasoningFields(payload) || changed;
  return changed;
}

function applyMiniMaxBridge(payload) {
  let changed = false;
  if (nimReasoningRequested(payload) || glmThinkingRequested(payload)) {
    if (nimReasoningDisabled(payload)) {
      payload.thinking = { type: "disabled" };
    } else {
      payload.thinking = { type: "adaptive" };
      if (!("reasoning_split" in payload)) payload.reasoning_split = true;
    }
    changed = true;
  }
  changed = normalizeLegacyToolPayload(payload, true) || changed;
  changed = removeMiniMaxIncompatibleReasoningFields(payload) || changed;
  return changed;
}

function applyOpenRouterBridge(payload) {
  let changed = false;
  if (nimReasoningRequested(payload)) {
    if (nimReasoningDisabled(payload)) {
      if ("reasoning" in payload) { delete payload.reasoning; changed = true; }
    } else {
      const current = payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning : {};
      const raw = bridgeReasoningEffortInput(payload);
      const effort = raw ? mapOpenAiReasoningEffort(raw) : "";
      payload.reasoning = effort ? { ...current, effort } : current;
      changed = true;
    }
  }
  changed = normalizeLegacyToolPayload(payload) || changed;
  return deleteKeys(payload, ["reasoning_effort", "reasoning_summary", "reasoning_split", "enable_thinking", "chat_template_kwargs", "reasoning_budget", "reasoningBudget", "thinking"]) || changed;
}

function applyZhipuBridge(payload) {
  let changed = false;
  if (nimReasoningRequested(payload) || glmThinkingRequested(payload)) {
    const disabled = nimReasoningDisabled(payload);
    const current = payload.thinking && typeof payload.thinking === "object" ? payload.thinking : {};
    payload.thinking = { ...current, type: disabled ? "disabled" : "enabled" };
    changed = true;
    const raw = bridgeReasoningEffortInput(payload);
    const effort = raw ? mapOpenAiReasoningEffort(raw) : "";
    if (!disabled && effort && effort !== "none") {
      payload.reasoning_effort = effort;
    } else if ("reasoning_effort" in payload) {
      delete payload.reasoning_effort;
    }
  }
  changed = normalizeLegacyToolPayload(payload) || changed;
  return deleteKeys(payload, ["reasoning", "reasoning_summary", "reasoning_split", "enable_thinking", "chat_template_kwargs", "reasoning_budget", "reasoningBudget"]) || changed;
}

function applyGenericOpenAiBridge(payload, options = {}) {
  let changed = false;
  if (nimReasoningRequested(payload)) {
    const disabled = nimReasoningDisabled(payload);
    const raw = bridgeReasoningEffortInput(payload);
    const effort = raw ? mapOpenAiReasoningEffort(raw) : "";
    if (disabled || options.keepReasoningEffort === false) {
      if ("reasoning_effort" in payload) { delete payload.reasoning_effort; changed = true; }
    } else if (effort && effort !== "none" && payload.reasoning_effort !== effort) {
      payload.reasoning_effort = effort;
      changed = true;
    }
  }
  changed = normalizeLegacyToolPayload(payload) || changed;
  return deleteKeys(payload, ["reasoning", "reasoning_summary", "reasoning_split", "enable_thinking", "chat_template_kwargs", "reasoning_budget", "reasoningBudget", "thinking"]) || changed;
}

function mapOpenAiReasoningEffort(raw) {
  return mapNimReasoningEffort(raw, ["none", "low", "medium", "high"], "high");
}

function bridgeReasoningEffortInput(payload) {
  const effort = nimReasoningEffortInput(payload);
  if (effort) return effort;
  return String(payload?.thinking?.type || "").toLowerCase() === "enabled" ? "high" : "";
}

function normalizeLegacyToolPayload(payload, forceAutoChoice = false) {
  let changed = false;
  if (Array.isArray(payload.functions) && !Array.isArray(payload.tools)) {
    payload.tools = payload.functions.map((fn) => ({ type: "function", function: fn }));
    changed = true;
  }
  if ("functions" in payload) {
    delete payload.functions;
    changed = true;
  }
  if ("function_call" in payload) {
    if (!("tool_choice" in payload) && (payload.function_call === "none" || payload.function_call === "auto")) {
      payload.tool_choice = payload.function_call;
    }
    delete payload.function_call;
    changed = true;
  }
  if (forceAutoChoice && (payload.tool_choice === "required" || (payload.tool_choice && typeof payload.tool_choice === "object"))) {
    payload.tool_choice = "auto";
    changed = true;
  }
  return changed;
}

function removeMoonshotIncompatibleReasoningFields(payload) {
  let changed = removeNimReasoningPayloadFields(payload, { keepThinking: true });
  return deleteKeys(payload, ["reasoning_split", "enable_thinking", "chat_template_kwargs"]) || changed;
}

function removeMiniMaxIncompatibleReasoningFields(payload) {
  let changed = removeNimReasoningPayloadFields(payload, { keepThinking: true });
  return deleteKeys(payload, ["enable_thinking", "chat_template_kwargs"]) || changed;
}

function deleteKeys(target, keys) {
  let changed = false;
  for (const key of keys) {
    if (key in target) {
      delete target[key];
      changed = true;
    }
  }
  return changed;
}

function applyNimBridge(payload, modelName, family = modelFamily(modelName)) {
  let changed = false;
  const isGlm = family === "glm";
  const isQwen = family === "qwen";
  const isKimi = family === "kimi";
  const isNemotron3 = family === "nemotron-3";
  const reasoningEffort = nimFamilyReasoningEffort(family, payload);
  if (isGlm) {
    if (glmThinkingRequested(payload)) {
      setChatTemplateKwargs(payload, { enable_thinking: true, clear_thinking: false });
      changed = true;
    }
    changed = removeNimReasoningPayloadFields(payload) || changed;
  }

  if (isKimi && glmThinkingRequested(payload)) {
    const mode = nimReasoningDisabled(payload) ? "disabled" : "enabled";
    payload.thinking = mode === "enabled" ? { type: "enabled", keep: "all" } : { type: "disabled" };
    changed = true;
    changed = removeNimReasoningPayloadFields(payload, { keepThinking: true }) || changed;
  }

  if (isQwen && nimReasoningRequested(payload)) {
    setChatTemplateKwargs(payload, { enable_thinking: !nimReasoningDisabled(payload) });
    changed = removeNimReasoningPayloadFields(payload) || changed;
    changed = true;
  }

  if (isMiniMaxM3Model(modelName)) {
    const thinkingMode = nimThinkingMode(payload);
    if (thinkingMode) {
      setChatTemplateKwargs(payload, { thinking_mode: thinkingMode });
      changed = true;
    }
    changed = removeNimReasoningPayloadFields(payload) || changed;
  }

  if (isNemotron3 && nimReasoningRequested(payload)) {
    const raw = nimReasoningEffortInput(payload);
    const disabled = nimReasoningDisabled(payload);
    setChatTemplateKwargs(payload, {
      enable_thinking: !disabled,
      low_effort: !disabled && (raw === "low" || raw === "minimal"),
    });
    const budget = nimReasoningBudget(payload);
    if (budget != null) {
      payload.reasoning_budget = budget;
    }
    changed = true;
    changed = removeNimReasoningPayloadFields(payload, { keepReasoningBudget: true }) || changed;
  }

  if (reasoningEffort) {
    if (payload.reasoning_effort !== reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
      changed = true;
    }
    changed = removeNimReasoningPayloadFields(payload, { keepReasoningEffort: true }) || changed;
  }

  if ("reasoning_split" in payload) {
    delete payload.reasoning_split;
    changed = true;
  }

  if ("enable_thinking" in payload) {
    const enableThinking = payload.enable_thinking;
    delete payload.enable_thinking;
    if (isQwen) {
      setChatTemplateKwargs(payload, { enable_thinking: enableThinking });
    }
    changed = true;
  }

  return changed;
}

function removeNimReasoningPayloadFields(payload, options = {}) {
  let changed = false;
  if ("reasoning" in payload) {
    delete payload.reasoning;
    changed = true;
  }
  if (!options.keepReasoningEffort && "reasoning_effort" in payload) {
    delete payload.reasoning_effort;
    changed = true;
  }
  if (!options.keepReasoningBudget && "reasoning_budget" in payload) {
    delete payload.reasoning_budget;
    changed = true;
  }
  if ("reasoningBudget" in payload) {
    delete payload.reasoningBudget;
    changed = true;
  }
  if (!options.keepThinking && "thinking" in payload) {
    delete payload.thinking;
    changed = true;
  }
  return changed;
}

function setChatTemplateKwargs(payload, values) {
  payload.chat_template_kwargs = {
    ...(payload.chat_template_kwargs && typeof payload.chat_template_kwargs === "object" ? payload.chat_template_kwargs : {}),
    ...values,
  };
}

function nimFamilyReasoningEffort(family, payload) {
  if (!nimReasoningRequested(payload)) return "";
  const raw = nimReasoningEffortInput(payload);
  if (family === "deepseek") return mapNimReasoningEffort(raw, ["none", "high", "max"], "high");
  if (["step", "nemotron", "gpt-oss", "sarvam"].includes(family)) {
    return mapNimReasoningEffort(raw, ["none", "low", "medium", "high"], "high");
  }
  if (family === "mistral") return mapNimReasoningEffort(raw, ["none", "low", "medium", "high"], "high");
  return "";
}

function nimReasoningEffortInput(payload) {
  if (nimReasoningDisabled(payload)) return "none";
  return String(payload?.reasoning_effort || payload?.reasoning?.effort || payload?.reasoningEffort || payload?.reasoning?.enabled || payload?.enable_thinking || "").toLowerCase();
}

function nimReasoningBudget(payload) {
  const value = payload?.reasoning_budget ?? payload?.reasoningBudget ?? payload?.reasoning?.budget ?? payload?.reasoning?.budget_tokens ?? payload?.thinking?.budget ?? payload?.thinking?.budget_tokens;
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
}

function mapNimReasoningEffort(raw, allowed, fallback) {
  const value = String(raw || "").toLowerCase();
  if (allowed.includes(value)) return value;
  if (value === "xhigh" || value === "maximum") return allowed.includes("max") ? "max" : "high";
  if (value === "minimal") return allowed.includes("low") ? "low" : fallback;
  if (value === "false" || value === "off" || value === "disabled") return "none";
  if (value === "true" || value === "on" || value === "enabled" || !value) return fallback;
  return fallback;
}

function nimThinkingMode(payload) {
  if (payload?.chat_template_kwargs?.thinking_mode) return "";
  const effort = String(payload?.reasoning_effort || payload?.reasoning?.effort || payload?.reasoningEffort || "").toLowerCase();
  if (effort === "none" || effort === "disabled" || effort === "off" || effort === "low") return "disabled";
  if (effort === "high" || effort === "medium" || effort === "enabled" || effort === "on") return "enabled";
  return glmThinkingRequested(payload) ? "adaptive" : "";
}

function nimReasoningRequested(payload) {
  return Boolean(payload?.reasoning || payload?.reasoning_effort || payload?.reasoningEffort || payload?.thinking != null || payload?.enable_thinking != null || payload?.chat_template_kwargs?.enable_thinking != null);
}

function nimReasoningDisabled(payload) {
  const effort = String(payload?.reasoning_effort || payload?.reasoning?.effort || payload?.reasoningEffort || "").toLowerCase();
  const thinkingType = String(payload?.thinking?.type || "").toLowerCase();
  return payload?.enable_thinking === false || thinkingType === "disabled" || effort === "none" || effort === "disabled" || effort === "off";
}

function setReasoningSummary(payload, summary) {
  payload.reasoning = {
    ...(payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning : {}),
    summary,
  };
  return true;
}
