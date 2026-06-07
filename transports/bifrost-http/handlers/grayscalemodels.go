package handlers

import (
	"sort"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/maximhq/bifrost/framework/modelcatalog"
)

const zwitchModelInjectionModeAppend = "append"

// zwitchClientPlatform describes a desktop coding-assistant platform that can
// consume Bifrost grayscale models as custom model entries.
type zwitchClientPlatform struct {
	ID       string
	Label    string
	BasePath string
}

var zwitchClientPlatforms = []zwitchClientPlatform{
	{ID: "claude", Label: "Claude Code", BasePath: "/anthropic"},
	{ID: "codex", Label: "Codex CLI", BasePath: "/openai"},
	{ID: "gemini", Label: "Gemini CLI", BasePath: "/genai"},
	{ID: "opencode", Label: "Opencode", BasePath: "/openai"},
}

// GrayscaleModelEntry is a model entry for client-side model picker injection.
type GrayscaleModelEntry struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	KeyID    string `json:"key_id,omitempty"`
	KeyName  string `json:"key_name,omitempty"`
	// Source is "builtin" for regular provider keys or "grayscale" for grayscale-only extras.
	Source string `json:"source"`
}

// GrayscalePlatformModels groups models for one client platform.
// Clients should keep models and append additional_models (injection_mode=append).
type GrayscalePlatformModels struct {
	ID               string                `json:"id"`
	Label            string                `json:"label"`
	BasePath         string                `json:"base_path"`
	InjectionMode    string                `json:"injection_mode"`
	Models           []GrayscaleModelEntry `json:"models"`
	AdditionalModels []GrayscaleModelEntry `json:"additional_models"`
}

// ListGrayscaleModelsResponse is returned by GET /api/aone/zwitch/grayscale-models.
type ListGrayscaleModelsResponse struct {
	InjectionMode  string                    `json:"injection_mode"`
	Platforms      []GrayscalePlatformModels `json:"platforms"`
	Total          int                       `json:"total"`
	TotalBuiltin   int                       `json:"total_builtin"`
	TotalAdditional int                      `json:"total_additional"`
}

func platformIDsForBaseProvider(baseProvider schemas.ModelProvider) []string {
	switch baseProvider {
	case schemas.Anthropic:
		return []string{"claude"}
	case schemas.OpenAI:
		return []string{"codex", "opencode"}
	case schemas.Gemini:
		return []string{"gemini"}
	default:
		return nil
	}
}

func baseProviderForConfig(provider schemas.ModelProvider, config configstore.ProviderConfig) schemas.ModelProvider {
	if config.CustomProviderConfig != nil && config.CustomProviderConfig.BaseProviderType != "" {
		return config.CustomProviderConfig.BaseProviderType
	}
	return provider
}

func expandKeyModels(
	key schemas.Key,
	provider schemas.ModelProvider,
	catalog *modelcatalog.ModelCatalog,
) []string {
	if key.BlacklistedModels.IsBlockAll() {
		return nil
	}

	var candidates []string
	switch {
	case key.Models.IsUnrestricted():
		if catalog != nil {
			candidates = catalog.GetUnfilteredModelsForProvider(provider)
		}
	case len(key.Models) == 0:
		return nil
	default:
		candidates = append([]string(nil), key.Models...)
	}

	filtered := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, model := range candidates {
		model = strings.TrimSpace(model)
		if model == "" || model == "*" {
			continue
		}
		if key.BlacklistedModels.IsBlocked(model) {
			continue
		}
		if _, ok := seen[model]; ok {
			continue
		}
		seen[model] = struct{}{}
		filtered = append(filtered, model)
	}
	sort.Strings(filtered)
	return filtered
}

type platformModelBuckets struct {
	builtin    map[string]GrayscaleModelEntry
	additional map[string]GrayscaleModelEntry
}

func newPlatformModelBuckets() *platformModelBuckets {
	return &platformModelBuckets{
		builtin:    make(map[string]GrayscaleModelEntry),
		additional: make(map[string]GrayscaleModelEntry),
	}
}

func sortModelEntries(entries []GrayscaleModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].ID == entries[j].ID {
			return entries[i].Provider < entries[j].Provider
		}
		return entries[i].ID < entries[j].ID
	})
}

func mapValues(entries map[string]GrayscaleModelEntry) []GrayscaleModelEntry {
	result := make([]GrayscaleModelEntry, 0, len(entries))
	for _, entry := range entries {
		result = append(result, entry)
	}
	sortModelEntries(result)
	return result
}

