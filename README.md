# ⚡ LLM-merge

[English README](./README_EN.md)

LLM-merge 是一个运行在 Cloudflare Workers / Pages Advanced Mode 上的单文件 LLM 网关。它把多个 OpenAI 兼容上游聚合成你自己的 `/v1` 入口，并提供一个隐藏管理后台，用来维护上游、模型白名单、客户端 Key、日志和统计。

> [!IMPORTANT]
> `ADMIN_TOKEN` 是后台访问路径的一部分，不是完整登录系统。生产环境请改成随机长字符串，并只把后台地址发给可信用户。

> [!WARNING]
> `API_KEY_CRYPT_SECRET` 用来加密保存上游 API Key。生产环境设置后不要随意更换，否则 KV 中已保存的上游密钥可能无法解密。

## ✨ 功能

- 统一 OpenAI 兼容入口：`/v1/models`、`/v1/chat/completions`、`/v1/embeddings`
- Claude Code 兼容入口：`/v1/messages`，内部转为 OpenAI Chat Completions 请求
- 多上游聚合：支持多个供应商、多个 API Key、启停、权重、优先级、路径白名单、模型白名单
- 路由策略：支持加权负载均衡和失败后自动切换
- 管理后台：通过 `/{ADMIN_TOKEN}` 进入，配置上游、客户端 Key、健康检查、模型导入、日志和统计
- 模型选择器：从已保存上游或新增上游弹窗拉取模型，按来源和系列分组筛选
- 客户端虚拟 Key：生成 `sk-gw-...`，可限制可用模型和上游
- KV 持久化：保存配置、客户端 Key、模型缓存、冷却状态、日志和统计
- 上游 API Key 加密保存

## 🚀 部署

### 1. 创建 Cloudflare Worker 或 Pages 项目

Workers 可直接部署：

```bash
wrangler deploy
```

Pages 推荐使用 Advanced Mode，让 `_worker.js` 作为运行入口。本项目不需要前端构建产物。

### 2. 绑定 KV

创建 KV namespace：

```bash
wrangler kv namespace create KV
```

然后在 Workers / Pages 设置中绑定 KV，绑定变量名必须是：

```text
KV
```

KV namespace 的显示名称可以随意，代码只读取 `env.KV`。

### 3. 设置变量和 Secret

生产环境至少建议设置：

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
```

本地开发可以复制示例：

```bash
copy .dev.vars.example .dev.vars
```

macOS / Linux：

```bash
cp .dev.vars.example .dev.vars
```

### 4. 打开后台

部署后访问：

```text
https://your-domain.example/{ADMIN_TOKEN}
```

如果没有设置 `ADMIN_TOKEN`，默认后台路径是：

```text
/llmmerge-admin
```

生产环境不建议使用默认值。

## 🔧 变量

| 变量名 | 示例 | 必填 | 说明 |
| --- | --- | --- | --- |
| `KV` | KV binding | 建议 | Cloudflare KV 绑定名，后台和持久化配置需要它 |
| `ADMIN_TOKEN` | `change-me-admin-token` | 建议 | 后台路径。也兼容 `ADMIN`、`admin`、`TOKEN`、`token` |
| `API_KEY_CRYPT_SECRET` | `change-me-32-bytes-or-longer` | 建议 | 上游 API Key 加密密钥，生产环境应固定且足够长 |
| `REQUEST_TIMEOUT_MS` | `180000` | 否 | 上游首包/空闲超时，默认 `180000` |
| `STDTIME_URL` | `https://stdtime.gov.hk/` | 否 | 香港标准时间校准源；项目时间声明为 `Asia/Hong_Kong` / UTC+8 |
| `UPSTREAM_COOLDOWN_TTL` | `60` | 否 | 上游失败后的冷却秒数，默认 `60` |
| `MODEL_CACHE_TTL` | `3600` | 否 | 模型列表缓存秒数，默认 `3600` |
| `UPSTREAMS_JSON` | 见下方示例 | 否 | 首次启动的上游种子配置；KV 已有配置时以 KV 为准 |
| `CLIENTS_JSON` | 见下方示例 | 否 | 首次启动的客户端 Key 种子配置 |

