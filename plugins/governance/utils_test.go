package governance

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
)

func TestParseGlobalAPIKeyBearerToken(t *testing.T) {
	req := schemas.AcquireHTTPRequest()
	defer schemas.ReleaseHTTPRequest(req)

	req.Headers["Authorization"] = "Bearer "+configstore.GlobalAPIKeyPrefix+"abcd"
	if got := parseGlobalAPIKeyBearerToken(req); got != configstore.GlobalAPIKeyPrefix+"abcd" {
		t.Fatalf("token = %q, want %q", got, configstore.GlobalAPIKeyPrefix+"abcd")
	}

	req.Headers["Authorization"] = "Bearer sk-bf-vk"
	if got := parseGlobalAPIKeyBearerToken(req); got != "" {
		t.Fatalf("virtual key token = %q, want empty", got)
	}
}
