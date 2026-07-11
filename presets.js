export const PRESET_TEMPLATES = [
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    base_url: "https://integrate.api.nvidia.com/v1",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: false,
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    base_url: "https://api.deepinfra.com/v1/openai",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: false,
  },
  {
    id: "together",
    name: "Together AI",
    base_url: "https://api.together.xyz/v1",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: false,
  },
  {
    id: "moonshot",
    name: "Kimi / \u6708\u4e4b\u6697\u9762",
    base_url: "https://api.moonshot.ai/v1",
    paths: ["/v1/chat/completions"],
    requires_base_url: false,
  },
  {
    id: "minimax",
    name: "MiniMax",
    base_url: "https://api.minimax.io/v1",
    paths: ["/v1/chat/completions"],
    requires_base_url: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: false,
  },
  {
    id: "zhipu",
    name: "GLM / \u667a\u8c31 AI",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    paths: ["/v1/chat/completions"],
    requires_base_url: false,
  },
  {
    id: "zhipu-coding",
    name: "GLM / \u667a\u8c31 Coding",
    base_url: "https://open.bigmodel.cn/api/coding/paas/v4",
    paths: ["/v1/chat/completions"],
    requires_base_url: false,
  },
  {
    id: "workers-ai",
    name: "Cloudflare Workers AI (REST)",
    base_url: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1",
    paths: ["/v1/chat/completions"],
    requires_base_url: false,
    requires_account_id: true,
    headers: { "cf-aig-gateway-id": "default" },
  },
  {
    id: "custom",
    name: "\u81ea\u5b9a\u4e49",
    base_url: "",
    paths: ["/v1/chat/completions", "/v1/embeddings"],
    requires_base_url: true,
  },
];

export function inferPresetId(baseUrl) {
  const value = String(baseUrl || "").toLowerCase();
  if (value.includes("nvidia.com")) return "nvidia-nim";
  if (value.includes("deepinfra.com")) return "deepinfra";
  if (value.includes("together.xyz")) return "together";
  if (value.includes("api.deepseek.com")) return "deepseek";
  if (value.includes("api.moonshot.ai") || value.includes("api.kimi.com")) return "moonshot";
  if (value.includes("api.minimax.io") || value.includes("api.minimaxi.com")) return "minimax";
  if (value.includes("openrouter.ai")) return "openrouter";
  if (value.includes("api.cloudflare.com/client/v4/accounts/") && value.includes("/ai/v1")) return "workers-ai";
  if (value.includes("open.bigmodel.cn/api/coding/paas/v4")) return "zhipu-coding";
  if (value.includes("open.bigmodel.cn/api/paas/v4")) return "zhipu";
  if (value.includes("anthropic") || value.includes("claude")) return "custom";
  return "custom";
}

export function presetById(id) {
  return PRESET_TEMPLATES.find((item) => item.id === id) || null;
}
