# 客户端对接文档：设备码换取临时凭证调用 AI

本文面向桌面 / CLI 等客户端开发者，说明如何通过 **Aone 登录 + 设备码** 换取 **24 小时临时凭证**，并用该凭证转发调用 AI（OpenAI 兼容等接口）。

> 关键变更：用户不再持有长期的个人 API Key。客户端必须使用「设备码 → 临时凭证」流程获取凭证，凭证有效期 **24 小时**，过期后重新换取。

---

## 1. 名词约定

| 名词 | 说明 | 形态 |
| --- | --- | --- |
| `base_url` | Bifrost 网关地址，登录回调时下发 | `https://your-gateway` |
| 会话令牌 `session token` | 浏览器登录后下发，仅用于「注册设备」一步 | 不透明字符串 |
| 设备指纹 `device_fingerprint` | 由客户端生成、长期稳定、唯一标识本设备 | ≤ 512 字符 |
| 设备码 `authorization_code` | 注册设备后返回，**长期持有**、可持久化保存 | `advc_...` |
| 临时凭证 `credential` | 用设备码换取，**24 小时有效**，用于 AI 转发 | `bf-tmp-...` |

---

## 2. 整体流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 一次性：登录并注册设备                                              │
│                                                                   │
│  ①浏览器登录(Aone SSO) ──► 拿到 session token + base_url           │
│  ②POST /api/aone/devices/authorize (Bearer session) ──► advc_设备码 │
│     (持久化保存 advc_设备码 + device_fingerprint)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 反复执行：换取并使用临时凭证                                        │
│                                                                   │
│  ③POST /api/aone/devices/token (advc_设备码 + 指纹) ──► bf-tmp_凭证 │
│  ④调用 AI: Authorization: Bearer bf-tmp_凭证                       │
│             X-Device-Fingerprint: 指纹                            │
│  ⑤收到 401 ──► 回到 ③ 重新换取新凭证                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 接口详情

所有请求 `Content-Type: application/json`。下面 `BASE_URL` 即登录时下发的 `base_url`。

### ① 登录获取会话令牌（一次性）

客户端用系统浏览器打开：

```
{BASE_URL}/login?source=zwitch
```

用户完成 Aone SSO 后，网关会重定向到成功页，并通过 **deeplink** 把结果回传给客户端：

```
zwitch://open?access_token=<SESSION_TOKEN>&base_url=<BASE_URL>
```

客户端从 deeplink 中取出：
- `access_token`：会话令牌（仅用于第 ② 步注册设备）
- `base_url`：网关地址

> 会话令牌不要用于调用 AI，它只用来注册设备。

### ② 注册设备，换取设备码（一次性，需登录态）

```http
POST {BASE_URL}/api/aone/devices/authorize
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json

{
  "device_fingerprint": "<DEVICE_FINGERPRINT>",
  "device_name": "Mac mini - 研发"
}
```

响应：

```json
{ "authorization_code": "advc_3f2c1b8a-..." }
```

客户端需 **持久化保存** `authorization_code` 与对应的 `device_fingerprint`。该设备码长期有效，可重复用于第 ③ 步。

> 同一 `(用户, 设备指纹)` 多次调用 `authorize` 会刷新并返回新的设备码（幂等替换），旧设备码失效。

### ③ 用设备码换取 24h 临时凭证（反复执行，无需登录态）

```http
POST {BASE_URL}/api/aone/devices/token
Content-Type: application/json

{
  "authorization_code": "advc_3f2c1b8a-...",
  "device_fingerprint": "<DEVICE_FINGERPRINT>"
}
```

响应：

```json
{
  "credential": "bf-tmp-a1b2c3...",
  "access_token": "bf-tmp-a1b2c3...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "expires_at": "2026-05-31T09:28:00Z",
  "base_url": "https://your-gateway"
}
```

字段说明：
- `credential`：**临时凭证**，用于第 ④ 步调用 AI。`access_token` 是其别名（向后兼容），值相同。
- `expires_in`：剩余有效秒数（约 86400 = 24h）。
- `expires_at`：绝对过期时间（建议据此提前刷新）。

> 每次换取都会使该设备之前的临时凭证失效（一个设备同一时刻只保留一个有效凭证）。

### ④ 使用临时凭证调用 AI（转发）

凭证作为 `Authorization: Bearer`，并 **必须** 同时携带设备指纹头 `X-Device-Fingerprint`：

