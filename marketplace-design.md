# Bifrost Agent Extensions — 统一 Skills & Plugins 管控设计

> Bifrost 作为 Claude Code / Codex 的「Agent 扩展控制平面」：集中配置 skills/plugins，按用户（VK）/团队/客户下发，统一安装、卸载、启用、禁用。分发采用 **per-VK git-backed marketplace**，两端通过各自原生 marketplace 机制消费同一个 Bifrost 源。

---

## 1. 背景与判断

### 1.1 客户端现状（2026-06 已核实）

Claude Code 与 Codex 已收敛到同构的扩展模型：

- 都有 `marketplace.json` + 插件清单 + 内嵌 skills/MCP + config 启停开关。
- 都有 `marketplace add` / `install` / `remove` / 启停 原生命令。
- 两端的 marketplace 源都接受 **git**（本地路径 / `owner/repo[@ref]` / HTTP(S) Git URL / SSH Git URL）。

| 维度 | Claude Code | Codex |
|---|---|---|
| marketplace 清单 | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` |
| 插件清单目录 | `.claude-plugin/` | `.codex-plugin/plugin.json`（仅此文件在内） |
| 安装/卸载 | `claude plugin install/uninstall` | `codex plugin add/remove` |
| marketplace 源 | github / git URL / 本地 | 本地 / github / HTTP(S) Git / SSH |
| 启停 | `/plugin` 面板 / settings | `config.toml` `[plugins."x@mkt"] enabled=false` |
| 缓存路径 | `~/.claude/plugins/cache/...` | `~/.codex/plugins/cache/$MKT/$PLUGIN/$VERSION/` |

### 1.2 为什么选 git

- 两端原生都支持 git 源 → **一个 per-VK git 仓库可同时喂 Claude + Codex**。
- `marketplace upgrade` / 启动 auto-update 可自动拉取新 commit，**更新无需用户重新下载**。
- git ref/commit 天然提供版本与回滚能力。
- 内容寻址：assignment 不变则 commit 不变，便于缓存与幂等。

### 1.3 设计目标与边界

**目标**：在 Bifrost 集中配置 skills/plugins，按 VK/团队/客户下发；统一安装、卸载、启用、禁用；两端零差异接入同一 git 源。

**Phase 1 非目标**：常驻强制对账、OS 级 MDM 强制（放 Phase 3 可选企业档）。

---

## 2. 概念统一：Extension

把 skill 与 plugin 统一抽象为 **Extension**，避免双份模型：

```
Extension
├── type: "plugin" | "skill"
├── plugin 可内嵌: skills[] + mcpServers[] + commands[] + hooks[]
└── skill 可独立存在，也可被 plugin 打包
```

一个 Extension 的能力落到三种载体（决定渲染/分发方式）：

| 载体 | 渲染目标 | 备注 |
|---|---|---|
| 文件型（SKILL.md / 脚本 / commands / hooks） | git 仓库内的插件目录 | 客户端落盘 |
| MCP-tool | 插件内 `.mcp.json` → 指向 Bifrost per-VK `/mcp` | 复用现有能力，不并入文件型框架 |
| app 集成 / 认证 | 清单 policy 字段 | 透传 |

---

## 3. 总体架构

```
┌─────────────────────── Bifrost 控制平面 ───────────────────────┐
│  ① Registry        extensions / versions / bundles（configstore）│
│  ② Policy          assignments：scope(global/customer/team/vk)   │
│                    × state(enabled/disabled/available)（复用 gov）│
│  ③ Renderer        Registry+Policy → per-VK marketplace git tree │
│                    （同仓双方言：.claude-plugin/ + .codex-plugin/）│
│  ④ Distribution    git smart-HTTP: /ext/{vk}.git（VK 鉴权）       │
│  ⑤ Control API     /api/extensions/*（CRUD / 版本 / 分配 / 预览） │
│  ⑥ UI              ui/app/workspace/extensions                   │
│  ⑦ Security        签名/校验和 + RBAC + 审计 + strict 源限制      │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ git + VK                        │ git + VK
                ▼                                 ▼
        Claude Code                          Codex
   marketplace add → install            marketplace add → add

       （Phase 2 可选）SessionStart hook / reconcile → 强制对账
```

---

## 4. 数据模型（configstore 新表，复用 file/postgres 双后端）

```sql
-- 扩展条目（registry）
extensions(
  id             uuid pk,
  slug           text unique,          -- "code-tools"
  name           text,
  type           text,                 -- plugin | skill
  description    text,
  publisher      text,
  latest_version text,
  trust_level    text,                 -- official | verified | community
  created_at, updated_at
)

-- 版本 + 产物
extension_versions(
  id            uuid pk,
  extension_id  uuid fk,
  version       text,                  -- semver
  manifest      jsonb,                 -- 中立清单（见 §5）
  bundle_ref    text,                  -- 对象存储 key / 内联 blob
  checksum      text,                  -- sha256
  signature     text,                  -- ed25519 / cosign
  created_at
)

-- 分配策略（启停/安装 = 这里的状态）
extension_assignments(
  id             uuid pk,
  extension_id   uuid fk,
  version_range  text,                 -- "^1.2.0" | "latest"
  scope_type     text,                 -- global | customer | team | vk
  scope_id       text,                 -- 对应 governance 实体 id（global 为空）
  state          text,                 -- enabled | disabled | available
  install_policy text,                 -- auto | available（auto 仅 enforce 阶段用）
  created_by, created_at
)
```

**解析优先级**（与 governance 一致）：`global < customer < team < vk`，逐级合并集合；**任意层 `disabled` 覆盖上层 `enabled`**（安全默认）。解析逻辑复用 governance 中 VK→team→customer resolver 套路。

---

## 5. 中立清单 → 双方言渲染

Registry 存**一份中立 manifest**，Renderer 翻译成两端方言。

中立清单示例：

```json
{
  "slug": "code-tools",
  "name": "Code Tools",
  "version": "1.2.0",
  "skills":   [{ "name": "refactor", "path": "skills/refactor/SKILL.md" }],
  "commands": [{ "name": "review",   "path": "commands/review.md" }],
  "hooks":    [{ "event": "SessionStart", "path": "hooks/start.sh" }],
  "mcp":      { "bifrostManaged": true },   // 渲染时填入 per-VK /mcp
  "assets":   ["assets/icon.svg"]
}
```

Renderer 产出的 **per-VK git 仓库布局**（同仓满足两端）：

```
/                                       # /ext/{vk}.git 的 HEAD
├── .claude-plugin/marketplace.json     # Claude 读这个
├── .agents/plugins/marketplace.json    # Codex 读这个
└── plugins/code-tools/
    ├── .claude-plugin/plugin.json      # Claude 清单
    ├── .codex-plugin/plugin.json       # Codex 清单（仅此文件在 .codex-plugin/）
    ├── skills/refactor/SKILL.md
    ├── commands/review.md
    ├── hooks/start.sh
    ├── .mcp.json                        # 指向 Bifrost per-VK /mcp（带 vk）
    └── assets/icon.svg
```

Codex `marketplace.json` 片段：

```json
{
  "name": "bifrost",
  "interface": { "displayName": "Bifrost Extensions" },
  "plugins": [{
    "name": "code-tools",
    "source": { "source": "local", "path": "./plugins/code-tools" },
    "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
    "category": "Productivity"
  }]
}
```

Claude `marketplace.json` 片段：

```json
{
  "name": "bifrost",
  "owner": { "name": "Bifrost" },
  "plugins": [{
    "name": "code-tools",
    "source": "./plugins/code-tools",
    "version": "1.2.0",
    "description": "Code Tools"
  }]
}
```

插件内 `.mcp.json`（让 MCP-tool 类随插件落地，零额外配置）：

```json
{
  "mcpServers": {
    "bifrost": {
      "type": "http",
      "url": "https://<bifrost-host>/mcp",
      "headers": { "x-bf-vk": "<VK>" }
    }
  }
}
```

> 实现期需对照两端当前 schema 校验字段名；若同仓互相干扰，退化为「同一 git 两个 ref / 两个子路径（Codex `--sparse`）」，对接入命令无影响。

---

## 6. 分发：per-VK git smart-HTTP

新增路由：

```
GET/POST  /ext/{vk}.git/info/refs?service=git-upload-pack
POST      /ext/{vk}.git/git-upload-pack
```

- **鉴权**：URL 内 VK 或 `Authorization` 头；走现有中间件链 + governance 校验 VK 有效性。
- **生成策略**：按 VK 解析 assignment → Renderer 产出 tree → 提交一个 commit（内容寻址，assignment 不变则 commit 不变）。变更时 bump，触发客户端 `upgrade` 拉新。
- **实现选型**：
  - 首选 `go-git` 内存仓库直接服务 upload-pack（纯 Go，无外部依赖）。
  - 兜底用子进程封装 `git http-backend`。
- **缓存**：渲染结果 + packfile 按 (vk, assignment-hash) 缓存，避免每次请求重建。

客户端接入（两端对称，纯原生）：

```bash
# Claude
claude plugin marketplace add https://<bifrost>/ext/<vk>.git
claude plugin install code-tools@bifrost      # 卸载: claude plugin uninstall

# Codex
codex plugin marketplace add https://<bifrost>/ext/<vk>.git
codex plugin add code-tools@bifrost            # 卸载: codex plugin remove
```

**更新**：`codex plugin marketplace upgrade` / Claude 启动 auto-update 自动拉新 commit。

**启停**（保持安装、临时关闭）：
- Codex：`~/.codex/config.toml` → `[plugins."code-tools@bifrost"] enabled = false`
- Claude：`/plugin` 面板 toggle

---

## 7. 控制面 REST API

新 handler `transports/bifrost-http/handlers/extensions.go`，遵循现有 struct + `RegisterRoutes` 模式：

| Method | Path | 作用 |
|---|---|---|
| GET / POST | `/api/extensions` | registry 列表 / 新建 |
| GET / PUT / DELETE | `/api/extensions/{id}` | 详情 / 更新 / 删除 |
| POST | `/api/extensions/{id}/versions` | 上传版本 + bundle（带签名/校验） |
| GET / POST | `/api/extensions/assignments` | 分配列表 / 创建（启停/安装策略） |
| PATCH | `/api/extensions/assignments/{id}` | 改 state（enable/disable） |
| GET | `/api/extensions/marketplace/{vk}/preview` | 预览渲染结果（调试） |
| (git) | `/ext/{vk}.git/*` | §6 分发 |

handler 依赖注入：`configstore`、governance resolver、Renderer、bundle store；路由用 `lib.ChainMiddlewares` 挂鉴权/审计中间件。

`transports/config.schema.json` 增配：功能开关、bundle 存储后端、签名公私钥、`base_marketplace_url`、是否强制 `strictKnownMarketplaces`。

---

## 8. UI：`ui/app/workspace/extensions/`

遵循现有 workspace 约定（TanStack Router、RTK Query、`data-testid`）：

- **Registry 页**：扩展列表、类型/信任级、版本管理、bundle 上传。
- **Assignment 矩阵**：扩展 × scope（global/customer/team/vk）网格，单元格切换 `enabled/disabled/available` —— 这就是用户感知的「统一启停/装卸」。
- **Per-VK 预览**：渲染出的 marketplace + 一键复制 `marketplace add` 命令。
- 交互元素加 `data-testid="extension-<...>"`，配套 E2E。

---

## 9. 安全模型

- **bundle 签名 + sha256**：客户端侧校验；未签名拒装。
- **RBAC**：复用 governance —— 谁能 publish、谁能 assign、scope 边界。
- **源锁定**：客户端 managed-settings 配 `strictKnownMarketplaces` 仅允许 Bifrost 源，防止旁路装第三方插件。
- **审计**：publish / assign / 启停 写审计（复用 logging）；skills 在客户端执行脚本，publish 走审批流。
- **信任分级**：official / verified / community 在 UI 显式标注，可按 scope 限制 community 可用性。

---

## 10. 与现有运行时的关系（解耦）

- **MCP-tool 维度**：仍由现有 per-VK `/mcp`（`vkMCPServers` / `SyncAllMCPServers`）提供，插件 `.mcp.json` 只是把它「带进」客户端。**不要把协议工具塞进文件型扩展框架。**
- **本设计只新增「文件型扩展的中心化分发与管控」**，不改推理热路径。

---

## 11. 落地分期

| 阶段 | 交付 | 价值 |
|---|---|---|
| **P1** | Registry 数据模型 + Assignment 解析 + 双方言 Renderer + per-VK git smart-HTTP + UI 矩阵 + 两端原生命令接入 | 端到端可用：集中配置 → 两端装卸启停 + 自动更新 |
| **P2（可选/企业）** | reconcile / SessionStart hook + managed-settings 集成 + 防漂移/强制 | 合规级强管控（配 OS MDM 才「真强制」） |

P1 的数据模型与端点，P2 完全复用、不返工。

---

## 12. 主要风险

| 风险 | 缓解 |
|---|---|
| 两端 marketplace schema 仍在演进 | Renderer 做版本探测 + 契约测试；同仓双方言冲突走双 ref 兜底 |
| git smart-HTTP 在 Go 内实现成本 | 先用 `git http-backend` 子进程兜底，后续换 `go-git` 纯内存 |
| skills 客户端执行脚本 = 中心化攻击面 | 签名 + RBAC + 审批 + strict 源（硬性前置） |
| P1 无强制力，用户可手动卸 | 要强制需上 P2 + OS MDM |
| per-VK 仓库数量膨胀 | 内容寻址缓存 + 按 assignment-hash 复用 packfile |

---

## 13. 实施起点建议

P1 第一步搭地基：**Registry 数据模型（configstore 表 + migration）+ Assignment 解析器 + 双方言 Renderer**，连同单测。其余（git 端点、控制 API、UI）在此之上叠加。

---

## 附：客户端命令速查

```bash
# ── 接入（一次） ──
claude plugin marketplace add https://<bifrost>/ext/<vk>.git
codex  plugin marketplace add https://<bifrost>/ext/<vk>.git

# ── 安装 ──
claude plugin install code-tools@bifrost
codex  plugin add     code-tools@bifrost

# ── 卸载 ──
claude plugin uninstall code-tools@bifrost
codex  plugin remove    code-tools@bifrost

# ── 启停（保持安装） ──
# Claude: /plugin 面板 toggle
# Codex : ~/.codex/config.toml → [plugins."code-tools@bifrost"] enabled = false

# ── 更新 ──
codex plugin marketplace upgrade        # Claude 启动时 auto-update
```
