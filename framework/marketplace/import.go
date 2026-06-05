package marketplace

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/maximhq/bifrost/core/schemas"
)

const (
	maxArchiveBytes = 50 * 1024 * 1024
	maxFileBytes    = 512 * 1024
	maxIconBytes    = 256 * 1024
)

var (
	skipPathPrefixes = []string{".git/", "node_modules/", "__MACOSX/", ".github/"}
	textExtensions   = map[string]struct{}{
		".md": {}, ".json": {}, ".txt": {}, ".yaml": {}, ".yml": {}, ".toml": {},
		".sh": {}, ".bash": {}, ".zsh": {}, ".py": {}, ".js": {}, ".ts": {},
		".tsx": {}, ".jsx": {}, ".go": {}, ".sql": {}, ".xml": {}, ".html": {},
		".css": {}, ".scss": {}, ".env.example": {},
	}
)

// ImportOptions carries optional overrides when importing catalog content.
type ImportOptions struct {
	Name        string
	ItemType    schemas.MarketplaceItemType
	Platform    schemas.MarketplacePlatform
	Description string
	Version     string
}

// ImportResult is the parsed catalog payload and inferred metadata.
type ImportResult struct {
	Bundle        *schemas.MarketplaceItemBundle
	ItemType      schemas.MarketplaceItemType
	Platform      schemas.MarketplacePlatform
	Name          string
	Description   string
	Version       string
	IconData      []byte
	IconMediaType string
}

// ImportFromZip parses a zip archive into a marketplace content bundle.
func ImportFromZip(data []byte, opts ImportOptions) (*ImportResult, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("zip archive is empty")
	}
	if len(data) > maxArchiveBytes {
		return nil, fmt.Errorf("zip archive exceeds %d byte limit", maxArchiveBytes)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("parse zip archive: %w", err)
	}
	files, err := readZipFiles(reader)
	if err != nil {
		return nil, err
	}
	return buildImportResult(files.Files, files.Icons, opts)
}

// ImportFromGitRemote downloads a GitHub or GitLab repository archive and parses it.
func ImportFromGitRemote(remoteURL, ref, token string, sourceType schemas.MarketplaceImportSourceType, opts ImportOptions) (*ImportResult, error) {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return nil, fmt.Errorf("remote_url is required")
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "main"
	}

	archiveURL, err := gitArchiveURL(remoteURL, ref, sourceType)
	if err != nil {
		return nil, err
	}

	var data []byte
	if sourceType == schemas.MarketplaceImportSourceGitLab {
		data, err = downloadGitLabRepository(remoteURL, ref, token)
	} else {
		data, err = downloadArchive(archiveURL, token)
	}
	if err != nil {
		return nil, err
	}

	var contents *archiveContents
	switch {
	case strings.HasSuffix(strings.ToLower(archiveURL), ".zip"), sourceType == schemas.MarketplaceImportSourceGitLab:
		contents, err = readZipBytes(data)
	case strings.HasSuffix(strings.ToLower(archiveURL), ".tar.gz"), strings.Contains(archiveURL, "/tarball/"):
		contents, err = readTarGzBytes(data)
	default:
		contents, err = readZipBytes(data)
		if err != nil {
			contents, err = readTarGzBytes(data)
		}
	}
	if err != nil {
		return nil, err
	}
	return buildImportResult(contents.Files, contents.Icons, opts)
}

