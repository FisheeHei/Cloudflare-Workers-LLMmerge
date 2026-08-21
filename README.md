# LLM-merge

[English README](./README_EN.md)

LLM-merge 是一个运行在 Cloudflare Workers / Pages Advanced Mode 上的单文件 LLM 聚合网关。它把多个上游模型服务聚合成统一的 `/v1` Base URL，并提供一个轻量管理后台，用于配置上游、客户端 Key、模型、提示词、上下文、路由和统计。

## 功能

- OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`
- Responses API 兼容层：`/v1/responses`、`/v1/responses/compact`，支持 `store`、响应检索/取消和 `previous_response_id`
- Claude / Anthropic 风格入口：`/v1/messages`
- 多上游聚合：启用/停用、权重、优先级、路径、模型白名单
- 路由策略：故障转移、负载均衡、Hedged Request、Gateway Fast 模式
- 模型选择器：按来源和标签筛选，支持上下文长度备注
- NIM 桥接：对 GLM、Qwen、MiniMax、Kimi、DeepSeek、Nemotron、Mistral 等模型做轻量参数适配
- Prompt / Context 注入：按客户端 Key 生效，支持上下文片段、关键词和导入/导出
- 统计与日志：内存实时显示 + Analytics Engine 历史统计，D1/DO 或 KV 镜像兜底
- 上游导入/导出、健康检查、模型测速、活跃上游显示

## 部署

### 1. 创建项目

Workers 可直接部署：

```bash
wrangler deploy
```

Pages 使用 Advanced Mode，将 `_worker.js` 作为入口。项目不需要构建步骤。

### 2. 绑定存储（KV / D1 / Durable Object）

三种模式按优先级自动选择：Durable Object `llmerge` > D1 `llmerge` > KV `KV`。

推荐用 D1，绑定名必须是：

```txt
llmerge
```

首次使用前执行建表 SQL（绑定名统一为 `llmerge`，Worker 部署也可用同名的 Durable Object）：

```sql
CREATE TABLE IF NOT EXISTS llmmerge_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);
```

仓库已提供 `d1_migrations/0001_create_store.sql`，也可以自动建表（首次读写时自动执行）。

如果暂时只使用 KV，绑定名必须是 `KV`。D1/DO 启用后，KV 同时承担两层角色：一次性迁移源，以及持久键（网关配置、配置快照、客户端 Key）的低频灾备快照。D1 暂时不可用时，网关会自动回退 KV 快照并标记降级状态，恢复后自动回写 D1；原有 Key 对接方式不变。

Worker 部署的 Durable Object 示例见 `wrangler.worker.toml`。

### 3. 绑定 Analytics Engine

推荐绑定：

```txt
binding: ANALYTICS
dataset: llmmerge_requests
```

统计查询还需要变量：

```txt
ANALYTICS_ACCOUNT_ID = Cloudflare Account ID
ANALYTICS_API_TOKEN  = 拥有 Account Analytics Read 权限的 API Token
```

`ANALYTICS_DATASET` 可不填，默认是 `llmmerge_requests`。如果你换了 dataset 名称，再手动设置它。

### 4. 设置环境变量

最少建议：

```txt
ADMIN_TOKEN=your-admin-path
API_KEY_CRYPT_SECRET=long-random-secret
```

后台地址：

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

如果不设置 `ADMIN_TOKEN`，默认后台路径是 `/llmmerge-admin`。生产环境不要使用默认值。

## 变量

| 变量 | 必要 | 说明 |
| --- | --- | --- |
| `KV` | 可选 | Cloudflare KV binding；D1/DO 未启用时的轻量状态存储 |
| `llmerge` | 可选 | D1 或 Durable Object binding；启用后 KV 只做一次性迁移回退 |
| `ADMIN_TOKEN` | 建议 | 后台路径 token |
| `API_KEY_CRYPT_SECRET` | 建议 | 上游 API Key 加密密钥，生产环境固定后不要随意更换 |
| `ANALYTICS` | 可选 | Analytics Engine binding，用于请求统计写入 |
| `ANALYTICS_ACCOUNT_ID` | 可选 | 查询 Analytics Engine 所需 Account ID |
| `ANALYTICS_API_TOKEN` | 可选 | 需要 `Account Analytics Read` 权限 |
| `ANALYTICS_DATASET` | 可选 | 默认 `llmmerge_requests` |
| `REQUEST_TIMEOUT_MS` | 可选 | 默认 `180000`；非流式请求最多等待 90 秒以避免自定义域名 524 |
| `STREAM_IDLE_TIMEOUT_MS` | 可选 | 默认 `900000` |
| `SSE_KEEPALIVE_MS` | 可选 | 默认 `3000`；流式响应的心跳注释间隔 |
| `UPSTREAM_COOLDOWN_TTL` | 可选 | 默认 `60` 秒 |
| `MODEL_CACHE_TTL` | 可选 | 默认 `3600` 秒 |
| `UPSTREAMS_JSON` | 可选 | 初始上游种子配置 |
| `CLIENTS_JSON` | 可选 | 初始客户端 Key 种子配置 |
| `KV_FLUSH_INTERVAL_MS` | 可选 | KV-only 模式下日志/统计镜像刷新间隔，默认 `120000` 毫秒 |
| `KV_DAILY_READ_BUDGET` | 可选 | 后台 KV 用量表读取配额，默认 `100000`（Free 方案） |
| `KV_DAILY_WRITE_BUDGET` | 可选 | 后台 KV 用量表写入配额，默认 `1000`（Free 方案） |
| `WORKERS_DAILY_REQUEST_BUDGET` | 可选 | 后台 Workers 请求用量表配额，默认 `1000000` |

## 上游

后台可以直接添加上游，也可以用 `UPSTREAMS_JSON` 初始化：

```json
[
  {
    "name": "nim-primary",
    "preset": "nvidia-nim",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "nvapi-...",
    "models": ["nvidia/nemotron-3-nano-30b-a3b", "moonshotai/kimi-k2.5"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "priority": 1,
    "weight": 1,
    "enabled": true
  }
]
```

内置模板：

- NVIDIA NIM
- DeepInfra
- Together AI
- DeepSeek
- Kimi / Moonshot AI
- MiniMax
- OpenRouter
- Groq Cloud
- GLM / 智谱
- Cloudflare Workers AI REST
- 自定义 OpenAI 兼容上游

Cloudflare Workers AI REST 模板使用：

```txt
https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1
```

Cloudflare API Token 可先验证：

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer {API_TOKEN}"
```

## 客户端 Key

后台可生成 `sk-gw-...` Key。也可以用 `CLIENTS_JSON` 初始化：

```json
[
  {
    "name": "default",
    "key": "sk-gw-change-me",
    "models": ["*"],
    "upstreams": []
  }
]
```

- `models` 为空或包含 `*` 表示不限制模型
- `upstreams` 为空表示不限制上游

系统提示词 / 全局上下文 / Subagent / 全量注入的作用域支持：

- `*` 或 `__all__`：全部客户端
- `__none__`：不生效
- 客户端 `id` / `name` / `key`：精确匹配

生效客户端只认已有的客户端 Key，未出现在客户端列表中的标识不会触发注入。

### 提示词与长对话

- 网关规则（系统提示词）与命中的资料上下文会在每次 Chat、Messages 和 Responses 请求中重新构建；原生 Responses 同样写入 instructions，不会把资料伪装成用户消息。
- 管理端“最终注入预览”只在网关本地生成最终消息顺序，不请求上游。
- history_max_chars 默认为 0（不裁剪）。设置为正数后，Chat、Messages 和转换式 Responses 只保留预算内最新对话轮次；网关规则、资料上下文和客户端的 system / developer 消息不会被裁剪。
- 原生 Responses 的历史由上游 previous_response_id 链管理；网关仍会在每次请求中重新注入规则与资料。接近模型窗口时，使用 /v1/responses/compact 显式压缩历史。

## 使用

OpenAI SDK：

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-...",
  baseURL: "https://your-domain.example/v1",
});

