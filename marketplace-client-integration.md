# Bifrost 应用市场 — 客户端对接指南

本文档说明 **Claude Code**、**Codex CLI** 及自研客户端如何从 Bifrost Gateway 获取市场清单（manifest），并将 **Skill / Plugin** 下载到本地。

---

## 1. 架构概览

```
┌─────────────────┐     ① 获取 manifest      ┌──────────────────────────┐
│  Claude Code /  │ ───────────────────────► │  Bifrost HTTP Gateway    │
│  Codex / 自研   │     ② 按 source 拉文件   │                          │
│  客户端         │ ◄─────────────────────── │  /.claude-plugin/        │
└─────────────────┘                          │    marketplace.json      │
        │                                    │  /.agents/plugins/       │
        │  ③ 写入本地目录                     │    marketplace.json      │
        ▼                                    │  /marketplace/{platform}/│
  ~/.claude/ ...                             │    {type}/{name}/*       │
  ~/.codex/ ...                              └──────────────────────────┘
```

Bifrost 将管理员导入的 Skill / Plugin 统一存储在 `marketplace_items` 表，并通过两类接口对外暴露：

| 类型 | 用途 |
|------|------|
| **Manifest 接口** | 返回 Claude / Codex 原生格式的 `marketplace.json`，供 CLI 直接添加为市场源 |
| **内容接口** | 按路径返回 `SKILL.md`、`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json` 及 bundle 内其它文件 |

每个条目带有 **platform** 字段：`claude`（Claude Code）或 `codex`（Codex CLI）。Manifest 按平台拆分，互不混用。

---

## 2. 部署模式与鉴权

### 2.1 公开目录（默认）

配置项 `public_read: true`（管理后台 → 源设置 → 发布目录）时：

- Manifest 与内容接口 **无需登录**
- 返回所有 `enabled=true` 的条目

### 2.2 私有目录 + 用户分配

`public_read: false` 时：

- 未登录用户无法访问
- 普通用户只能看到 **管理员分配** 给自己的条目
- 本地管理员不受限

### 2.3 鉴权方式

请求需携带以下之一（Cookie 或 Header 均可）：

| 方式 | 示例 |
|------|------|
| Session Cookie | `Cookie: token=<session_token>` |
| Bearer Token | `Authorization: Bearer <session_token>` |
| 设备临时凭证 | `Authorization: Bearer bf-tmp-...` |

**推荐接口（私有模式）**

| 接口 | 说明 |
|------|------|
| `GET /api/marketplace/my/manifest?platform=claude\|codex` | 当前用户可见条目的 manifest |
| `GET /api/marketplace/my/items` | 当前用户可见条目 **含完整 content bundle**（适合自研客户端一次性同步） |

---

## 3. 客户端接口清单

以下 `{BASE}` 表示 Gateway 根 URL，例如 `https://bifrost.example.com`。

### 3.1 Manifest（市场清单）

| 平台 | 路径 | 说明 |
|------|------|------|
| Claude Code | `GET {BASE}/.claude-plugin/marketplace.json` | 原生路径，Claude 可直接 `marketplace add` |
| Codex | `GET {BASE}/.agents/plugins/marketplace.json` | 原生路径，Codex 可直接 `plugin marketplace add` |
| 通用 | `GET {BASE}/api/marketplace/manifest?platform=claude` | 同上，Claude 格式 |
| 通用 | `GET {BASE}/api/marketplace/manifest?platform=codex` | Codex 格式 |
| 用户级 | `GET {BASE}/api/marketplace/my/manifest?platform=claude` | 需鉴权，仅分配条目 |
| 用户级 | `GET {BASE}/api/marketplace/my/manifest?platform=codex` | 需鉴权，仅分配条目 |

`platform` 查询参数可选，默认 `claude`。

### 3.2 条目内容（按文件路径）

| 路径模式 | 说明 |
|----------|------|
| `GET {BASE}/marketplace/{platform}/{item_type}/{name}/{file...}` | **推荐**，含平台前缀 |
| `GET {BASE}/marketplace/{item_type}/{name}/{file...}` | 兼容旧路径，等价于 `platform=claude` |

