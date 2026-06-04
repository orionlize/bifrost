package semanticcache

import (
	"github.com/bytedance/sonic"
)

// MarshalConfigForStorage implements schemas.ConfigMarshallerPlugin.
func (plugin *Plugin) MarshalConfigForStorage(raw map[string]any) (map[string]any, error) {
	b, err := sonic.Marshal(raw)
	if err != nil {
		return raw, err
	}
	var c Config
	if err := sonic.Unmarshal(b, &c); err != nil {
		return raw, err
	}
	normalized, err := c.MarshalForStorage()
	if err != nil {
		return raw, err
	}
	var out map[string]any
	if err := sonic.Unmarshal(normalized, &out); err != nil {
		return raw, err
	}
	return out, nil
}

// RedactConfig implements schemas.ConfigMarshallerPlugin.
func (plugin *Plugin) RedactConfig(raw map[string]any) (map[string]any, error) {
	b, err := sonic.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := sonic.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	out, err := sonic.Marshal(c.Redacted())
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := sonic.Unmarshal(out, &result); err != nil {
		return nil, err
	}
	return result, nil
}
