package marketplace

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// CatalogPreset is a well-known Claude Code or Codex compatible marketplace.
type CatalogPreset struct {
	ID          string                      `json:"id"`
	Label       string                      `json:"label"`
	Description string                      `json:"description"`
	URL         string                      `json:"url"`
	Platform    schemas.MarketplacePlatform `json:"platform,omitempty"`
	Official    bool                        `json:"official,omitempty"`
}

// RemoteCatalogPlugin is a plugin entry from a remote marketplace manifest.
type RemoteCatalogPlugin struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Version     string `json:"version,omitempty"`
	Category    string `json:"category,omitempty"`
}

// RemoteCatalog is a fetched Claude Code compatible marketplace manifest.
type RemoteCatalog struct {
	Name        string                `json:"name"`
	Description string                `json:"description,omitempty"`
	ManifestURL string                `json:"manifest_url"`
	OwnerName   string                `json:"owner_name,omitempty"`
	Plugins     []RemoteCatalogPlugin `json:"plugins"`

	repo *marketplaceRepoContext
}

var knownMarketplaceManifestURLs = map[string]string{
	"anthropics/claude-plugins-official": "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
	"claude-plugins-official":            "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
	"hashgraph-online/awesome-codex-plugins": "https://raw.githubusercontent.com/hashgraph-online/awesome-codex-plugins/main/.agents/plugins/marketplace.json",
	"awesome-codex-plugins":                  "https://raw.githubusercontent.com/hashgraph-online/awesome-codex-plugins/main/.agents/plugins/marketplace.json",
}

var rawGitHubManifestPattern = regexp.MustCompile(`^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/`)

// CatalogPresets returns built-in marketplace shortcuts for the UI.
func CatalogPresets() []CatalogPreset {
	return []CatalogPreset{
		{
			ID:          "anthropics/claude-plugins-official",
			Label:       "Anthropic Official",
			Description: "Official Anthropic Claude Code plugin marketplace",
			URL:         knownMarketplaceManifestURLs["anthropics/claude-plugins-official"],
			Platform:    schemas.MarketplacePlatformClaude,
			Official:    true,
		},
		{
			ID:          "hashgraph-online/awesome-codex-plugins",
			Label:       "Awesome Codex Plugins",
			Description: "Curated Codex plugin directory with OpenAI partner plugins and community entries",
			URL:         knownMarketplaceManifestURLs["hashgraph-online/awesome-codex-plugins"],
			Platform:    schemas.MarketplacePlatformCodex,
			Official:    true,
		},
	}
}

// InferCatalogSourcePlatform guesses the target platform from a manifest URL.
func InferCatalogSourcePlatform(rawURL string) schemas.MarketplacePlatform {
	lower := strings.ToLower(strings.TrimSpace(rawURL))
	if strings.Contains(lower, "/.agents/plugins/") {
		return schemas.MarketplacePlatformCodex
	}
	return schemas.MarketplacePlatformClaude
}

// ResolveMarketplaceManifestURL normalizes shorthand and preset IDs to a manifest URL.
func ResolveMarketplaceManifestURL(input string) (string, *marketplaceRepoContext, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", nil, fmt.Errorf("marketplace url is required")
	}
	lower := strings.ToLower(input)
	if manifestURL, ok := knownMarketplaceManifestURLs[lower]; ok {
		return manifestURL, repoContextFromRawManifestURL(manifestURL), nil
	}

	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		parsed, err := url.Parse(input)
		if err != nil {
			return "", nil, fmt.Errorf("invalid marketplace url: %w", err)
		}
		host := strings.ToLower(parsed.Host)
		if strings.Contains(host, "github") {
			if strings.HasSuffix(strings.ToLower(parsed.Path), "marketplace.json") {
				return input, repoContextFromRawManifestURL(input), nil
			}
			if ctx, err := repoContextFromGitHubWebURL(input); err == nil && ctx != nil {
				manifestURL, err := gitHubRawManifestURL(ctx.Owner, ctx.Repo, ctx.Ref)
				if err != nil {
					return "", nil, err
				}
				ctx.ManifestURL = manifestURL
				return manifestURL, ctx, nil
			}
		}
		if strings.HasSuffix(strings.ToLower(parsed.Path), "marketplace.json") {
			return input, repoContextFromRawManifestURL(input), nil
		}
		// Accept any HTTP(S) URL as-is for self-hosted GitLab and other hosts.
		return input, nil, nil
	}

	parts := strings.Split(strings.Trim(input, "/"), "/")
	if len(parts) == 2 {
		ref := "main"
		manifestURL, err := gitHubRawManifestURL(parts[0], parts[1], ref)
		if err != nil {
			return "", nil, err
		}
		if _, err := downloadText(manifestURL, ""); err != nil {
			ref = "master"
			manifestURL, err = gitHubRawManifestURL(parts[0], parts[1], ref)
			if err != nil {
				return "", nil, err
			}
			if _, err := downloadText(manifestURL, ""); err != nil {
				return "", nil, fmt.Errorf("marketplace manifest not found on main or master: %w", err)
			}
		}
		return manifestURL, &marketplaceRepoContext{
			Owner:       parts[0],
			Repo:        parts[1],
			Ref:         ref,
			ManifestURL: manifestURL,
		}, nil
	}

	return "", nil, fmt.Errorf("unsupported marketplace reference: use owner/repo, preset id, or manifest url")
}