func collectGrayscaleModelsForUser(
	providers map[schemas.ModelProvider]configstore.ProviderConfig,
	catalog *modelcatalog.ModelCatalog,
	aoneUserID string,
	platformFilter string,
) ListGrayscaleModelsResponse {
	platformFilter = strings.ToLower(strings.TrimSpace(platformFilter))
	platformBuckets := make(map[string]*platformModelBuckets, len(zwitchClientPlatforms))
	platformOrder := make([]string, 0, len(zwitchClientPlatforms))
	platformMeta := make(map[string]zwitchClientPlatform, len(zwitchClientPlatforms))
	for _, def := range zwitchClientPlatforms {
		if platformFilter != "" && def.ID != platformFilter {
			continue
		}
		platformOrder = append(platformOrder, def.ID)
		platformMeta[def.ID] = def
		platformBuckets[def.ID] = newPlatformModelBuckets()
	}

	providerNames := make([]string, 0, len(providers))
	for provider := range providers {
		providerNames = append(providerNames, string(provider))
	}
	sort.Strings(providerNames)

	for _, providerName := range providerNames {
		provider := schemas.ModelProvider(providerName)
		config := providers[provider]
		baseProvider := baseProviderForConfig(provider, config)
		platformIDs := platformIDsForBaseProvider(baseProvider)
		if len(platformIDs) == 0 {
			continue
		}

		for _, key := range config.Keys {
			if key.Enabled != nil && !*key.Enabled {
				continue
			}

			isGrayscale := key.IsGrayscaleEnabled()
			if isGrayscale && !key.IsAccessibleByUser(aoneUserID) {
				continue
			}
			if isGrayscale {
				continue // grayscale keys are handled in the second pass
			}

			for _, modelID := range expandKeyModels(key, provider, catalog) {
				entry := GrayscaleModelEntry{
					ID:       modelID,
					Provider: string(provider),
					KeyID:    key.ID,
					KeyName:  key.Name,
					Source:   "builtin",
				}
				for _, platformID := range platformIDs {
					buckets := platformBuckets[platformID]
					if buckets == nil {
						continue
					}
					buckets.builtin[modelID] = entry
					delete(buckets.additional, modelID)
				}
			}
		}
	}

	for _, providerName := range providerNames {
		provider := schemas.ModelProvider(providerName)
		config := providers[provider]
		baseProvider := baseProviderForConfig(provider, config)
		platformIDs := platformIDsForBaseProvider(baseProvider)
		if len(platformIDs) == 0 {
			continue
		}

		for _, key := range config.Keys {
			if key.Enabled != nil && !*key.Enabled {
				continue
			}
			if !key.IsGrayscaleEnabled() || !key.IsAccessibleByUser(aoneUserID) {
				continue
			}

			for _, modelID := range expandKeyModels(key, provider, catalog) {
				entry := GrayscaleModelEntry{
					ID:       modelID,
					Provider: string(provider),
					KeyID:    key.ID,
					KeyName:  key.Name,
					Source:   "grayscale",
				}
				for _, platformID := range platformIDs {
					buckets := platformBuckets[platformID]
					if buckets == nil {
						continue
					}
					if _, exists := buckets.builtin[modelID]; exists {
						continue
					}
					buckets.additional[modelID] = entry
				}
			}
		}
	}

	result := make([]GrayscalePlatformModels, 0, len(platformOrder))
	totalBuiltin := 0
	totalAdditional := 0
	for _, platformID := range platformOrder {
		buckets := platformBuckets[platformID]
		meta := platformMeta[platformID]
		if buckets == nil {
			continue
		}
		builtin := mapValues(buckets.builtin)
		additional := mapValues(buckets.additional)
		totalBuiltin += len(builtin)
		totalAdditional += len(additional)
		result = append(result, GrayscalePlatformModels{
			ID:               meta.ID,
			Label:            meta.Label,
			BasePath:         meta.BasePath,
			InjectionMode:    zwitchModelInjectionModeAppend,
			Models:           builtin,
			AdditionalModels: additional,
		})
	}

	return ListGrayscaleModelsResponse{
		InjectionMode:   zwitchModelInjectionModeAppend,
		Platforms:       result,
		Total:           totalBuiltin + totalAdditional,
		TotalBuiltin:    totalBuiltin,
		TotalAdditional: totalAdditional,
	}
}
