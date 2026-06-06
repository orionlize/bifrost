package configstore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

const tauriUpdateMetadataKey = "tauri_update"

// GetTauriUpdateConfig returns Tauri desktop updater metadata from client config.
func (s *RDBConfigStore) GetTauriUpdateConfig(ctx context.Context) (*schemas.TauriUpdateConfig, error) {
	metadata, err := s.GetClientMetadata(ctx)
	if err != nil {
		return nil, err
	}
	if metadata == nil {
		return defaultTauriUpdateConfig(), nil
	}
	raw, ok := metadata[tauriUpdateMetadataKey]
	if !ok || raw == nil {
		return defaultTauriUpdateConfig(), nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var cfg schemas.TauriUpdateConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse tauri update config: %w", err)
	}
	normalizeTauriUpdateConfig(&cfg)
	return &cfg, nil
}

// UpdateTauriUpdateConfig persists Tauri updater metadata into client config.
func (s *RDBConfigStore) UpdateTauriUpdateConfig(ctx context.Context, cfg *schemas.TauriUpdateConfig) error {
	if cfg == nil {
		return fmt.Errorf("tauri update config is nil")
	}
	normalizeTauriUpdateConfig(cfg)
	data, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal tauri update config: %w", err)
	}
	var asMap map[string]any
	if err := json.Unmarshal(data, &asMap); err != nil {
		return fmt.Errorf("decode tauri update config map: %w", err)
	}
	patch := map[string]any{tauriUpdateMetadataKey: asMap}
	return s.UpdateClientMetadata(ctx, patch)
}

func defaultTauriUpdateConfig() *schemas.TauriUpdateConfig {
	return &schemas.TauriUpdateConfig{
		Platforms: map[string]schemas.TauriUpdatePlatform{},
	}
}

func normalizeTauriUpdateConfig(cfg *schemas.TauriUpdateConfig) {
	if cfg == nil {
		return
	}
	cfg.Version = strings.TrimSpace(cfg.Version)
	cfg.Notes = strings.TrimSpace(cfg.Notes)
	cfg.PubDate = strings.TrimSpace(cfg.PubDate)
	if cfg.Platforms == nil {
		cfg.Platforms = map[string]schemas.TauriUpdatePlatform{}
	}
	for key, platform := range cfg.Platforms {
		platform.URL = strings.TrimSpace(platform.URL)
		platform.Signature = strings.TrimSpace(platform.Signature)
		if platform.URL == "" && platform.Signature == "" {
			delete(cfg.Platforms, key)
			continue
		}
		cfg.Platforms[key] = platform
	}
}

// BuildTauriUpdateResponse returns a Tauri-compatible update payload when an update
// is available for the requested platform; otherwise ok is false.
func BuildTauriUpdateResponse(cfg *schemas.TauriUpdateConfig, target, arch, currentVersion string) (*schemas.TauriUpdateResponse, bool) {
	if cfg == nil || cfg.Version == "" {
		return nil, false
	}
	if !versionLess(currentVersion, cfg.Version) {
		return nil, false
	}
	platformKey := tauriPlatformKey(target, arch)
	platform, ok := cfg.Platforms[platformKey]
	if !ok || platform.URL == "" || platform.Signature == "" {
		return nil, false
	}
	pubDate := cfg.PubDate
	if pubDate == "" {
		pubDate = time.Now().UTC().Format(time.RFC3339)
	}
	return &schemas.TauriUpdateResponse{
		Version: cfg.Version,
		Notes:   cfg.Notes,
		PubDate: pubDate,
		Platforms: map[string]schemas.TauriUpdatePlatform{
			platformKey: platform,
		},
	}, true
}

func tauriPlatformKey(target, arch string) string {
	target = strings.ToLower(strings.TrimSpace(target))
	arch = strings.ToLower(strings.TrimSpace(arch))
	if target == "" || arch == "" {
		return ""
	}
	return target + "-" + arch
}

func versionLess(current, latest string) bool {
	return compareVersions(current, latest) < 0
}

func compareVersions(a, b string) int {
	aParts := parseVersionParts(a)
	bParts := parseVersionParts(b)
	maxLen := len(aParts)
	if len(bParts) > maxLen {
		maxLen = len(bParts)
	}
	for i := 0; i < maxLen; i++ {
		aVal := 0
		bVal := 0
		if i < len(aParts) {
			aVal = aParts[i]
		}
		if i < len(bParts) {
			bVal = bParts[i]
		}
		if aVal < bVal {
			return -1
		}
		if aVal > bVal {
			return 1
		}
	}
	return 0
}

func parseVersionParts(raw string) []int {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "v")
	if raw == "" {
		return []int{0}
	}
	segments := strings.Split(raw, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			parts = append(parts, 0)
			continue
		}
		digits := strings.Builder{}
		for _, r := range segment {
			if r >= '0' && r <= '9' {
				digits.WriteRune(r)
			} else {
				break
			}
		}
		if digits.Len() == 0 {
			parts = append(parts, 0)
			continue
		}
		value := 0
		for _, r := range digits.String() {
			value = value*10 + int(r-'0')
		}
		parts = append(parts, value)
	}
	return parts
}