## 🔌 上游配置

`UPSTREAMS_JSON` 可作为首次启动种子，也可以在后台直接新增：

```json
[
  {
    "name": "nim-primary",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "nvapi-xxxxxxxx",
    "models": ["meta/llama-3.1-8b-instruct", "nvidia/nv-embed-v1"],
    "paths": ["/v1/chat/completions", "/v1/embeddings"],
    "weight": 3,
    "priority": 1,
    "enabled": true
  }
]
```

| 字段 | 说明 |
| --- | --- |
| `name` | 上游内部名称，用于后台、日志和客户端限制 |
| `base_url` | OpenAI 兼容 API 地址；Cloudflare Workers AI REST 模板会按 Account ID 生成 |
| `api_key` | 上游 API Key；Cloudflare 模板这里填 API Token；通过后台保存后会加密 |
| `models` | 模型白名单；空数组表示不限制模型 |
| `paths` | 路径白名单，例如 `/v1/chat/completions`、`/v1/embeddings` |
| `weight` | 负载均衡权重 |
| `priority` | 关闭负载均衡时的尝试顺序，数字越小越优先 |
| `enabled` | 是否启用 |
| `headers` | 可选的额外请求头 |
| `note` | 可选备注 |
| `account_id` | Cloudflare Workers AI REST 模板使用的 Account ID |

内置上游模板：

- NVIDIA NIM
- DeepInfra
- Together AI
- DeepSeek
- Cloudflare Workers AI (REST)
- 自定义 OpenAI 兼容上游

Cloudflare Workers AI REST 模板按官方 AI Gateway REST API 配置：

- Base URL：`https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`
- API Key：Cloudflare API Token；调用模型需要 `AI Gateway` 权限，导入模型目录需要 `Workers AI Read` 或 `Workers AI Write` 权限
- Header：默认带 `cf-aig-gateway-id: default`；如果你使用其他 Gateway ID，在上游 `headers` 里修改
- 模型名：Workers AI 使用 `@cf/author/model`，例如 `@cf/moonshotai/kimi-k2.6`
- 模型目录：后台通过 Cloudflare `/ai/models/search` 拉取，来源以 Cloudflare Model Catalog 为准

可以先用官方 verify 接口测试 API Token：

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer {API_TOKEN}"
```

## 🔑 客户端 Key

`CLIENTS_JSON` 示例：

```json
[
  {
    "name": "default-client",
    "key": "sk-gw-demo-please-change",
    "models": ["*"],
    "upstreams": ["nim-primary"]
  }
]
```

| 字段 | 说明 |
| --- | --- |
| `name` | 客户端名称 |
| `key` | 客户端调用网关用的 Key，必须以 `sk-` 开头 |
| `models` | 可用模型；为空或包含 `*` 表示不限制 |
| `upstreams` | 可用上游；为空表示不限制 |

后台也可以直接生成 `sk-gw-...` 客户端 Key。

## 🧪 使用

### OpenAI SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});

const completion = await client.chat.completions.create({
  model: "meta/llama-3.1-8b-instruct",
  messages: [{ role: "user", content: "hello" }],
});
```

### Claude Code / Anthropic 风格入口

如果客户端支持自定义 Anthropic Base URL，可指向：

```text
https://your-domain.example/v1
```

并使用后台生成的 `sk-gw-...` Key。`/v1/messages` 会在 Worker 内转为 OpenAI Chat Completions 请求。

## 📡 接口

公开接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 存活检查 |
| `GET` | `/v1/models` | 聚合可用模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions 兼容代理 |
| `POST` | `/v1/embeddings` | OpenAI Embeddings 兼容代理 |
| `POST` | `/v1/messages` | Claude / Anthropic 风格消息入口 |

