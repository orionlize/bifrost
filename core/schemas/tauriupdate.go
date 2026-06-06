package schemas

// TauriUpdatePlatform holds per-platform installer metadata for the Tauri updater.
type TauriUpdatePlatform struct {
	URL       string `json:"url"`
	Signature string `json:"signature"`
}

// TauriUpdateConfig is persisted in client metadata under key "tauri_update".
type TauriUpdateConfig struct {
	Version   string                         `json:"version"`
	Notes     string                         `json:"notes,omitempty"`
	PubDate   string                         `json:"pub_date,omitempty"`
	Platforms map[string]TauriUpdatePlatform `json:"platforms,omitempty"`
}

// TauriUpdateResponse is returned to Tauri updater clients.
type TauriUpdateResponse struct {
	Version   string                         `json:"version"`
	Notes     string                         `json:"notes,omitempty"`
	PubDate   string                         `json:"pub_date"`
	Platforms map[string]TauriUpdatePlatform `json:"platforms"`
}
