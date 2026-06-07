package handlers

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
)

func TestCollectGrayscaleModelsForUser(t *testing.T) {
	grayscaleOn := true
	providers := map[schemas.ModelProvider]configstore.ProviderConfig{
		schemas.Anthropic: {
			Keys: []schemas.Key{
				{
					ID:               "gray-anthropic",
					Name:             "gray-anthropic",
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
					Models:           []string{"claude-sonnet-4-5"},
				},
				{
					ID:     "open-anthropic",
					Name:   "open-anthropic",
					Models: []string{"claude-opus-4"},
				},
			},
		},
		schemas.OpenAI: {
			Keys: []schemas.Key{
				{
					ID:               "gray-openai",
					Name:             "gray-openai",
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
					Models:           []string{"gpt-5.2-codex"},
				},
			},
		},
	}

	got := collectGrayscaleModelsForUser(providers, nil, "user-a", "")
	if got.InjectionMode != "append" {
		t.Fatalf("expected append injection mode, got %q", got.InjectionMode)
	}
	if got.TotalBuiltin != 1 {
		t.Fatalf("expected 1 builtin model, got %d", got.TotalBuiltin)
	}
	if got.TotalAdditional != 3 {
		t.Fatalf("expected 3 additional grayscale models (claude + codex + opencode), got %d", got.TotalAdditional)
	}

	byID := make(map[string]GrayscalePlatformModels, len(got.Platforms))
	for _, platform := range got.Platforms {
		byID[platform.ID] = platform
	}

	claude := byID["claude"]
	if claude.InjectionMode != "append" {
		t.Fatalf("expected platform append mode, got %q", claude.InjectionMode)
	}
	if len(claude.Models) != 1 || claude.Models[0].ID != "claude-opus-4" || claude.Models[0].Source != "builtin" {
		t.Fatalf("unexpected claude builtin models: %#v", claude.Models)
	}
	if len(claude.AdditionalModels) != 1 || claude.AdditionalModels[0].ID != "claude-sonnet-4-5" || claude.AdditionalModels[0].Source != "grayscale" {
		t.Fatalf("unexpected claude additional models: %#v", claude.AdditionalModels)
	}

	codex := byID["codex"]
	if len(codex.Models) != 0 {
		t.Fatalf("expected no codex builtin models, got %#v", codex.Models)
	}
	if len(codex.AdditionalModels) != 1 || codex.AdditionalModels[0].ID != "gpt-5.2-codex" {
		t.Fatalf("unexpected codex additional models: %#v", codex.AdditionalModels)
	}

	filtered := collectGrayscaleModelsForUser(providers, nil, "user-b", "")
	if filtered.TotalAdditional != 0 {
		t.Fatalf("expected no additional models for non-allowlisted user, got %#v", filtered)
	}
	if filtered.TotalBuiltin != 1 {
		t.Fatalf("expected builtin models still visible, got %#v", filtered)
	}
}

func TestCollectGrayscaleModelsForUser_DedupesOverlapIntoBuiltin(t *testing.T) {
	grayscaleOn := true
	providers := map[schemas.ModelProvider]configstore.ProviderConfig{
		schemas.Anthropic: {
			Keys: []schemas.Key{
				{
					ID:               "gray-anthropic",
					Name:             "gray-anthropic",
					GrayscaleEnabled: &grayscaleOn,
					GrayscaleUsers:   []string{"user-a"},
					Models:           []string{"claude-sonnet-4-5"},
				},
				{
					ID:     "open-anthropic",
					Name:   "open-anthropic",
					Models: []string{"claude-sonnet-4-5"},
				},
			},
		},
	}

	got := collectGrayscaleModelsForUser(providers, nil, "user-a", "claude")
	if len(got.Platforms) != 1 {
		t.Fatalf("expected one platform, got %#v", got.Platforms)
	}
	platform := got.Platforms[0]
	if len(platform.Models) != 1 || platform.Models[0].Source != "builtin" {
		t.Fatalf("expected overlapping model in builtin only: %#v", platform.Models)
	}
	if len(platform.AdditionalModels) != 0 {
		t.Fatalf("expected no additional models when overlap exists: %#v", platform.AdditionalModels)
	}
}
