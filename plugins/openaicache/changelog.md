# Changelog

## 0.1.0

- Initial release. Reduces the cost of long-lived OpenAI/Azure sessions whose
  prompt cache expires while idle by injecting `prompt_cache_retention` (default
  `"24h"`) when the request sets none, extending the cache window from the
  default ~5-10 minutes. Also derives and injects a stable `prompt_cache_key`
  from the request's stable prefix (system/developer messages + first user
  message) when absent, improving cache-hit routing across turns of the same
  conversation. Lossless — never mutates conversation content. Applies to Chat
  Completions and the Responses API. Includes a ZDR-safe toggle to disable
  retention injection for zero-data-retention organizations.
