package schemas

import (
	"testing"
)

func TestModelsMatchForKeyAllowlist(t *testing.T) {
	tests := []struct {
		allowed string
		model   string
		want    bool
	}{
		{"claude-mythos-preview", "claude-mythos-preview-fast", true},
		{"claude-mythos-preview", "claude-mythos-preview", true},
		{"gpt-4o", "gpt-4o-mini", false},
		{"*", "anything", true},
	}
	for _, tt := range tests {
		if got := ModelsMatchForKeyAllowlist(tt.allowed, tt.model); got != tt.want {
			t.Errorf("ModelsMatchForKeyAllowlist(%q, %q) = %v, want %v", tt.allowed, tt.model, got, tt.want)
		}
	}
}

func TestKeyAllowsModel(t *testing.T) {
	key := Key{
		Value:  *NewEnvVar("sk-test"),
		Models: []string{"claude-mythos-preview"},
	}
	if !key.AllowsModel("claude-mythos-preview-fast") {
		t.Fatal("expected variant model to be allowed via prefix match")
	}
	if key.AllowsModel("claude-sonnet-4-6") {
		t.Fatal("expected unrelated model to be denied")
	}

	wildcard := Key{Value: *NewEnvVar("sk-test"), Models: []string{"*"}}
	if !wildcard.AllowsModel("claude-mythos-preview-fast") {
		t.Fatal("expected wildcard key to allow any model")
	}

	denyAll := Key{Value: *NewEnvVar("sk-test")}
	if denyAll.AllowsModel("claude-mythos-preview") {
		t.Fatal("expected empty models list to deny by default")
	}
}
