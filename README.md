# Cloudflare Workers LLM Merge

[English README](./README_EN.md)

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

## 主要特性

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

## 当前接口

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

## 配置方式

Cloudflare deployment persistence:

- non-sensitive defaults are pinned in `wrangler.toml` under `[vars]`
- `API_KEY_CRYPT_SECRET` should be configured as a Cloudflare Secret
- upstream pools and generated client keys are stored in KV
- redeploying the Worker should not require re-entering KV-backed settings

当前推荐“环境变量 + KV”的混合方式：

- 环境变量只放少量根配置
- 实际上游池配置写入 KV
- 管理后台编辑后直接覆盖 KV 配置

说明：

- Cloudflare KV 命名空间本身可以叫任何名字
- 但绑定到 Worker 的变量名必须是 `KV`
- 代码读取的是 `env.KV`

最少环境变量：

```env
API_KEY_CRYPT_SECRET=change-me-32-bytes-or-longer
REQUEST_TIMEOUT_MS=90000
UPSTREAM_COOLDOWN_TTL=60
MODEL_CACHE_TTL=3600
```

`ADMIN_TOKEN` 现在可以省略。

- 如果未设置，默认值是 `llmmerge-admin`
- 对应后台地址就是 `/<默认值>`，也就是 `/llmmerge-admin`
- 更建议你自行覆盖成随机值

可选静态种子配置：

```env
UPSTREAMS_JSON=[{"name":"nim-primary","base_url":"https://integrate.api.nvidia.com/v1","api_key":"nvapi-xxxxxxxx","models":["meta/llama-3.1-8b-instruct"],"paths":["/v1/chat/completions"],"weight":1}]
CLIENTS_JSON=[{"name":"default-client","key":"sk-gw-demo-please-change","models":["*"],"upstreams":["nim-primary"]}]
```

## 后台管理页

访问：

```text
https://your-domain.example/{ADMIN_TOKEN}
```

后台页支持：

- 新增、编辑、删除上游条目
- 选择预设模板
- 填写备注、内部名称、Base URL、API key
- 配置模型白名单、路径白名单、权重、优先级、启停
- 切换 `load_balance` / `failover`
- 刷新模型缓存
- 生成、删除客户端虚拟 key

## 当前内置上游模板

- NVIDIA NIM
- DeepInfra
- Together AI
- Generic OpenAI-Compatible

## KV 中存储的数据

- `gateway:config`
- `client:index`
- `client:id:*`
- `client:token:*`
- `cache:models:*`
- `cooldown:upstream:*`

## 调度策略

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

## 本地开发

1. 创建 `.dev.vars`
2. 参考 [.dev.vars.example](D:/迁移文件/新建文件夹%20(3)/LLM-merge/.dev.vars.example) 填写配置
3. 在 Cloudflare 中创建并绑定一个名字为 `KV` 的 KV namespace
4. 运行：

```bash
wrangler dev
```

## 部署

创建 KV：

```bash
wrangler kv namespace create KV
```

然后在你的 Cloudflare Workers 或 Pages 项目设置里，绑定一个名字为 `KV` 的 KV namespace。

也就是说：

- 命名空间显示名随意
- 绑定变量名固定为 `KV`

写入 secrets：

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put API_KEY_CRYPT_SECRET
wrangler secret put UPSTREAMS_JSON
wrangler secret put CLIENTS_JSON
```

如果你不想显式设置 `ADMIN_TOKEN`，也可以不写这项，此时后台默认路径为：

```text
/llmmerge-admin
```

部署：

```bash
wrangler deploy
```

## OpenAI SDK 示例

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-gw-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  baseURL: "https://your-domain.example/v1",
});
```

## 目前故意没做的

- 完整登录系统
- 细粒度权限控制
- 精确计费与配额
- 审计日志
- Responses API
- 图片、音频、文件类接口
- Claude / Anthropic 协议专用入口

这不是不能做，而是当前先保持最小可用。