参数说明：

- `{platform}`：`claude` 或 `codex`
- `{item_type}`：`plugins` 或 `skills`（URL 中用复数）
- `{name}`：条目名称，与 manifest 中 `name` 一致
- `{file...}`：bundle 内相对路径；省略时返回该条目默认入口文件

**默认入口文件**

| 类型 | platform | 默认文件 |
|------|----------|----------|
| skill | 任意 | `SKILL.md` |
| plugin | claude | `.claude-plugin/plugin.json` |
| plugin | codex | `.codex-plugin/plugin.json` |

**示例**

```http
GET /marketplace/claude/skills/docs-helper/SKILL.md
GET /marketplace/claude/plugins/data-toolkit/.claude-plugin/plugin.json
GET /marketplace/claude/plugins/data-toolkit/agents/analyst.md
GET /marketplace/codex/plugins/my-tool/.codex-plugin/plugin.json
```

### 3.3 批量获取（自研客户端）

```http
GET /api/marketplace/my/items
Authorization: Bearer <token>
```

响应示例：

```json
{
  "count": 2,
  "items": [
    {
      "id": 1,
      "name": "docs-helper",
      "platform": "claude",
      "item_type": "skill",
      "description": "Documentation helper",
      "version": "1.0.0",
      "enabled": true,
      "icon_url": "/api/marketplace/items/1/icon",
      "content": {
        "skill_md": "---\nname: docs-helper\n---\n...",
        "files": {
          "references/guide.md": "..."
        }
      }
    }
  ]
}
```

`content` 字段结构：

| 字段 | 说明 |
|------|------|
| `plugin_json` | Plugin 的 manifest（Claude / Codex 共用存储） |
| `skill_md` | Skill 的 `SKILL.md` 全文 |
| `files` | 其它相对路径 → 文件内容（如 `agents/*.md`、`skills/*/SKILL.md`） |

### 3.4 图标

```http
GET /api/marketplace/items/{id}/icon
```

返回上传的图标二进制，或 302 跳转到 `icon_url` 外链。

---

## 4. Manifest 格式

### 4.1 Claude Code

```json
{
  "name": "bifrost-marketplace",
  "owner": {
    "name": "Bifrost",
    "email": "admin@example.com"
  },
  "plugins": [
    {
      "name": "data-toolkit",
      "source": "./marketplace/claude/plugins/data-toolkit",
      "description": "Data engineering plugin",
      "version": "1.0.0"
    },
    {
      "name": "docs-helper",
      "source": "./marketplace/claude/skills/docs-helper",
      "description": "Documentation skill",
      "version": "1.0.0"
    }
  ]
}
```

> Claude Code 将 Skill 与 Plugin 都放在 `plugins` 数组中，通过 `source` 路径区分（`skills/` vs `plugins/`）。

### 4.2 Codex

```json
{
  "name": "bifrost-marketplace",
  "interface": {
    "displayName": "Bifrost"
  },
  "plugins": [
    {
      "name": "my-tool",
      "displayName": "My Tool",
      "source": {
        "source": "local",
        "path": "./marketplace/codex/plugins/my-tool"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Plugins",
      "description": "Example Codex plugin"
    }
  ]
}
```

---

## 5. Source 路径 → HTTP URL 映射

Manifest 中的 `source` 为 **相对于 Gateway 根目录** 的路径（以 `./` 开头）。

| Manifest source | 内容根 URL |
|-----------------|------------|
| `./marketplace/claude/plugins/{name}` | `{BASE}/marketplace/claude/plugins/{name}/` |
| `./marketplace/claude/skills/{name}` | `{BASE}/marketplace/claude/skills/{name}/` |
| `./marketplace/codex/plugins/{name}` | `{BASE}/marketplace/codex/plugins/{name}/` |
| `./marketplace/codex/skills/{name}` | `{BASE}/marketplace/codex/skills/{name}/` |

