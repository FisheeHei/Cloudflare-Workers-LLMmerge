# Cloudflare Workers LLM Merge

[中文](#中文) | [English](#english)

## 中文

一个运行在 Cloudflare Workers、兼容 Cloudflare Pages Advanced Mode 的单文件 LLM 网关。

它把多个上游 LLM API Key 汇聚成你自己的统一入口，当前重点支持：

- OpenAI 兼容接口代理
- 多上游 API key 汇聚
- 加权负载均衡
- 失败轮询
- KV 持久化配置
- 隐藏式管理后台
- 客户端虚拟 API key 生成

### 主要特性

- 对外提供统一的 `/v1` OpenAI 兼容入口
- 支持多个上游供应商或同供应商多个 key
- 支持基于权重的负载均衡
- 支持失败后自动切换到下一个上游
- 上游配置保存在 Cloudflare KV
- 上游 API key 保存前会加密，KV 中不存明文
- 提供隐藏式管理页：仅 `/{ADMIN_TOKEN}` 可访问
- 其余网页访问默认返回 nginx 风格欢迎页
- 支持生成你自己的 `sk-gw-...` 风格客户端 key
- 支持手动刷新上游模型缓存

### 当前接口

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /{ADMIN_TOKEN}`
- `GET /{ADMIN_TOKEN}/api/config`
- `PUT /{ADMIN_TOKEN}/api/config`
- `POST /{ADMIN_TOKEN}/api/refresh`
- `GET /{ADMIN_TOKEN}/api/clients`
- `POST /{ADMIN_TOKEN}/api/clients`
- `DELETE /{ADMIN_TOKEN}/api/clients/:id`

### 配置方式

当前推荐“环境变量 + KV”的混合方式：

- 环境变量只放少量根配置
- 实际上游池配置写入 KV
- 管理后台编辑后直接覆盖 KV 配置

最少环境变量：

```env
ADMIN_TOKEN=change-me-admin-token
API_KEY_CRYPT_SECRET=change-me-32-bytes-or-longer
REQUEST_TIMEOUT_MS=90000
UPSTREAM_COOLDOWN_TTL=60
MODEL_CACHE_TTL=3600
```

可选静态种子配置：

```env
UPSTREAMS_JSON=[{"name":"nim-primary","base_url":"https://integrate.api.nvidia.com/v1","api_key":"nvapi-xxxxxxxx","models":["meta/llama-3.1-8b-instruct"],"paths":["/v1/chat/completions"],"weight":1}]
CLIENTS_JSON=[{"name":"default-client","key":"sk-gw-demo-please-change","models":["*"],"upstreams":["nim-primary"]}]
```

### 后台管理页

访问：

```text
https://your-domain.example/{ADMIN_TOKEN}
```

后台页支持：

- 新增/编辑/删除上游条目
- 选择预设模板
- 填写备注、内部名称、Base URL、API key
- 配置模型白名单、路径白名单、权重、优先级、启停
- 切换 `load_balance` / `failover`
- 刷新模型缓存
- 生成/删除客户端虚拟 key

### 当前内置上游模板

- NVIDIA NIM
- DeepInfra
- Together AI
- Generic OpenAI-Compatible

### KV 中存储的数据

- `gateway:config`
- `client:index`
- `client:id:*`
- `client:token:*`
- `cache:models:*`
- `cooldown:upstream:*`

### 调度策略

支持两种开关，可混合使用：

- `load_balance`
  按权重在健康上游中分流
- `failover`
  上游失败后轮询下一个候选

如果关闭 `load_balance`，则按 `priority` 从小到大优先尝试。

默认判定为可重试的状态码：

- `408`
- `409`
- `425`
- `429`
- `500`
- `502`
- `503`
- `504`

### 本地开发

1. 创建 `.dev.vars`
2. 参考 [.dev.vars.example](D:/迁移文件/新建文件夹%20(3)/LLM-merge/.dev.vars.example) 填写配置
3. 创建并绑定 KV namespace
4. 运行：

```bash
wrangler dev
```

### 部署

创建 KV：

```bash
wrangler kv namespace create GATEWAY_KV
```

将返回的 namespace id 填入 [wrangler.toml](D:/迁移文件/新建文件夹%20(3)/LLM-merge/wrangler.toml)。

写入 secrets：

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
wrangler secret put UPSTREAMS_JSON
wrangler secret put CLIENTS_JSON
```

部署：

```bash
wrangler deploy
```

### OpenAI SDK 示例

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});
```

### 目前故意没做的

- 完整登录系统
- 细粒度权限控制
- 精确计费与配额
- 审计日志
- Responses API
- 图片/音频/文件类接口
- Claude / Anthropic 协议专用入口

这不是不能做，而是当前先保持最小可用。

## English

A single-file LLM gateway for Cloudflare Workers, also compatible with Cloudflare Pages Advanced Mode.

It merges multiple upstream LLM API keys behind your own unified endpoint. The current focus is:

- OpenAI-compatible proxying
- Multiple upstream API key aggregation
- Weighted load balancing
- Failover retry
- KV-backed configuration
- Hidden admin dashboard
- Virtual client API key issuance

### Key Features

- Unified OpenAI-compatible `/v1` endpoint
- Multiple providers or multiple keys from the same provider
- Weighted request distribution
- Automatic fallback to the next upstream on failure
- Upstream configuration stored in Cloudflare KV
- Upstream API keys encrypted before storage
- Hidden admin page available only at `/{ADMIN_TOKEN}`
- nginx-style welcome page for all other browser visits
- Virtual `sk-gw-...` style client keys
- Manual upstream model cache refresh

### Current Endpoints

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /{ADMIN_TOKEN}`
- `GET /{ADMIN_TOKEN}/api/config`
- `PUT /{ADMIN_TOKEN}/api/config`
- `POST /{ADMIN_TOKEN}/api/refresh`
- `GET /{ADMIN_TOKEN}/api/clients`
- `POST /{ADMIN_TOKEN}/api/clients`
- `DELETE /{ADMIN_TOKEN}/api/clients/:id`