// ImportFromGitRemoteSubdir downloads a repository archive and imports a subdirectory.
func ImportFromGitRemoteSubdir(remoteURL, ref, subDir, token string, sourceType schemas.MarketplaceImportSourceType, opts ImportOptions) (*ImportResult, error) {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return nil, fmt.Errorf("remote_url is required")
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "main"
	}

	archiveURL, err := gitArchiveURL(remoteURL, ref, sourceType)
	if err != nil {
		return nil, err
	}

	var data []byte
	if sourceType == schemas.MarketplaceImportSourceGitLab {
		data, err = downloadGitLabRepository(remoteURL, ref, token)
	} else {
		data, err = downloadArchive(archiveURL, token)
	}
	if err != nil {
		return nil, err
	}

	var contents *archiveContents
	switch {
	case strings.HasSuffix(strings.ToLower(archiveURL), ".zip"), sourceType == schemas.MarketplaceImportSourceGitLab:
		contents, err = readZipBytes(data)
	case strings.HasSuffix(strings.ToLower(archiveURL), ".tar.gz"), strings.Contains(archiveURL, "/tarball/"):
		contents, err = readTarGzBytes(data)
	default:
		contents, err = readZipBytes(data)
		if err != nil {
			contents, err = readTarGzBytes(data)
		}
	}
	if err != nil {
		return nil, err
	}
	contents, err = filterArchiveContents(contents, subDir)
	if err != nil {
		return nil, err
	}
	return buildImportResult(contents.Files, contents.Icons, opts)
}

func filterArchiveContents(contents *archiveContents, subDir string) (*archiveContents, error) {
	if contents == nil {
		return nil, fmt.Errorf("archive is empty")
	}
	subDir = strings.Trim(strings.TrimSpace(subDir), "/")
	if subDir == "" {
		return contents, nil
	}

	filterMap := func(files map[string][]byte) map[string][]byte {
		filtered := make(map[string][]byte)
		prefix := subDir + "/"
		for name, data := range files {
			if name == subDir {
				continue
			}
			if strings.HasPrefix(name, prefix) {
				rel := strings.TrimPrefix(name, prefix)
				if rel != "" {
					filtered[rel] = data
				}
			}
		}
		return filtered
	}

	files := filterMap(contents.Files)
	if len(files) == 0 {
		return nil, fmt.Errorf("no importable files found under %q", subDir)
	}
	return &archiveContents{
		Files: files,
		Icons: filterMap(contents.Icons),
	}, nil
}

func isGitLabAPIURL(archiveURL string) bool {
	lower := strings.ToLower(archiveURL)
	return strings.Contains(lower, "/api/v4/projects/")
}

func downloadArchive(archiveURL, token string) ([]byte, error) {
	client := &http.Client{Timeout: 2 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, archiveURL, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		if isGitLabAPIURL(archiveURL) {
			req.Header.Set("PRIVATE-TOKEN", token)
		} else {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	}
	req.Header.Set("User-Agent", "bifrost-marketplace-import")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download archive: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		msg := strings.TrimSpace(string(body))
		if msg != "" {
			return nil, fmt.Errorf("download archive failed with status %d: %s", resp.StatusCode, msg)
		}
		return nil, fmt.Errorf("download archive failed with status %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, maxArchiveBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read archive: %w", err)
	}
	if len(data) > maxArchiveBytes {
		return nil, fmt.Errorf("archive exceeds %d byte limit", maxArchiveBytes)
	}
	return data, nil
}

type archiveContents struct {
	Files map[string][]byte
	Icons map[string][]byte
}

func readZipBytes(data []byte) (*archiveContents, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("parse zip archive: %w", err)
	}
	return readZipFiles(reader)
}

func readZipFiles(reader *zip.Reader) (*archiveContents, error) {
	raw := make(map[string][]byte)
	icons := make(map[string][]byte)
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		if shouldSkipPath(file.Name) {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("open zip entry %s: %w", file.Name, err)
		}
		if isIconPath(file.Name) {
			content, iconErr := readLimitedBinary(rc, maxIconBytes)
			rc.Close()
			if iconErr == nil {
				icons[file.Name] = content
			}
			continue
		}
		content, err := readLimitedText(rc, file.Name)
		rc.Close()
		if err != nil {
			if err == errSkipBinary {
				continue
			}
			return nil, err
		}
		raw[file.Name] = content
	}
	files, err := normalizeArchivePaths(raw)
	if err != nil {
		return nil, err
	}
	normalizedIcons := map[string][]byte{}
	if len(icons) > 0 {
		if normalizedIcons, err = normalizeArchivePaths(icons); err != nil {
			normalizedIcons = icons
		}
	}
	return &archiveContents{Files: files, Icons: normalizedIcons}, nil
}