// FetchRemoteCatalog downloads and parses a remote marketplace.json manifest.
func FetchRemoteCatalog(input string) (*RemoteCatalog, error) {
	manifestURL, repoCtx, err := ResolveMarketplaceManifestURL(input)
	if err != nil {
		return nil, err
	}
	body, err := downloadText(manifestURL, "")
	if err != nil {
		return nil, fmt.Errorf("fetch marketplace manifest: %w", err)
	}

	var raw struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Owner       struct {
			Name string `json:"name"`
		} `json:"owner"`
		Interface *struct {
			DisplayName string `json:"displayName"`
		} `json:"interface"`
		Metadata *struct {
			Description string `json:"description"`
		} `json:"metadata"`
		Plugins []json.RawMessage `json:"plugins"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse marketplace manifest: %w", err)
	}
	if len(raw.Plugins) == 0 {
		return nil, fmt.Errorf("marketplace manifest contains no plugins")
	}

	catalog := &RemoteCatalog{
		Name:        strings.TrimSpace(raw.Name),
		ManifestURL: manifestURL,
		OwnerName:   strings.TrimSpace(raw.Owner.Name),
		repo:        repoCtx,
	}
	if catalog.OwnerName == "" && raw.Interface != nil {
		catalog.OwnerName = strings.TrimSpace(raw.Interface.DisplayName)
	}
	catalog.Description = strings.TrimSpace(raw.Description)
	if catalog.Description == "" && raw.Metadata != nil {
		catalog.Description = strings.TrimSpace(raw.Metadata.Description)
	}

	for _, pluginRaw := range raw.Plugins {
		var base struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Version     string `json:"version"`
			Category    string `json:"category"`
		}
		if err := json.Unmarshal(pluginRaw, &base); err != nil {
			continue
		}
		if strings.TrimSpace(base.Name) == "" {
			continue
		}
		catalog.Plugins = append(catalog.Plugins, RemoteCatalogPlugin{
			Name:        strings.TrimSpace(base.Name),
			Description: strings.TrimSpace(base.Description),
			Version:     strings.TrimSpace(base.Version),
			Category:    strings.TrimSpace(base.Category),
		})
	}
	if len(catalog.Plugins) == 0 {
		return nil, fmt.Errorf("marketplace manifest contains no valid plugin entries")
	}
	return catalog, nil
}

// ImportFromRemoteCatalog imports a single plugin from a remote marketplace manifest.
func ImportFromRemoteCatalog(catalogInput, pluginName, token string, opts ImportOptions) (*ImportResult, error) {
	pluginName = strings.TrimSpace(pluginName)
	if pluginName == "" {
		return nil, fmt.Errorf("plugin_name is required")
	}

	manifestURL, repoCtx, err := ResolveMarketplaceManifestURL(catalogInput)
	if err != nil {
		return nil, err
	}
	if opts.Platform == "" {
		opts.Platform = InferCatalogSourcePlatform(manifestURL)
	}
	body, err := downloadText(manifestURL, token)
	if err != nil {
		return nil, fmt.Errorf("fetch marketplace manifest: %w", err)
	}

	var raw struct {
		Plugins []json.RawMessage `json:"plugins"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse marketplace manifest: %w", err)
	}

	for _, pluginRaw := range raw.Plugins {
		var entry remoteManifestEntry
		if err := json.Unmarshal(pluginRaw, &entry); err != nil {
			continue
		}
		if strings.TrimSpace(entry.Name) != pluginName {
			continue
		}
		spec, err := parsePluginSourceSpec(entry.Source, repoCtx)
		if err != nil {
			return nil, err
		}
		entryOpts := opts
		if entryOpts.Name == "" {
			entryOpts.Name = entry.Name
		}
		if entryOpts.Description == "" {
			entryOpts.Description = entry.Description
		}
		if entryOpts.Version == "" {
			entryOpts.Version = entry.Version
		}
		if entryOpts.ItemType == "" {
			entryOpts.ItemType = schemas.MarketplaceItemTypePlugin
		}
		return importFromPluginSourceSpec(spec, token, entryOpts)
	}
	return nil, fmt.Errorf("plugin %q not found in marketplace", pluginName)
}

type marketplaceRepoContext struct {
	Owner       string
	Repo        string
	Ref         string
	ManifestURL string
}

type remoteManifestEntry struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Version     string          `json:"version"`
	Source      json.RawMessage `json:"source"`
}

type pluginSourceSpec struct {
	repoURL    string
	ref        string
	subDir     string
	remoteKind string
}

