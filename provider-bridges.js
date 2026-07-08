export function isNvidiaNimUpstream(upstream) {
  return String(upstream?.preset || "") === "nvidia-nim" || String(upstream?.base_url || "").toLowerCase().includes("integrate.api.nvidia.com");
}

export function sanitizeProxyBody(bodyText, upstream) {
  if (!bodyText) return bodyText;

  const isNvidia = isNvidiaNimUpstream(upstream);
  const isDeepSeekOfficial = isDeepSeekUpstream(upstream);
  const isMoonshotOfficial = isMoonshotUpstream(upstream);
  const isMiniMaxOfficial = isMiniMaxUpstream(upstream);
  const bodyLower = bodyText.toLowerCase();
  if (!bodyNeedsSanitizing(bodyText, bodyLower, isNvidia || isDeepSeekOfficial || isMoonshotOfficial || isMiniMaxOfficial)) return bodyText;

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }

  let changed = false;
  const modelName = String(payload.model || "").toLowerCase();
  const isGlm = isGlmModel(modelName);
  const wantsKimiPreservedThinking = kimiPreservedThinkingRequested(payload, modelName);
  changed = applyProviderReasoningOptions(payload) || changed;
  changed = normalizeReasoningFields(payload, isGlm, wantsKimiPreservedThinking || isNvidia || isDeepSeekOfficial || isMoonshotOfficial || isMiniMaxOfficial) || changed;
  changed = applyKimiPreservedThinking(payload, wantsKimiPreservedThinking) || changed;
  if (isDeepSeekOfficial) changed = applyDeepSeekBridge(payload) || changed;
  if (isMoonshotOfficial) changed = applyMoonshotBridge(payload, modelName) || changed;
  if (isMiniMaxOfficial) changed = applyMiniMaxBridge(payload) || changed;
  if (isNvidia) changed = applyNimBridge(payload, modelName) || changed;

  return changed ? JSON.stringify(payload) : bodyText;
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

function bodyNeedsSanitizing(bodyText, bodyLower, providerBridge) {
  return bodyText.includes('"thinking"') ||
    bodyText.includes('"reasoning"') ||
    bodyText.includes('"reasoning_effort"') ||
    bodyText.includes('"reasoningEffort"') ||
    bodyText.includes('"reasoning_summary"') ||
    bodyText.includes('"reasoningSummary"') ||
    bodyText.includes('"providerOptions"') ||
    bodyText.includes('"provider_options"') ||
    bodyLower.includes("kimi-k2") ||
    (providerBridge && (
      bodyText.includes('"reasoning_split"') ||
      bodyText.includes('"enable_thinking"') ||
      bodyText.includes('"functions"') ||
      bodyText.includes('"function_call"') ||
      bodyText.includes('"tool_choice"') ||
      bodyText.includes('"temperature"') ||
      bodyLower.includes("minimax-m3")
    ));
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
  if (nimReasoningRequested(payload) || glmThinkingRequested(payload)) {
    const disabled = nimReasoningDisabled(payload);
    payload.thinking = { type: disabled ? "disabled" : "enabled" };
    changed = true;
    const effort = deepSeekReasoningEffort(payload);
    if (effort) {
      payload.reasoning_effort = effort;
      changed = true;
    } else if ("reasoning_effort" in payload) {
      delete payload.reasoning_effort;
      changed = true;
    }
  }
  changed = removeDeepSeekIncompatibleReasoningFields(payload) || changed;
  return changed;
}

function deepSeekReasoningEffort(payload) {
  if (nimReasoningDisabled(payload)) return "";
  return mapNimReasoningEffort(nimReasoningEffortInput(payload), ["high", "max"], "high");
}

function removeDeepSeekIncompatibleReasoningFields(payload) {
  let changed = removeNimReasoningPayloadFields(payload, { keepReasoningEffort: true, keepThinking: true });
  return deleteKeys(payload, ["reasoning_split", "enable_thinking", "chat_template_kwargs"]) || changed;
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
  changed = normalizeLegacyToolPayload(payload) || changed;
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
  changed = normalizeLegacyToolPayload(payload) || changed;
  changed = removeMiniMaxIncompatibleReasoningFields(payload) || changed;
  return changed;
}

function normalizeLegacyToolPayload(payload) {
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
  if (payload.tool_choice === "required" || (payload.tool_choice && typeof payload.tool_choice === "object")) {
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

function applyNimBridge(payload, modelName) {
  let changed = false;
  const isGlm = isGlmModel(modelName);
  const isQwen = modelName.includes("qwen");
  const isKimi = isKimiModel(modelName);
  const isNemotron3 = isNemotron3Model(modelName);
  const reasoningEffort = nimFamilyReasoningEffort(modelName, payload);
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

function nimFamilyReasoningEffort(modelName, payload) {
  if (!nimReasoningRequested(payload)) return "";
  const raw = nimReasoningEffortInput(payload);
  if (isDeepSeekModel(modelName)) return mapNimReasoningEffort(raw, ["none", "high", "max"], "high");
  if (isStepModel(modelName) || (isNemotronModel(modelName) && !isNemotron3Model(modelName)) || isGptOssModel(modelName) || isSarvamModel(modelName)) {
    return mapNimReasoningEffort(raw, ["none", "low", "medium", "high"], "high");
  }
  if (isMistralModel(modelName)) return mapNimReasoningEffort(raw, ["none", "low", "medium", "high"], "high");
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
