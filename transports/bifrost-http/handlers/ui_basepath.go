package handlers

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/maximhq/bifrost/transports/bifrost-http/lib"
)

const bifrostRuntimeBasePathScriptID = `id="bifrost-runtime-base-path"`

func injectRuntimeBasePath(html []byte, basePath string) []byte {
	basePath = lib.NormalizeBasePath(basePath)
	if basePath == "" {
		return html
	}

	s := string(html)
	if strings.Contains(s, bifrostRuntimeBasePathScriptID) {
		return html
	}

	quoted, err := json.Marshal(basePath)
	if err != nil {
		return html
	}
	inject := `<script ` + bifrostRuntimeBasePathScriptID + `>window.__BIFROST_BASE_PATH__=` + string(quoted) + `;</script>`

	if idx := strings.Index(s, "</head>"); idx >= 0 {
		var out bytes.Buffer
		out.Grow(len(s) + len(inject))
		out.WriteString(s[:idx])
		out.WriteString(inject)
		out.WriteString(s[idx:])
		s = out.String()
	} else {
		s = inject + s
	}

	// Images built at site root use /assets/...; rewrite when served under a subpath.
	if !strings.Contains(s, basePath+"/assets/") {
		s = strings.ReplaceAll(s, `src="/assets/`, `src="`+basePath+`/assets/`)
		s = strings.ReplaceAll(s, `href="/assets/`, `href="`+basePath+`/assets/`)
	}

	return []byte(s)
}