func readTarGzBytes(data []byte) (*archiveContents, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("parse gzip archive: %w", err)
	}
	defer gz.Close()

	tarReader := tar.NewReader(gz)
	raw := make(map[string][]byte)
	icons := make(map[string][]byte)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read tar archive: %w", err)
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		name := header.Name
		if shouldSkipPath(name) {
			continue
		}
		if isIconPath(name) {
			content, iconErr := readLimitedBinary(tarReader, maxIconBytes)
			if iconErr == nil {
				icons[name] = content
			}
			continue
		}
		content, err := readLimitedText(tarReader, name)
		if err != nil {
			if err == errSkipBinary {
				continue
			}
			return nil, err
		}
		raw[name] = content
	}
	files, err := normalizeArchivePaths(raw)
	if err != nil {
		return nil, err
	}
	normalizedIcons := map[string][]byte{}
	if len(icons) > 0 {
		if normalizedIcons, err = normalizeArchivePaths(icons); err != nil {
			normalizedIcons = icons
		}
	}
	return &archiveContents{Files: files, Icons: normalizedIcons}, nil
}

var errSkipBinary = fmt.Errorf("skip binary file")

func readLimitedText(r io.Reader, name string) ([]byte, error) {
	if !isTextPath(name) {
		return nil, errSkipBinary
	}
	limited := io.LimitReader(r, maxFileBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(data) > maxFileBytes {
		return nil, fmt.Errorf("file %s exceeds %d byte limit", name, maxFileBytes)
	}
	if !utf8.Valid(data) {
		return nil, errSkipBinary
	}
	return data, nil
}

func isTextPath(name string) bool {
	lower := strings.ToLower(name)
	if lower == "skill.md" || strings.HasSuffix(lower, "/skill.md") {
		return true
	}
	if strings.Contains(lower, ".claude-plugin/") || strings.Contains(lower, ".codex-plugin/") {
		return true
	}
	ext := path.Ext(lower)
	if ext == "" {
		base := path.Base(lower)
		if base == "LICENSE" || base == "Makefile" {
			return true
		}
		return false
	}
	if _, ok := textExtensions[ext]; ok {
		return true
	}
	return false
}

func shouldSkipPath(name string) bool {
	clean := strings.TrimPrefix(path.Clean(name), "/")
	lower := strings.ToLower(clean)
	if strings.HasPrefix(lower, ".ds_store") || strings.Contains(lower, "/.ds_store") {
		return true
	}
	for _, prefix := range skipPathPrefixes {
		if strings.HasPrefix(lower, prefix) || strings.Contains(lower, "/"+prefix) {
			return true
		}
	}
	return false
}

func normalizeArchivePaths(raw map[string][]byte) (map[string][]byte, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("archive contains no importable text files")
	}

	prefix := commonPathPrefix(raw)
	normalized := make(map[string][]byte, len(raw))
	for name, content := range raw {
		rel := strings.TrimPrefix(name, prefix)
		rel = strings.TrimPrefix(rel, "/")
		if rel == "" {
			continue
		}
		normalized[rel] = content
	}
	if len(normalized) == 0 {
		return nil, fmt.Errorf("archive contains no importable text files")
	}
	return normalized, nil
}

