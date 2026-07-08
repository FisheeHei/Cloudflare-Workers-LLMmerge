# LLM-merge

[English README](./README_EN.md)

LLM-merge 是一个运行在 Cloudflare Workers / Pages Advanced Mode 上的单文件 LLM 聚合网关。它把多个上游模型服务聚合成统一的 `/v1` Base URL，并提供一个轻量管理后台，用于配置上游、客户端 Key、模型、提示词、上下文、路由和统计。

## 功能

- OpenAI 兼容接口：`/v1/models`、`/v1/chat/completions`、`/v1/embeddings`
- Responses API 简单兼容层：`/v1/responses`
- Claude / Anthropic 风格入口：`/v1/messages`
- 多上游聚合：启用/停用、权重、优先级、路径、模型白名单
- 路由策略：故障转移、负载均衡、Hedged Request、Gateway Fast 模式
- 模型选择器：按来源和标签筛选，支持上下文长度备注
- NIM 桥接：对 GLM、Qwen、MiniMax、Kimi、DeepSeek、Nemotron、Mistral 等模型做轻量参数适配
- Prompt / Context 注入：按客户端 Key 生效，支持上下文片段、关键词和导入/导出
- 统计与日志：内存实时显示 + Analytics Engine 历史统计，KV fallback
- 上游导入/导出、健康检查、模型测速、活跃上游显示

## 部署

### 1. 创建项目

Workers 可直接部署：

```bash
wrangler deploy
```

Pages 使用 Advanced Mode，将 `_worker.js` 作为入口。项目不需要构建步骤。

### 2. 绑定 KV

KV 变量名必须是：

```txt
KV
```

KV 空间名称可以任意。KV 用于保存配置、客户端 Key、上游、Prompt、Context、模型缓存和 cooldown。

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
| `KV` | 是 | Cloudflare KV binding |
| `ADMIN_TOKEN` | 建议 | 后台路径 token |
| `API_KEY_CRYPT_SECRET` | 建议 | 上游 API Key 加密密钥，生产环境固定后不要随意更换 |
| `ANALYTICS` | 可选 | Analytics Engine binding，用于请求统计写入 |
| `ANALYTICS_ACCOUNT_ID` | 可选 | 查询 Analytics Engine 所需 Account ID |
| `ANALYTICS_API_TOKEN` | 可选 | 需要 `Account Analytics Read` 权限 |
| `ANALYTICS_DATASET` | 可选 | 默认 `llmmerge_requests` |
| `REQUEST_TIMEOUT_MS` | 可选 | 默认 `180000` |
| `STREAM_IDLE_TIMEOUT_MS` | 可选 | 默认 `900000` |
| `UPSTREAM_COOLDOWN_TTL` | 可选 | 默认 `60` 秒 |
| `MODEL_CACHE_TTL` | 可选 | 默认 `3600` 秒 |
| `STDTIME_URL` | 可选 | 默认 `https://stdtime.gov.hk/` |
| `UPSTREAMS_JSON` | 可选 | 初始上游种子配置 |
| `CLIENTS_JSON` | 可选 | 初始客户端 Key 种子配置 |

## 上游

后台可以直接添加上游，也可以用 `UPSTREAMS_JSON` 初始化：

```json
[
  {
    "name": "nim-primary",
    "preset": "nvidia-nim",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "nvapi-...",
    "models": ["z-ai/glm-5.2", "moonshotai/kimi-k2.5"],
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
- OpenRouter
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

## 使用

OpenAI SDK：

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-...",
  baseURL: "https://your-domain.example/v1",
});

const res = await client.chat.completions.create({
  model: "z-ai/glm-5.2",
  messages: [{ role: "user", content: "hello" }],
});
```

支持的主要路径：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 存活检查 |
| `GET` | `/v1/models` | 聚合模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/responses` | Responses API 兼容层 |
| `POST` | `/v1/messages` | Claude / Anthropic 风格入口 |
| `POST` | `/v1/embeddings` | Embeddings |

## 统计机制

- 内存：最近请求实时显示，包含请求数、Token、日志和活跃上游
- Analytics Engine：长期统计与日志查询
- KV fallback：未绑定 Analytics Engine 时批量写入统计

也就是说：内存负责快，Analytics Engine 负责存，KV 负责配置。

## 路由机制

- `failover`：上游失败后尝试下一个
- `load_balance`：按权重分配
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
- 长推理模型首包可能很慢，建议开启合适的超时、Hedged Request 或 Gateway Fast 模式