**映射规则（自研客户端）**

```
source = "./marketplace/claude/plugins/foo"
→ 去掉 leading "./"
→ content_base = {BASE}/marketplace/claude/plugins/foo/
→ 下载 plugin.json: {content_base}.claude-plugin/plugin.json
```

Codex manifest 中 `source.path` 同样遵循上述规则。

---

## 6. 下载 Skill / Plugin 到本地

### 6.1 方式 A：原生 CLI 接入（推荐）

**Claude Code**

```bash
# 将 Bifrost 添加为市场源（Gateway 根 URL）
/plugin marketplace add https://bifrost.example.com

# 安装条目（@ 后为 manifest 中的 name 字段）
/plugin install data-toolkit@bifrost-marketplace
/plugin install docs-helper@bifrost-marketplace
```

Claude Code 会自动：

1. 拉取 `/.claude-plugin/marketplace.json`
2. 根据 `source` 路径下载 bundle 内文件
3. 安装到本地 plugin / skill 目录

**Codex CLI**

```bash
codex plugin marketplace add https://bifrost.example.com
codex plugin list --marketplace bifrost-marketplace
codex plugin install my-tool@bifrost-marketplace
```

Codex 会拉取 `/.agents/plugins/marketplace.json` 并按 `source.path` 安装。

> 私有目录模式下，需确保 CLI 请求能携带有效 Token，或改用下方自研同步方案。

---

### 6.2 方式 B：Manifest + 逐文件 HTTP 拉取

适合自定义安装器、IDE 插件、CI 同步脚本。

**流程**

```
1. GET manifest（公开或 /my/manifest）
2. 遍历 plugins[] 条目
3. 对每个条目：
   a. 解析 source → content_base URL
   b. GET 默认入口文件（plugin.json 或 SKILL.md）
   c. 解析 manifest / frontmatter，收集需下载的 files 列表
   d. 逐个 GET {content_base}{relative_path}
   e. 写入本地目录
```

**Skill 最小步骤**

```bash
BASE=https://bifrost.example.com
NAME=docs-helper

curl -sS "$BASE/marketplace/claude/skills/$NAME/SKILL.md" \
  -o "./skills/$NAME/SKILL.md"
```

**Plugin（Claude）最小步骤**

```bash
BASE=https://bifrost.example.com
NAME=data-toolkit

mkdir -p "./plugins/$NAME/.claude-plugin"
curl -sS "$BASE/marketplace/claude/plugins/$NAME/.claude-plugin/plugin.json" \
  -o "./plugins/$NAME/.claude-plugin/plugin.json"

# 若 plugin.json 或 bundle 中还有 agents/commands 等，继续拉取：
curl -sS "$BASE/marketplace/claude/plugins/$NAME/agents/analyst.md" \
  -o "./plugins/$NAME/agents/analyst.md"
```

**Plugin（Codex）最小步骤**

```bash
mkdir -p "./plugins/$NAME/.codex-plugin"
curl -sS "$BASE/marketplace/codex/plugins/$NAME/.codex-plugin/plugin.json" \
  -o "./plugins/$NAME/.codex-plugin/plugin.json"
```

**私有目录**：上述 curl 需加 `-H "Authorization: Bearer $TOKEN"` 或 `--cookie "token=$TOKEN"`。

---

### 6.3 方式 C：批量 API 一次同步（自研客户端推荐）

私有目录或需要离线全量同步时，优先使用：

```bash
curl -sS "$BASE/api/marketplace/my/items" \
  -H "Authorization: Bearer $TOKEN" \
  | jq .
```

**本地落盘伪代码**

