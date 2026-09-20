# LLM-merge

[English README](./README_EN.md)

LLM-merge 是运行在 Cloudflare Workers 或 Pages Advanced Mode 上的 OpenAI-compatible LLM 网关。它将多个上游和多个客户端 Key 收敛到一个 `/v1` 地址，并从承接请求的 Cloudflare 边缘直接连接上游。

当前版本重点是稳定性：一次请求只连接一个上游；只有在首个可见输出前发生明确失败时，才按顺序切换到下一个候选 Key。

## 适用场景

- 用多个 NVIDIA NIM 或其他 OpenAI-compatible Key 组成账号池。
- 为 Codex、Agent、OpenAI SDK、Anthropic Messages 等客户端提供统一入口。
- 按客户端 Key、模型和路径限制可用上游。
- 为不同客户端注入系统提示词、全局 Context 和按需资料。
- 使用 Cloudflare 多边缘接入用户，并在当前边缘直连上游。

## 主要功能

- OpenAI Chat Completions、Completions、Embeddings、Responses。
- Anthropic Messages 兼容层。
- `/v1/responses/compact`、Responses 存储、查询和取消。
- 通用 OpenAI-compatible 上游适配，以及 NVIDIA NIM 等常见参数适配。
- 上游模型/路径白名单、优先级、权重、冷却、应急上游和首包超时覆盖。
- Prompt / Context 注入：客户端范围、模型范围、关键词匹配、全量注入、截断和历史裁剪。
- 管理后台：模型刷新、健康检查、指定模型测速、客户端 Key、导入导出、日志和统计。
- 客户端状态接口：`/v1/gateway/status`，只返回当前客户端的连接和当日 token 汇总。

## 部署

### Workers

```bash
wrangler deploy --config wrangler.worker.toml
```

### Pages Advanced Mode

将 `_worker.js` 作为 Pages Advanced Mode 入口。不需要构建步骤，在 Pages 项目设置中配置 Variables、Secrets 和 Bindings。

两种部署方式使用相同的绑定名：

- `llmerge`：主状态存储，推荐绑定 D1。
- `ROUTE_COORDINATOR`：可选 Durable Object，仅用于跨边缘短期错峰建议。
- `KV`：兼容读取和降级镜像，不作为默认主存储。
- `ANALYTICS`：可选 Analytics Engine 长期统计。

不要启用 Smart Placement。用户应就近进入 Cloudflare，模型请求由当前边缘直接 `fetch` 上游。

## 存储职责

主状态后端按以下顺序自动选择：`llmerge` Durable Object > `llmerge` D1 > `KV`。

推荐使用 D1，绑定名必须是 `llmerge`：

```bash
wrangler d1 migrations apply <D1_DATABASE_NAME> --remote
```

迁移文件为 `d1_migrations/0001_create_store.sql`。首次读写时网关也会尝试创建 `llmmerge_store` 表。

`ROUTE_COORDINATOR` 不代理模型请求，不保存 Prompt、Context 或上游 Token。协调请求最多等待约 50ms；超时、异常或拒绝时立即回退到当前边缘本地路由。没有 DO 仍可正常运行。

## 必要配置

```txt
ADMIN_TOKEN=replace-with-a-random-value
API_KEY_CRYPT_SECRET=replace-with-a-long-random-secret
```

管理后台地址：

```txt
https://your-domain.example/{ADMIN_TOKEN}
```