后台接口都位于：

```text
/{ADMIN_TOKEN}/api/*
```

常用后台能力包括：读取/保存配置、刷新模型缓存、健康检查、拉取上游模型、检测上游能力、创建/删除客户端 Key、读取日志和统计。

## 🛠️ 管理后台

后台地址：

```text
https://your-domain.example/{ADMIN_TOKEN}
```

后台界面划分：

| 区域 | 用途 |
| --- | --- |
| 统计概览 | 查看请求量、成功率、token 汇总、当前模型 |
| 客户端 Key | 生成、刷新、复制和删除 `sk-gw-...` |
| 上游配置 | 新增、编辑、删除上游，配置模型、路径、权重和优先级 |
| 模型选择器 | 从上游拉取模型，按来源和系列筛选后写回配置 |
| 日志与诊断 | 查看最近请求、健康检查、上游能力检测 |
| 全局设置 | 配置超时、冷却时间、模型缓存和路由开关 |

后台支持：

- 新增、编辑、删除上游
- 新增和删除上游时自动保存配置
- 普通字段编辑后手动保存配置
- 从当前填写的上游或已保存上游拉取模型
- 按模型来源和系列筛选模型；Workers AI 在选择器里隐藏 `@cf/` 展示，但配置仍保留完整模型名
- 导出、导入上游配置文件
- 检查上游健康状态和延迟
- 切换 `load_balance` / `failover`
- 生成、刷新、删除客户端 Key
- 查看最近请求日志、24 小时统计、当前模型和 token 汇总

## 💾 KV 数据

| Key | 说明 |
| --- | --- |
| `gateway:config` | 后台保存的网关配置 |
| `client:index` | 客户端 Key 索引 |
| `client:id:*` | 按客户端 ID 保存的记录 |
| `client:token:*` | 按客户端 Key 保存的反查记录 |
| `cache:models:*` | 上游模型缓存 |
| `cooldown:upstream:*` | 上游失败冷却状态 |
| `gateway:logs` | 最近请求日志 |
| `gateway:stats:*` | 按小时聚合的统计数据 |

## 🔀 路由策略

- `load_balance` 开启时，按 `weight` 在健康上游中分流
- `load_balance` 关闭时，按 `priority` 从小到大尝试
- `failover` 开启时，上游失败会尝试下一个候选
- `failover` 关闭时，只尝试当前候选

默认可重试状态码：

```text
408, 409, 425, 429, 500, 502, 503, 504
```

## ⚠️ 注意事项

- 不要把真实上游 API Key 暴露到公开仓库或前端页面。
- `ADMIN_TOKEN` 不是登录系统，只是隐藏路径；请使用随机长字符串。
- `API_KEY_CRYPT_SECRET` 一旦用于生产配置，不建议更换。
- KV 免费额度有限；日志和统计已做批量写入，但高流量场景仍需关注读写量。
- 上游 `models` 为空表示不限制模型，不是禁用模型。
- 客户端 `models` 为空或包含 `*` 表示不限制模型。
- Cloudflare Workers AI REST 模型名需要使用 `@cf/...` 格式。
- 导出文件包含明文 API Key，请妥善保管，不要公开分享。
- Cloudflare Worker 有运行时限制；超大响应、很慢的上游或长时间流式输出都可能触发平台限制。

## 💤 当前不做

- 完整账号登录系统
- 细粒度 RBAC 权限
- 精确计费、余额和配额
- 长期审计日志
- Responses API
- 图片、音频、文件等非文本接口

先保持单文件、低依赖、可直接部署。等真实使用证明需要，再加复杂功能。

## 🙏 致谢

README 结构参考了 [FisheeHei/CF-Workers-SUB](https://github.com/FisheeHei/CF-Workers-SUB) 的部署文档风格。