func commonPathPrefix(files map[string][]byte) string {
	if len(files) == 1 {
		for name := range files {
			segments := strings.Split(strings.Trim(name, "/"), "/")
			if len(segments) > 1 {
				return segments[0] + "/"
			}
		}
		return ""
	}

	var parts []string
	for name := range files {
		segments := strings.Split(strings.Trim(name, "/"), "/")
		if len(segments) <= 1 {
			return ""
		}
		parts = segments[:len(segments)-1]
		break
	}
	if len(parts) == 0 {
		return ""
	}
	for name := range files {
		segments := strings.Split(strings.Trim(name, "/"), "/")
		if len(segments) <= 1 {
			return ""
		}
		dirParts := segments[:len(segments)-1]
		for i := 0; i < len(parts) && i < len(dirParts); i++ {
			if parts[i] != dirParts[i] {
				parts = parts[:i]
				break
			}
		}
		if len(dirParts) < len(parts) {
			parts = dirParts
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "/") + "/"
}

func readLimitedBinary(r io.Reader, limit int64) ([]byte, error) {
	limited := io.LimitReader(r, limit+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("binary exceeds size limit")
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("binary is empty")
	}
	return data, nil
}

func isIconPath(name string) bool {
	base := strings.ToLower(path.Base(name))
	switch base {
	case "icon.png", "icon.jpg", "icon.jpeg", "icon.svg", "icon.webp", "icon.gif":
		return true
	default:
		return false
	}
}

var iconPathPriority = []string{
	"icon.png",
	".claude-plugin/icon.png",
	".codex-plugin/icon.png",
	"assets/icon.png",
	"icon.svg",
	".claude-plugin/icon.svg",
	".codex-plugin/icon.svg",
	"assets/icon.svg",
	"icon.webp",
	"icon.jpg",
	"icon.jpeg",
}

func pickArchiveIcon(icons map[string][]byte) ([]byte, string) {
	if len(icons) == 0 {
		return nil, ""
	}
	for _, candidate := range iconPathPriority {
		if data, ok := icons[candidate]; ok {
			return data, iconMediaType(candidate)
		}
	}
	for name, data := range icons {
		return data, iconMediaType(name)
	}
	return nil, ""
}

func iconMediaType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "application/octet-stream"
	}
}

func buildImportResult(files map[string][]byte, icons map[string][]byte, opts ImportOptions) (*ImportResult, error) {
	bundle := &schemas.MarketplaceItemBundle{Files: make(map[string]string)}
	for rel, content := range files {
		bundle.Files[rel] = string(content)
	}

	itemType := opts.ItemType
	if itemType == "" {
		itemType = detectItemType(files)
		if itemType == "" {
			return nil, fmt.Errorf("could not detect item type; include SKILL.md or plugin.json under .claude-plugin/ or .codex-plugin/")
		}
	}

	platform := detectPlatform(files, opts.Platform)
	pluginPath := pluginManifestPath(files, platform)
	if content, ok := files[pluginPath]; ok {
		var pluginJSON map[string]any
		if err := json.Unmarshal(content, &pluginJSON); err != nil {
			return nil, fmt.Errorf("parse plugin.json: %w", err)
		}
		bundle.PluginJSON = pluginJSON
		delete(bundle.Files, pluginPath)
	}
	if content, ok := files["SKILL.md"]; ok && itemType == schemas.MarketplaceItemTypeSkill {
		bundle.SkillMD = string(content)
		delete(bundle.Files, "SKILL.md")
	}

	name := strings.TrimSpace(opts.Name)
	description := strings.TrimSpace(opts.Description)
	version := strings.TrimSpace(opts.Version)

	if bundle.PluginJSON != nil {
		if name == "" {
			name = pluginNameFromManifest(bundle.PluginJSON)
		}
		if description == "" {
			description = pluginDescriptionFromManifest(bundle.PluginJSON)
		}
		if version == "" {
			version = stringField(bundle.PluginJSON, "version")
		}
	}
	if bundle.SkillMD != "" {
		if name == "" || description == "" {
			fmName, fmDesc := parseSkillFrontmatter(bundle.SkillMD)
			if name == "" {
				name = fmName
			}
			if description == "" {
				description = fmDesc
			}
		}
	}
	if version == "" {
		version = "1.0.0"
	}
	if name == "" {
		return nil, fmt.Errorf("name is required and could not be inferred from content")
	}

	if len(bundle.Files) == 0 {
		bundle.Files = nil
	}

	iconData, iconMediaType := pickArchiveIcon(icons)

	return &ImportResult{
		Bundle:        bundle,
		ItemType:      itemType,
		Platform:      platform,
		Name:          name,
		Description:   description,
		Version:       version,
		IconData:      iconData,
		IconMediaType: iconMediaType,
	}, nil
}

