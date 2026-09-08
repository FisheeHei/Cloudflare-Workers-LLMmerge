# LLM-merge

[English README](./README_EN.md)

LLM-merge 是运行在 Cloudflare Workers 或 Pages Advanced Mode 上的单文件 LLM 网关。它把多个 OpenAI 兼容上游统一成一个 `/v1` Base URL，并提供管理后台来配置上游、客户端 Key、模型、提示词、上下文、路由和统计。

## 适合什么场景

- 用多个兼容上游组成账号池，按模型和客户端自动分流。
- 让 OpenAI、Responses、Anthropic/Claude 风格客户端共用一个网关地址。
- 给指定客户端注入系统提示词、全局资料和按需上下文。
- 在 Cloudflare 边缘接入用户，并从承接请求的边缘直接访问上游。

## 主要能力

- 协议：OpenAI Chat/Completions/Embeddings、Responses、Anthropic Messages。
- Responses：`store`、`previous_response_id`、响应查询/取消，以及 `/v1/responses/compact`。
- 上游：启用/停用、模型和路径白名单、优先级、权重、故障转移和冷却。
- 路由：负载均衡、客户端 Key 亲和、跨边缘错峰、Hedged Request、Gateway Fast。
- 上游适配：支持通用 OpenAI-compatible 上游，并兼容 NVIDIA NIM 等常见服务的参数和推理字段。
- 注入：系统提示词、全局上下文、上下文片段、关键词/模型匹配、客户端范围和字符上限。
- 管理：模型刷新、上游健康检查、指定模型测速、客户端 Key、导入/导出、实时日志和统计。

## 快速部署

### Workers

Worker 部署使用 `wrangler.worker.toml`：

```bash
wrangler deploy --config wrangler.worker.toml
```

### Pages Advanced Mode

将 `_worker.js` 设为 Advanced Mode 入口。项目不需要构建步骤；生产环境的 Variables、Secrets 和 Bindings 在 Cloudflare Pages 项目设置中配置。

Pages 与 Worker 使用相同的绑定名：

- `llmerge`：主状态存储，推荐绑定 D1。
- `ROUTE_COORDINATOR`：Durable Object，用于跨边缘请求错峰。
- `KV`：可选的兼容存储和 D1/DO 降级快照。
- `ANALYTICS`：可选的 Analytics Engine 统计写入。

不要启用 Smart Placement。网关需要保留“用户就近接入，当前边缘直接 fetch 上游”的路径。

## 存储绑定

主状态后端按以下顺序自动选择：`llmerge` Durable Object > `llmerge` D1 > `KV`。

推荐使用 D1，绑定名必须是 `llmerge`。首次部署前可执行仓库中的迁移：

```bash
wrangler d1 migrations apply <D1_DATABASE_NAME> --remote
```

迁移文件为 `d1_migrations/0001_create_store.sql`。网关也会在首次读写时尝试创建表：

```sql
CREATE TABLE IF NOT EXISTS llmmerge_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
);
```

`ROUTE_COORDINATOR` 只保存短期调度状态，不代理模型请求，也不保存 Prompt、Context 或上游 Token。没有 `ROUTE_COORDINATOR` 时仍可运行，但跨边缘节点只能依赖各 isolate 的本地状态，不能做到严格的全局错峰。

## 必要配置

建议至少设置：

```txt
ADMIN_TOKEN=replace-with-a-random-value
API_KEY_CRYPT_SECRET=replace-with-a-long-random-secret
```

管理后台地址：

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