type sourceObject struct {
	Source string `json:"source"`
	URL    string `json:"url"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	SHA    string `json:"sha"`
}

func parsePluginSourceSpec(raw json.RawMessage, repoCtx *marketplaceRepoContext) (*pluginSourceSpec, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("plugin source is missing")
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return relativeSourceSpec(asString, repoCtx)
	}

	var obj sourceObject
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, fmt.Errorf("parse plugin source: %w", err)
	}

	ref := strings.TrimSpace(obj.Ref)
	if ref == "" {
		ref = strings.TrimSpace(obj.SHA)
	}
	if ref == "" {
		ref = "main"
	}

	switch strings.ToLower(strings.TrimSpace(obj.Source)) {
	case "local":
		path := strings.TrimSpace(obj.Path)
		if path == "" {
			return nil, fmt.Errorf("plugin local source missing path")
		}
		return relativeSourceSpec(path, repoCtx)
	case "git-subdir", "github", "gitlab", "git":
		repoURL := strings.TrimSpace(obj.URL)
		if repoURL == "" {
			return nil, fmt.Errorf("plugin git source missing url")
		}
		return &pluginSourceSpec{
			repoURL:    repoURL,
			ref:        ref,
			subDir:     strings.Trim(strings.TrimSpace(obj.Path), "/"),
			remoteKind: strings.TrimSpace(obj.Source),
		}, nil
	case "url":
		repoURL := strings.TrimSpace(obj.URL)
		if repoURL == "" {
			return nil, fmt.Errorf("plugin url source missing url")
		}
		return &pluginSourceSpec{repoURL: repoURL, ref: ref, remoteKind: strings.TrimSpace(obj.Source)}, nil
	default:
		if repoURL := strings.TrimSpace(obj.URL); repoURL != "" {
			return &pluginSourceSpec{
				repoURL:    repoURL,
				ref:        ref,
				subDir:     strings.Trim(strings.TrimSpace(obj.Path), "/"),
				remoteKind: strings.TrimSpace(obj.Source),
			}, nil
		}
		return nil, fmt.Errorf("unsupported plugin source type %q", obj.Source)
	}
}

func relativeSourceSpec(relative string, repoCtx *marketplaceRepoContext) (*pluginSourceSpec, error) {
	relative = strings.TrimSpace(relative)
	if relative == "" {
		return nil, fmt.Errorf("plugin relative source is empty")
	}
	relative = strings.TrimPrefix(relative, "./")
	if repoCtx == nil || repoCtx.Owner == "" || repoCtx.Repo == "" {
		return nil, fmt.Errorf("relative plugin source requires a GitHub-based marketplace")
	}
	ref := repoCtx.Ref
	if ref == "" {
		ref = "main"
	}
	return &pluginSourceSpec{
		repoURL: fmt.Sprintf("https://github.com/%s/%s", repoCtx.Owner, repoCtx.Repo),
		ref:     ref,
		subDir:  strings.Trim(relative, "/"),
		remoteKind: "github",
	}, nil
}

func importFromPluginSourceSpec(spec *pluginSourceSpec, token string, opts ImportOptions) (*ImportResult, error) {
	if spec == nil {
		return nil, fmt.Errorf("plugin source spec is nil")
	}
	sourceType := inferGitImportSourceType(spec.repoURL, spec.remoteKind)
	result, err := ImportFromGitRemoteSubdir(spec.repoURL, spec.ref, spec.subDir, token, sourceType, opts)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func inferGitImportSourceType(repoURL, remoteKind string) schemas.MarketplaceImportSourceType {
	lower := strings.ToLower(strings.TrimSpace(repoURL))
	if strings.Contains(lower, "github.com") || strings.Contains(lower, "codeload.github.com") {
		return schemas.MarketplaceImportSourceGitHub
	}
	switch strings.ToLower(strings.TrimSpace(remoteKind)) {
	case "github":
		return schemas.MarketplaceImportSourceGitHub
	case "gitlab", "git":
		return schemas.MarketplaceImportSourceGitLab
	}
	return schemas.MarketplaceImportSourceGitLab
}

func repoContextFromRawManifestURL(manifestURL string) *marketplaceRepoContext {
	match := rawGitHubManifestPattern.FindStringSubmatch(manifestURL)
	if len(match) != 4 {
		return nil
	}
	return &marketplaceRepoContext{
		Owner:       match[1],
		Repo:        match[2],
		Ref:         match[3],
		ManifestURL: manifestURL,
	}
}

func repoContextFromGitHubWebURL(rawURL string) (*marketplaceRepoContext, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid github repository url")
	}
	ref := "main"
	if len(parts) >= 4 && parts[2] == "tree" {
		ref = parts[3]
	}
	return &marketplaceRepoContext{
		Owner: parts[0],
		Repo:  strings.TrimSuffix(parts[1], ".git"),
		Ref:   ref,
	}, nil
}

func gitHubRawManifestURL(owner, repo, ref string) (string, error) {
	owner = strings.TrimSpace(owner)
	repo = strings.Trim(strings.TrimSpace(repo), "/")
	if owner == "" || repo == "" {
		return "", fmt.Errorf("invalid github repository")
	}
	return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s/.claude-plugin/marketplace.json", owner, repo, ref), nil
}

func downloadText(rawURL, token string) ([]byte, error) {
	data, err := downloadArchive(rawURL, token)
	if err != nil {
		return nil, err
	}
	return data, nil
}