const res = await client.chat.completions.create({
  model: "nvidia/nemotron-3-nano-30b-a3b",
  messages: [{ role: "user", content: "hello" }],
});
```

支持的主要路径：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 存活检查 |
| `GET` | `/v1/models` | 聚合模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | OpenAI Completions（显式声明该路径的上游直通，否则自动转 Chat） |
| `POST` | `/v1/responses` | Responses API 兼容层（自托管 NIM 可原生直通） |
| `POST` | `/v1/messages` | Claude / Anthropic 风格入口 |
| `POST` | `/v1/embeddings` | Embeddings |

Responses API 额外支持：

- `GET /v1/responses/{response_id}`：读取已 `store` 的响应
- `POST /v1/responses/{response_id}/cancel`：取消进行中的流式响应
- `previous_response_id`：把上一轮输出（消息、函数调用和结果）接回当前输入

NVIDIA NIM 托管模板默认启用官方文档明确列出的 Chat Completions 和 Embeddings 路径；自托管 NIM 在上游路径中加入 `/v1/responses` 时，网关会优先原生直通 Responses API，否则统一转为 Chat Completions 后再聚合。
`nvidia/nemotron-3-embed-1b` 的 Embeddings 请求需显式传入 `input_type`（`query` 或 `passage`）；网关会原样透传该字段。

DeepSeek 模型经任意非官方上游（NIM、OpenRouter、自建端点等）调用时，网关会原样透传 `reasoning_content`；经 `/v1/responses` 或 `/v1/messages` 调用时会转换为 reasoning 条目 / thinking 块。NIM 上的 DeepSeek V4（例如 `deepseek-ai/deepseek-v4-flash-0731`）还会按 NIM 文档注入 `chat_template_kwargs.reasoning_effort`（`none` / `high` / `max`，未指定时默认 `high`）。官方 DeepSeek 端点仍按原策略隐藏推理内容。

`/v1/completions` 优先直通显式声明该路径的上游；如果没有这类上游，网关会自动把单条 `prompt` 转成 Chat Completions，再转回标准 `text_completion` 响应，流式和非流式均支持。

## 统计机制

- 内存：最近请求实时显示，包含请求数、Token、日志和活跃上游
- Analytics Engine：长期统计与日志查询
- 状态存储镜像：后台实时日志和近两小时统计镜像（D1/DO 或 KV），Analytics Engine 查询延迟或不可用时仍能显示当前状态

也就是说：内存负责快，Analytics Engine 负责长期历史，D1/DO/KV 负责配置、当前遥测镜像和跨 isolate 路由状态。启用 D1/DO 后 KV 读写降到接近零，适合 Free 方案的小 KV 配额。

## 路由机制

- `failover`：上游失败后尝试下一个
- `load_balance`：按权重分配
- `coordination_level`（0-5，默认 3）：按活跃/预留请求分散到负载较低的上游，并按权重折算承载能力
- 成功请求和后台测速会把 6 小时延迟 EWMA 写入状态存储，新 isolate 也能优先选择近期更快的上游
- 流式请求只会在首个可见输出前故障转移；已经向客户端输出后不会重放，避免 Agent 内容或工具调用重复
- 上游返回 `Retry-After` 时会写入对应上游/模型冷却状态，备用上游会立即尝试，不等待失败上游恢复
- 健康检查只验证上游 `/models`；需要验证某个模型时使用管理端测速，避免默认探针额外消耗模型调用
- 健康探针、模型刷新和测速使用有限并发，避免上游数量增加时瞬时耗尽 Workers Request
- `Hedged Request`：同一模型多个上游竞速
- `Gateway Fast 模式`：加速前两个候选上游抢首包
- Fast 与 Hedged 同开时：Hedged 决定候选数量，Fast 加速前两个

## 注意事项

- 不要公开真实上游 API Key
- `ADMIN_TOKEN` 只是隐藏后台路径，不是完整登录系统
- `API_KEY_CRYPT_SECRET` 用于解密已保存的上游 Key，生产环境不要随意更换
- 上游导出文件会包含明文 API Key，请妥善保存
- Analytics Engine 查询需要 `Account > Account Analytics > Read`
- Worker 内存实时统计可能因 isolate 回收而丢失，历史统计以 Analytics Engine 为准
- KV 路由状态是短期提示，不是严格全局锁；需要强一致调度时可改用同名的 Durable Object `llmerge`
- 长推理模型首包可能很慢，建议开启合适的超时、Hedged Request 或 Gateway Fast 模式