```typescript
for (const item of response.items) {
  const root = item.platform === "codex"
    ? `./codex/${item.item_type}s/${item.name}`
    : `./claude/${item.item_type}s/${item.name}`;

  if (item.item_type === "skill" && item.content?.skill_md) {
    writeFile(`${root}/SKILL.md`, item.content.skill_md);
  }

  if (item.item_type === "plugin" && item.content?.plugin_json) {
    const manifestDir = item.platform === "codex"
      ? `${root}/.codex-plugin`
      : `${root}/.claude-plugin`;
    writeFile(`${manifestDir}/plugin.json`, JSON.stringify(item.content.plugin_json, null, 2));
  }

  for (const [relPath, body] of Object.entries(item.content?.files ?? {})) {
    writeFile(`${root}/${relPath}`, body);
  }
}
```

---

## 7. 建议本地目录结构

与 Bifrost manifest `source` 路径保持一致，便于 CLI 直接复用：

```
{install_root}/
├── marketplace/                    # 可选：镜像 HTTP 路径
│   ├── claude/
│   │   ├── plugins/{name}/
│   │   │   ├── .claude-plugin/plugin.json
│   │   │   ├── agents/
│   │   │   └── commands/
│   │   └── skills/{name}/
│   │       └── SKILL.md
│   └── codex/
│       ├── plugins/{name}/
│       │   ├── .codex-plugin/plugin.json
│       │   └── .mcp.json
│       └── skills/{name}/
│           └── SKILL.md
```

**Claude Code 默认安装位置**（参考）：`~/.claude/plugins/`、`~/.claude/skills/`  
**Codex 默认安装位置**（参考）：`~/.codex/plugins/`、repo 级 `.agents/plugins/`

---

## 8. 完整对接时序（自研客户端）

```mermaid
sequenceDiagram
    participant Client
    participant Gateway as Bifrost Gateway

    alt 公开目录
        Client->>Gateway: GET /.claude-plugin/marketplace.json
    else 私有目录
        Client->>Gateway: GET /api/marketplace/my/manifest?platform=claude
        Note over Client,Gateway: Authorization: Bearer token
    end
    Gateway-->>Client: marketplace.json

    loop 每个条目
        Client->>Gateway: GET /marketplace/claude/plugins/{name}/.claude-plugin/plugin.json
        Gateway-->>Client: plugin.json
        Client->>Gateway: GET /marketplace/claude/plugins/{name}/{other files}
        Gateway-->>Client: file contents
        Client->>Client: 写入本地目录
    end
```

---

## 9. 错误码

| HTTP | 含义 |
|------|------|
| 200 | 成功 |
| 401 | 未登录 / Token 无效（私有目录） |
| 403 | 条目未分配给当前用户 |
| 404 | 条目不存在、已禁用或文件路径不存在 |

---

## 10. 管理端接口（非客户端必需）

以下接口供 **管理员** 在 Web UI / 自动化运维中使用，普通 CLI 客户端无需调用：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/marketplace/items` | 分页列表 |
| GET | `/api/marketplace/items/{id}` | 详情（含 content） |
| POST | `/api/marketplace/items/import` | 导入 ZIP / Git / 远程市场 |
| POST | `/api/marketplace/items/{id}/sync` | 从远程源重新同步 |
| GET/PUT | `/api/marketplace/config` | 市场元数据 |
| GET/PUT | `/api/marketplace/users/{user_id}/assignments` | 用户条目分配 |

---

## 11. 快速检查清单

- [ ] 确认 `{BASE}/.claude-plugin/marketplace.json` 可访问
- [ ] 确认 `{BASE}/.agents/plugins/marketplace.json` 可访问（Codex）
- [ ] 确认 `public_read` 与鉴权策略符合预期
- [ ] 用 `GET /marketplace/claude/skills/{name}/SKILL.md` 验证内容接口
- [ ] 私有模式下验证 `/api/marketplace/my/items` 返回分配条目
- [ ] Claude Code：`/plugin marketplace add {BASE}` 后能 list / install
- [ ] Codex：`codex plugin marketplace add {BASE}` 后能 list / install

---

## 12. 参考

- 内部设计概要：[`marketplace-design.md`](./marketplace-design.md)
- Claude Code Plugin Marketplaces：https://code.claude.com/docs/en/plugin-marketplaces
- Codex Plugin 构建：https://developers.openai.com/codex/plugins/build