生产环境应使用随机 `ADMIN_TOKEN`，不要依赖默认路径。

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REQUEST_TIMEOUT_MS` | `180000` | 上游请求基础超时；非流式请求还受全局响应预算限制 |
| `STREAM_IDLE_TIMEOUT_MS` | `900000` | 流式响应空闲超时 |
| `SSE_KEEPALIVE_MS` | `5000` | SSE 注释保活间隔 |
| `UPSTREAM_COOLDOWN_TTL` | `60` | 上游失败后的冷却秒数 |
| `MODEL_CACHE_TTL` | `3600` | 动态模型列表缓存秒数 |
| `UPSTREAMS_JSON` | 空 | 初始上游配置 JSON |
| `CLIENTS_JSON` | 空 | 初始客户端配置 JSON |
| `ANALYTICS_ACCOUNT_ID` | 空 | Analytics Engine 查询所需 Account ID |
| `ANALYTICS_API_TOKEN` | 空 | 需要 Account Analytics Read 权限 |
| `ANALYTICS_DATASET` | `llmmerge_requests` | Analytics Engine 数据集名 |

## 添加上游

可以在管理后台新增，也可以使用 `UPSTREAMS_JSON` 初始化：

```json
[
  {
    "name": "nim-primary",
    "preset": "nvidia-nim",
    "base_url": "https://integrate.api.nvidia.com/v1",
    "api_key": "your-nim-api-key",
    "models": ["deepseek-ai/deepseek-v4-flash-0731"],
    "paths": ["/v1/chat/completions"],
    "priority": 1,
    "weight": 1,
    "enabled": true,
    "emergency": false
  }
]
```

关键字段：

- `base_url`：上游 OpenAI-compatible API 根地址。
- `api_key`：上游 Key，保存后由网关加密存储。
- `models`：允许发送到该上游的模型；`*` 表示通配。
- `paths`：上游实际支持的网关路径。
- `priority`：越小越优先。
- `weight`：用于同优先级候选的稳定分散，不会触发并行请求。
- `emergency`：普通候选全部失败后才参与故障转移。
- `first_byte_timeout_ms`：可选的首包超时覆盖值。
- `failover_budget_ms`：故障转移总预算，默认 `30000` ms；多个 Key 共用该预算，避免每个 Key 依次等满首包超时。

多候选故障转移的默认首包探测上限为 `8000` ms，用于尽快切换失去响应的 Key；单上游请求和显式设置的 `first_byte_timeout_ms` 不受此默认探测上限覆盖，总预算仍然生效。

客户端权限、模型匹配、路径匹配和 `enabled` 状态始终有效。网关不会自动替换客户端请求的模型名称。

内置模板覆盖 NVIDIA NIM、DeepInfra、Together AI、DeepSeek、Kimi/Moonshot、MiniMax、OpenRouter、Groq、GLM/Zhipu、Cloudflare Workers AI REST 和自定义 OpenAI-compatible 上游。模板只提供默认适配，不替代上游自身的模型与路径配置。

### NVIDIA NIM 协议

网关按 NVIDIA 官方 LLM API 接入 NIM：

- 根地址通常为 `https://integrate.api.nvidia.com/v1`，请求使用 `POST /v1/chat/completions` 和 Bearer Token。
- 请求体沿用 OpenAI Chat Completions；`stream: true` 使用 SSE，正常结束为 `data: [DONE]`。工具调用、采样参数和推理参数只在对应模型文档支持时发送。
- DeepSeek V4 的 `reasoning_effort` 使用 `none`、`high`、`max`；GLM、Qwen、Kimi 等模型的思考参数由网关转换为各自的 NIM 字段。
- 某些 NIM 模型会先返回 `202`，并在 `NVCF-REQID` 中给出请求 ID。网关会自动轮询同一上游的 `/v1/status/{requestId}`，直到得到最终结果或达到请求预算，不会把临时 `202` 直接返回给客户端。
- 模型 ID 必须以 NIM 的实际模型名配置，网关只做别名映射，不自动替换客户端请求的模型。

