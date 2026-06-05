# Unified Marketplace Design

Bifrost provides a unified marketplace for **skills** and **plugins** (Claude Code compatible bundles). Admins curate catalog entries, assign them to Aone users, and expose a marketplace source that CLI clients can pull from.

## Goals

1. **Unified catalog** — skills and plugins live in one `marketplace_items` table.
2. **Per-user assignment** — admins assign catalog entries to Aone OAuth users.
3. **Marketplace source** — serve Claude Code compatible `marketplace.json` and item content over HTTP.

## Data Model

### `marketplace_items`

| Column | Type | Description |
| --- | --- | --- |
| `id` | uint | Primary key |
| `name` | string | Unique item name |
| `item_type` | `skill` \| `plugin` | Item kind |
| `description` | text | Human-readable summary |
| `version` | string | Semantic version |
| `source` | string | Relative path in manifest (e.g. `./marketplace/plugins/data-toolkit`) |
| `enabled` | bool | Whether item appears in public catalog |
| `category` | string | Optional grouping label |
| `tags_json` | text | JSON array of tags |
| `content_json` | text | JSON bundle (SKILL.md, plugin.json, agents/commands/skills files) |

### `marketplace_user_assignments`

| Column | Type | Description |
| --- | --- | --- |
| `aone_user_id` | string | Aone user ID |
| `item_id` | uint | FK to `marketplace_items` |
| `assigned_at` | timestamp | Assignment time |

Unique index on `(aone_user_id, item_id)`.

### Marketplace config (client metadata key: `marketplace`)

```json
{
  "name": "bifrost-marketplace",
  "owner": { "name": "Bifrost", "email": "admin@example.com" },
  "public_read": true
}
```

When `public_read` is `false`, unauthenticated manifest/content requests require the caller to be assigned the item (or be a local admin).

## API

### Admin — catalog

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/marketplace/items` | List items (paginated) |
| POST | `/api/marketplace/items` | Create item |
| GET | `/api/marketplace/items/{id}` | Get item |
| PUT | `/api/marketplace/items/{id}` | Update item |
| DELETE | `/api/marketplace/items/{id}` | Delete item |
| GET | `/api/marketplace/config` | Get marketplace metadata |
| PUT | `/api/marketplace/config` | Update marketplace metadata |

### Admin — user assignment

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/marketplace/users/{user_id}/assignments` | List user assignments |
| PUT | `/api/marketplace/users/{user_id}/assignments` | Replace all assignments |
| POST | `/api/marketplace/users/{user_id}/assignments` | Add assignments |
| DELETE | `/api/marketplace/users/{user_id}/assignments/{item_id}` | Remove one assignment |

### Client — marketplace source

| Method | Path | Description |
| --- | --- | --- |
| GET | `/.claude-plugin/marketplace.json` | Claude Code compatible manifest |
| GET | `/api/marketplace/manifest` | Same manifest via API |
| GET | `/api/marketplace/my/manifest` | Current user's assigned manifest |
| GET | `/api/marketplace/my/items` | Current user's assigned items (with content) |
| GET | `/marketplace/{plugins\|skills}/{name}/*` | Serve item files (SKILL.md, plugin.json, etc.) |

## Manifest format

Compatible with [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces):

```json
{
  "name": "bifrost-marketplace",
  "owner": { "name": "Bifrost", "email": "admin@example.com" },
  "plugins": [
    {
      "name": "data-toolkit",
      "source": "./marketplace/plugins/data-toolkit",
      "description": "Data engineering plugin",
      "version": "1.0.0"
    }
  ]
}
```

Standalone skills appear in the same `plugins` array; their `source` points to `./marketplace/skills/{name}`.

## Content bundle (`content_json`)

```json
{
  "plugin_json": { "name": "data-toolkit", "description": "...", "version": "1.0.0" },
  "skill_md": "---\nname: docs-skill\n---\n...",
  "files": {
    "agents/data-engineer.md": "# Agent prompt",
    "skills/sql/SKILL.md": "---\nname: sql\n---\n..."
  }
}
```

## Client usage

```bash
# Add Bifrost as a marketplace source (within Claude Code)
/plugin marketplace add https://your-gateway

# Install a plugin from the catalog
/plugin install data-toolkit@bifrost-marketplace
```

For private deployments (`public_read: false`), authenticate with a dashboard session token or device credential (`bf-tmp-...`) when fetching `/api/marketplace/my/manifest`.