未设置 `ADMIN_TOKEN` 时默认路径为 `/llmmerge-admin`，生产环境不要使用默认路径。

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REQUEST_TIMEOUT_MS` | `180000` | 上游首包/非流式请求基础超时；非流式仍受 90 秒响应期限约束 |
| `STREAM_IDLE_TIMEOUT_MS` | `900000` | 流式响应空闲超时 |
| `SSE_KEEPALIVE_MS` | `5000` | SSE 保活注释间隔 |
| `UPSTREAM_COOLDOWN_TTL` | `60` | 上游失败冷却秒数 |
| `MODEL_CACHE_TTL` | `3600` | 聚合模型列表缓存秒数 |
| `UPSTREAMS_JSON` | 空 | 初始上游配置 JSON |
| `CLIENTS_JSON` | 空 | 初始客户端 Key 配置 JSON |
| `ANALYTICS_ACCOUNT_ID` | 空 | Analytics Engine 查询所需 Account ID |
| `ANALYTICS_API_TOKEN` | 空 | 需要 Account Analytics Read 权限 |
| `ANALYTICS_DATASET` | `llmmerge_requests` | Analytics Engine 数据集名 |

KV-only 部署还可使用 `KV_FLUSH_INTERVAL_MS`、`KV_DAILY_READ_BUDGET`、`KV_DAILY_WRITE_BUDGET` 和 `WORKERS_DAILY_REQUEST_BUDGET` 控制镜像与后台用量表。

## 添加上游

在管理后台新增上游，或通过 `UPSTREAMS_JSON` 初始化。大多数 OpenAI-compatible 服务只需要填写基础地址、API Key、模型和支持的路径：

```json
[
  {
    "name": "provider-primary",
    "preset": "custom-openai",
    "base_url": "https://api.example.com/v1",
    "api_key": "your-upstream-api-key",
    "models": ["provider/model-name"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "priority": 1,
    "weight": 1,
    "enabled": true
  }
]
```

字段说明：

- `base_url`：上游的 OpenAI-compatible API 根地址，通常以 `/v1` 结尾。
- `api_key`：上游 API Key；网关会加密保存。
- `models`：该上游允许转发的模型名，填写 `*` 可匹配全部模型。
- `paths`：该上游实际支持的网关路径。
- `priority`、`weight`：用于候选排序和负载分配。

客户端请求的模型名必须能匹配上游模型配置和客户端权限。多个账号或多个同类上游可以分别添加为多个上游，使用相同的 `base_url`，为每个上游填写独立的 `api_key`；网关会根据路由策略自动选择。

内置模板支持 NVIDIA NIM、DeepInfra、Together AI、DeepSeek、Kimi/Moonshot、MiniMax、OpenRouter、Groq、GLM/Zhipu、Cloudflare Workers AI REST 和自定义 OpenAI-compatible 上游。模板只是默认参数适配，不能替代上游自身的模型和路径配置。

## 客户端 Key 与注入

客户端 Key 可在管理后台生成，也可以初始化：

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

- `models` 为空或包含 `*`：允许全部模型。
- `upstreams` 为空：允许全部上游。
- 提示词/上下文作用域可填 `*`、`__all__`、`__none__`、客户端 `id`、名称或完整 Key。

网关规则和命中的资料上下文会在每次 Chat、Messages、Responses 请求中重新构建。Responses 使用 `instructions` 注入，不会把网关上下文伪装成用户消息。按需上下文可按关键词、模型和客户端匹配；启用“全量注入”后忽略关键词筛选，但仍受最大字符数限制。

`history_max_chars` 默认 `0`，表示不裁剪。设置为正数后，只裁剪普通历史对话，保留网关规则、资料上下文以及客户端的 system/developer 消息。长 Responses 对话可调用 `/v1/responses/compact` 压缩历史。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 存活、存储和绑定状态 |
| `GET` | `/v1/models` | 聚合可用模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | 原生 Completions 或单条 Prompt 的 Chat 回退 |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/responses` | Responses 兼容层 |
| `POST` | `/v1/responses/compact` | 压缩 Responses 历史 |
| `GET` | `/v1/responses/{id}` | 读取已保存响应 |
| `POST` | `/v1/responses/{id}/cancel` | 取消流式响应 |
| `POST` | `/v1/messages` | Anthropic/Claude 风格请求 |

OpenAI SDK 示例：

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-...",
  baseURL: "https://your-domain.example/v1",
});

const response = await client.chat.completions.create({
  model: "provider/model-name",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
});
```

## 路由与性能

- `failover`：失败、超时或冷却时尝试其他上游。
- `load_balance`：结合权重、活跃请求、客户端 Key 亲和和近期延迟排序。
- `coordination_level`：控制对活跃/预留请求的分散程度，默认 `3`。
- `soft_interval_ms`：同一上游被多个 Key 同时选中时的建议错峰间隔，默认 `50`；设为 `0` 可关闭。
- `ROUTE_COORDINATOR`：跨 Cloudflare 边缘协调短期预约，模型请求仍从各自边缘直连上游。
- 流式故障转移只发生在首个可见输出前；已经输出给客户端后不会重放，避免重复文本或工具调用。
- `Hedged Request` 和 `Gateway Fast` 会并行/竞速多个候选。多账号池或并发受限的上游通常应关闭它们，以免主动增加同一模型的并发。
- SSE 每 5 秒发送保活注释，帮助中间代理维持连接；保活不是模型输出。

健康检查只验证上游 `/models`，不代表某个模型一定可用。要验证具体模型，请在管理后台执行模型测速。长推理模型可能需要较长首包时间，网关会在首包阶段使用相应超时并在失败时尝试备用上游。

## 统计与排障

- 内存统计：当前 isolate 的实时请求、Token、日志和活跃上游。
- Analytics Engine：长期统计和历史日志。
- D1/DO/KV：配置、响应存储、当前遥测镜像和路由状态。
- 响应头可查看 `x-llm-gateway-route-ms`、`x-llm-gateway-dispatch-ms`、`x-llm-gateway-upstream-start-ms`、`x-llm-gateway-upstream` 和 `x-llm-gateway-attempts`。
- `/health` 可确认请求是否进入网关以及当前选中的存储后端。

遇到“没有首包”时，先看 `x-llm-gateway-upstream-start-ms`：如果请求已经进入上游但该值很大，通常是上游调度或模型首包慢；如果请求未进入上游，重点检查 DO 错峰、候选模型权限、上游路径和超时配置。

## 安全注意事项

- 不要把真实上游 API Key 提交到仓库或公开日志。
- `ADMIN_TOKEN` 只是管理路径保护，不是完整登录系统。
- `API_KEY_CRYPT_SECRET` 生产环境必须长期稳定，变更后旧的加密上游 Key 可能无法解密。
- 上游导出文件包含明文 API Key，应当限制访问并及时删除。
- 内存实时统计会随 isolate 回收丢失，历史统计以 Analytics Engine 为准。

## 文件说明

- `_worker.js`：Worker/Pages Advanced Mode 入口。
- `admin-page.js`：管理后台页面。
- `provider-bridges.js`：通用上游及 NVIDIA NIM 等服务的协议适配。
- `presets.js`：上游模板。
- `wrangler.worker.toml`：Worker 部署配置。
- `wrangler.toml`：Pages/本地开发参考配置。
- `d1_migrations/0001_create_store.sql`：D1 初始化表结构。