参考 NVIDIA 官方文档：[Models](https://docs.api.nvidia.com/nim/reference/models-1)、[LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis)。

## 客户端 Key 与注入

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
- Prompt / Context 范围支持 `*`、`__all__`、`__none__`、客户端 ID、名称或完整 Key。

每次 Chat、Messages、Responses 请求都会重新生成固定注入 snapshot。模型切换、客户端范围或字符上限变化时，不复用旧 snapshot。实际 LLM 调用不会请求当前时间。

Responses 使用 `instructions` 注入，不会把网关规则伪装成用户消息。按需 Context 可以按关键词、模型和客户端匹配；全量注入会跳过关键词筛选，但仍受最大字符数限制。

`history_max_chars` 为 `0` 时不裁剪历史；设置正数后只裁剪普通历史，保留网关规则、资料上下文和客户端 system/developer 消息。长 Responses 对话可调用 `/v1/responses/compact`。

## 稳定路由

路由策略已经从实验性并行竞速收敛为单上游顺序策略：

```text
鉴权与模型/路径匹配
→ 普通健康候选
→ 普通冷却候选
→ 应急健康候选
→ 应急冷却候选
→ 优先级、模型精确度、当前压力和近期首包排序
→ 当前边缘发起一个上游请求
```

故障转移规则：

- 默认最多顺序尝试 3 个候选，最多 5 个。
- 只在首个可见文本、工具调用或正常完成事件之前切换。
- `[DONE]`、`response.completed` 和有效完成事件视为正常结束。
- 客户端断开后只取消当前上游，不启动后续尝试。
- NIM 429、5xx、首包超时、空流和明确连接失败会更新短期冷却状态。
- 健康检查只用于排序和诊断，不硬阻断真实请求。

绑定 `ROUTE_COORDINATOR` 后，多边缘请求会先在一个共享 DO 候选池中选择下一可用 Key，再由当前边缘直接连接上游；每次协调最多占用约 50ms。DO 不可用、超时或旧版本尚未支持候选池时立即 `fail-open` 到本地顺序路由。旧配置中的 `hedge_enabled`、`fast_routing`、`hedge_max`、`load_balance`、`coordination_level` 和 `soft_interval_ms` 仍可读取以保持兼容，但实验并行选项不会重新启用；当前请求始终保持单上游。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 存活、存储和绑定状态 |
| `GET` | `/v1/models` | 当前客户端可用模型 |
| `GET` | `/v1/gateway/status` | 当前客户端连接状态和当日 token 汇总 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/completions` | Completions 或 Prompt 回退层 |
| `POST` | `/v1/embeddings` | Embeddings |
| `POST` | `/v1/responses` | Responses |
| `POST` | `/v1/responses/compact` | 压缩 Responses 历史 |
| `GET` | `/v1/responses/{id}` | 读取已保存响应 |
| `POST` | `/v1/responses/{id}/cancel` | 取消流式响应 |
| `POST` | `/v1/messages` | Anthropic Messages |

客户端状态接口使用同一个客户端 Key：

```bash
curl https://your-domain.example/v1/gateway/status \
  -H "Authorization: Bearer sk-gw-..."
```

它不会返回完整 Key、上游 Key、上游地址或其他客户端数据。

## 性能与排障

- 用户到网关由 Cloudflare 边缘就近承接。
- 网关到上游从当前边缘直接连接，不让模型数据经过 DO。
- SSE 每 5 秒发送注释保活，保活不是模型输出。
- DO 协调最多等待约 50ms，超时即本地直连；`/health` 的 `has_route_coordinator` 表示跨边缘协调绑定，`has_do` 只表示主状态存储是否使用 DO。
- 失败状态和统计优先写入当前 isolate，再异步持久化。
- 首包超时会按模型类型区分普通模型和推理模型；上游可单独覆盖。

诊断响应头包括：`x-llm-gateway-trace-id`、`x-llm-gateway-upstream`、`x-llm-gateway-attempts`、`x-llm-gateway-route-ms`、`x-llm-gateway-dispatch-ms` 和 `x-llm-gateway-upstream-start-ms`。

如果没有首包，先看 `x-llm-gateway-upstream-start-ms`：数值较大通常表示上游或首包慢；没有上游开始标记则检查客户端权限、模型/路径匹配、配置读取和边缘运行状态。

## Agent 辅助窗口

实验性辅助脚本位于工作区外层的 `agent-helpers`，用于 Agent 明确使用网关时显示连接和客户端 token 汇总。它们：

- 必须显式收到网关 `/v1` Base URL 和客户端 Key。
- 不扫描 Agent 配置，不监听其他进程，不代理请求。
- 不使用管理员 Token，不显示完整 Key。
- 默认每 5 秒读取 `/v1/gateway/status`。

## 安全注意事项

- 不要将真实上游 Key、客户端 Key 或导出文件提交到仓库。
- `ADMIN_TOKEN` 只保护管理路径，不能替代完整身份系统。
- `API_KEY_CRYPT_SECRET` 生产环境必须长期稳定，否则旧上游 Key 可能无法解密。
- 上游导出包含明文 Key，使用后应限制访问并删除。
- 内存统计会随 isolate 回收丢失，长期统计应使用 Analytics Engine。

## 文件说明

- `_worker.js`：Workers/Pages Advanced Mode 入口。
- `gateway-worker.js`：协议入口、鉴权、稳定路由、上游连接、流式收尾、存储和管理 API。
- `gateway-context.js`：Prompt / Context 注入、客户端范围、按需 Context 和历史裁剪。
- `gateway-observability.js`：请求追踪、失败分类和诊断字段。
- `provider-bridges.js`：通用上游及 NVIDIA NIM 等服务的协议适配。
- `admin-page.js`：管理后台。
- `presets.js`：上游模板。
- `wrangler.worker.toml`：Worker 部署配置。
- `wrangler.toml`：Pages/本地开发参考配置。
- `d1_migrations/0001_create_store.sql`：D1 初始化表结构。