```http
POST {BASE_URL}/v1/chat/completions
Authorization: Bearer bf-tmp-a1b2c3...
X-Device-Fingerprint: <DEVICE_FINGERPRINT>
Content-Type: application/json

{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "你好" }]
}
```

支持的转发路径前缀（任选其一，按对接的 SDK 风格）：

```
/v1/        /openai/    /anthropic/   /genai/    /bedrock/
/cohere/    /litellm/   /langchain/   /pydanticai/
```

> `X-Device-Fingerprint` 必须与换取凭证时使用的指纹一致，否则返回 401。该头不会被转发到上游模型。

### ⑤ 撤销设备（登出 / 解绑，可选）

```http
POST {BASE_URL}/api/aone/devices/revoke
Content-Type: application/json

{
  "authorization_code": "advc_3f2c1b8a-...",
  "device_fingerprint": "<DEVICE_FINGERPRINT>"
}
```

撤销设备码后，该设备已签发的临时凭证一并失效。

---

## 4. 错误处理与刷新策略

| 场景 | HTTP | 客户端处理 |
| --- | --- | --- |
| 临时凭证过期 / 失效 | `401` | 回到第 ③ 步，用设备码重新换取新凭证后重试 |
| 缺少 / 不匹配设备指纹 | `401`（`missing/mismatch device fingerprint`） | 检查是否带上正确的 `X-Device-Fingerprint` |
| 设备码无效 / 已撤销 | `401`（`/token` 返回） | 设备码失效，回到第 ① / ② 步重新登录注册 |
| 用户被禁用 | `403` | 提示用户联系管理员 |
| 设备指纹与设备码不匹配 | `403`（`/token` 返回） | 用注册时的指纹重试 |

推荐的客户端状态机：

```
有有效凭证(未过期)?
  ├─ 是 → 直接调用 AI（带 Authorization + X-Device-Fingerprint）
  │        └─ 若返回 401 → 标记凭证失效 → 走「换取凭证」
  └─ 否 → 换取凭证(③)
            ├─ 成功 → 缓存 credential / expires_at → 调用 AI
            └─ 401  → 设备码失效 → 重新登录注册(①②) → 再换取
```

建议：
- 在 `expires_at` 前预留缓冲（如提前 5~10 分钟）主动刷新，避免请求中途过期。
- 凭证缓存在内存即可；设备码 `advc_...` 持久化保存，避免每次都重新登录。
- 同一设备只需一个有效凭证；并发请求复用同一凭证即可。

---

## 5. 设备指纹生成建议

- 在同一台设备 / 同一安装上保持 **稳定不变**（如：机器标识 + 应用安装 ID 的哈希）。
- 全局唯一，避免多设备碰撞。
- 长度 ≤ 512 字符；过长会被判为无效。
- 不要在每次启动时随机生成，否则会被识别为新设备。

---

## 6. 端到端示例（curl）

```bash
BASE_URL="https://your-gateway"
FP="device-fp-stable-xxxx"

# ② 注册设备（SESSION_TOKEN 来自浏览器登录回调）
ADVC=$(curl -s -X POST "$BASE_URL/api/aone/devices/authorize" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"device_fingerprint\":\"$FP\",\"device_name\":\"my-cli\"}" \
  | jq -r .authorization_code)

# ③ 换取 24h 临时凭证
CRED=$(curl -s -X POST "$BASE_URL/api/aone/devices/token" \
  -H "Content-Type: application/json" \
  -d "{\"authorization_code\":\"$ADVC\",\"device_fingerprint\":\"$FP\"}" \
  | jq -r .credential)

# ④ 调用 AI
curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $CRED" \
  -H "X-Device-Fingerprint: $FP" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"你好"}]}'
```

---

## 7. 接口速查

| 步骤 | 方法 | 路径 | 鉴权 | 频率 |
| --- | --- | --- | --- | --- |
| 登录 | GET（浏览器） | `/login?source=zwitch` | SSO | 一次性 |
| 注册设备 | POST | `/api/aone/devices/authorize` | `Bearer <session>` | 一次性 |
| 换取凭证 | POST | `/api/aone/devices/token` | 无（设备码即凭据） | 每 24h |
| 调用 AI | POST | `/v1/...`（或其它前缀） | `Bearer <credential>` + `X-Device-Fingerprint` | 高频 |
| 撤销设备 | POST | `/api/aone/devices/revoke` | 无（设备码即凭据） | 登出时 |

桌面端应用更新通过 GitHub Releases 获取，在 `tauri.conf.json` 的 updater 插件中配置 GitHub 源即可，无需经过 Bifrost 网关。