func detectPlatform(files map[string][]byte, override schemas.MarketplacePlatform) schemas.MarketplacePlatform {
	switch override {
	case schemas.MarketplacePlatformCodex, schemas.MarketplacePlatformClaude:
		return override
	}
	if _, ok := files[".codex-plugin/plugin.json"]; ok {
		return schemas.MarketplacePlatformCodex
	}
	if _, ok := files[".claude-plugin/plugin.json"]; ok {
		return schemas.MarketplacePlatformClaude
	}
	for name := range files {
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, ".agents/skills/") || strings.HasPrefix(lower, "skills/") {
			return schemas.MarketplacePlatformCodex
		}
	}
	return schemas.MarketplacePlatformClaude
}

func pluginManifestPath(files map[string][]byte, platform schemas.MarketplacePlatform) string {
	if platform == schemas.MarketplacePlatformCodex {
		if _, ok := files[".codex-plugin/plugin.json"]; ok {
			return ".codex-plugin/plugin.json"
		}
	}
	if _, ok := files[".claude-plugin/plugin.json"]; ok {
		return ".claude-plugin/plugin.json"
	}
	if _, ok := files[".codex-plugin/plugin.json"]; ok {
		return ".codex-plugin/plugin.json"
	}
	return ".claude-plugin/plugin.json"
}

func pluginNameFromManifest(pluginJSON map[string]any) string {
	if name := stringField(pluginJSON, "name"); name != "" {
		return name
	}
	if iface, ok := pluginJSON["interface"].(map[string]any); ok {
		if name := stringField(iface, "displayName"); name != "" {
			return name
		}
	}
	return ""
}

func pluginDescriptionFromManifest(pluginJSON map[string]any) string {
	if description := stringField(pluginJSON, "description"); description != "" {
		return description
	}
	if iface, ok := pluginJSON["interface"].(map[string]any); ok {
		if description := stringField(iface, "shortDescription"); description != "" {
			return description
		}
		if description := stringField(iface, "longDescription"); description != "" {
			return description
		}
	}
	return ""
}

func detectItemType(files map[string][]byte) schemas.MarketplaceItemType {
	if _, ok := files[".claude-plugin/plugin.json"]; ok {
		return schemas.MarketplaceItemTypePlugin
	}
	if _, ok := files[".codex-plugin/plugin.json"]; ok {
		return schemas.MarketplaceItemTypePlugin
	}
	if _, ok := files["SKILL.md"]; ok {
		return schemas.MarketplaceItemTypeSkill
	}
	for name := range files {
		if strings.HasSuffix(strings.ToLower(name), "/skill.md") {
			return schemas.MarketplaceItemTypeSkill
		}
	}
	return ""
}

func stringField(obj map[string]any, key string) string {
	raw, ok := obj[key]
	if !ok || raw == nil {
		return ""
	}
	switch v := raw.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

var frontmatterRe = regexp.MustCompile(`(?s)^---\s*\n(.*?)\n---`)

func parseSkillFrontmatter(skillMD string) (name, description string) {
	match := frontmatterRe.FindStringSubmatch(skillMD)
	if len(match) < 2 {
		return "", ""
	}
	for _, line := range strings.Split(match[1], "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "name:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		}
		if strings.HasPrefix(line, "description:") {
			description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
		}
	}
	return name, description
}