### Configuration Model

The recommended setup is now "environment variables + KV":

- env vars hold only the root-level settings
- the actual upstream pool config lives in KV
- saving from the admin dashboard overwrites the KV config directly

Minimum env vars:

```env
ADMIN_TOKEN=change-me-admin-token
API_KEY_CRYPT_SECRET=change-me-32-bytes-or-longer
REQUEST_TIMEOUT_MS=90000
UPSTREAM_COOLDOWN_TTL=60
MODEL_CACHE_TTL=3600
```

Optional static seed config:

```env
UPSTREAMS_JSON=[{"name":"nim-primary","base_url":"https://integrate.api.nvidia.com/v1","api_key":"nvapi-xxxxxxxx","models":["meta/llama-3.1-8b-instruct"],"paths":["/v1/chat/completions"],"weight":1}]
CLIENTS_JSON=[{"name":"default-client","key":"sk-gw-demo-please-change","models":["*"],"upstreams":["nim-primary"]}]
```

### Admin Dashboard

Access:

```text
https://your-domain.example/{ADMIN_TOKEN}
```

The admin page supports:

- add / edit / delete upstream entries
- choose preset templates
- fill note, internal name, Base URL, and API key
- configure model allowlist, path allowlist, weight, priority, enabled/disabled state
- toggle `load_balance` / `failover`
- refresh model cache
- create / delete virtual client keys

### Built-in Presets

- NVIDIA NIM
- DeepInfra
- Together AI
- Generic OpenAI-Compatible

### KV Keys Used

- `gateway:config`
- `client:index`
- `client:id:*`
- `client:token:*`
- `cache:models:*`
- `cooldown:upstream:*`

### Routing Strategy

Two switches are supported and can be combined:

- `load_balance`
  distributes traffic across healthy upstreams by weight
- `failover`
  retries the next candidate when an upstream fails

If `load_balance` is disabled, upstreams are attempted by ascending `priority`.

Retryable status codes by default:

- `408`
- `409`
- `425`
- `429`
- `500`
- `502`
- `503`
- `504`

### Local Development

1. Create `.dev.vars`
2. Fill it based on [.dev.vars.example](D:/迁移文件/新建文件夹%20(3)/LLM-merge/.dev.vars.example)
3. Create and bind a KV namespace
4. Run:

```bash
wrangler dev
```

### Deployment

Create KV:

```bash
wrangler kv namespace create GATEWAY_KV
```

Put the returned namespace id into [wrangler.toml](D:/迁移文件/新建文件夹%20(3)/LLM-merge/wrangler.toml).

Set secrets:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
wrangler secret put UPSTREAMS_JSON
wrangler secret put CLIENTS_JSON
```

Deploy:

```bash
wrangler deploy
```

### OpenAI SDK Example

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});
```

### Intentionally Not Included Yet

- full login system
- fine-grained RBAC
- precise billing and quota tracking
- audit logs
- Responses API
- image / audio / file endpoints
- dedicated Claude / Anthropic protocol gateway

These are possible later, but intentionally excluded from the minimal version.
