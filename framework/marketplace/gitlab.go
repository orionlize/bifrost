package marketplace

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

type gitLabTarget struct {
	origin      string
	apiBase     string
	webPath     string
	projectPath string
	ref         string
}

func parseGitLabRemoteURL(remoteURL, ref string) ([]gitLabTarget, error) {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return nil, fmt.Errorf("remote_url is required")
	}

	parsed, err := url.Parse(remoteURL)
	if err != nil {
		return nil, fmt.Errorf("invalid remote url: %w", err)
	}
	if parsed.Scheme == "" {
		parsed, err = url.Parse("https://" + remoteURL)
		if err != nil {
			return nil, fmt.Errorf("invalid remote url: %w", err)
		}
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("remote url must include a host")
	}

	ref = strings.TrimSpace(ref)
	if ref == "" {
		ref = "main"
	}

	path := strings.Trim(parsed.Path, "/")
	refFromURL := extractGitLabRefFromPath(path)
	if refFromURL != "" {
		ref = refFromURL
	}
	path = stripGitLabWebSuffix(path)
	path = normalizeGitProjectPath(path)
	if path == "" {
		return nil, fmt.Errorf("remote url must include a gitlab project path")
	}

	segments := strings.Split(path, "/")
	if len(segments) < 2 {
		return nil, fmt.Errorf("remote url must include namespace and project")
	}

	origin := fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)
	var targets []gitLabTarget

	// Self-hosted GitLab is often mounted under /gitlab (or similar).
	if len(segments) >= 3 && isGitLabMountSegment(segments[0]) {
		mount := segments[0]
		rest := strings.Join(segments[1:], "/")
		targets = append(targets,
			gitLabTarget{origin: origin, apiBase: fmt.Sprintf("%s/%s/api/v4", origin, mount), webPath: path, projectPath: rest, ref: ref},
			gitLabTarget{origin: origin, apiBase: origin + "/api/v4", webPath: path, projectPath: rest, ref: ref},
		)
	} else {
		targets = append(targets, gitLabTarget{
			origin:      origin,
			apiBase:     origin + "/api/v4",
			webPath:     path,
			projectPath: path,
			ref:         ref,
		})
	}

	return dedupeGitLabTargets(targets), nil
}

func isGitLabMountSegment(segment string) bool {
	switch strings.ToLower(strings.TrimSpace(segment)) {
	case "gitlab", "git":
		return true
	default:
		return false
	}
}

func extractGitLabRefFromPath(path string) string {
	idx := strings.Index(path, "/-/")
	if idx < 0 {
		return ""
	}
	suffix := strings.Trim(strings.TrimPrefix(path[idx:], "/-/"), "/")
	parts := strings.Split(suffix, "/")
	if len(parts) < 2 {
		return ""
	}
	switch parts[0] {
	case "tree", "blob", "commits", "commit":
		return strings.TrimSpace(parts[1])
	default:
		return ""
	}
}

func stripGitLabWebSuffix(path string) string {
	if idx := strings.Index(path, "/-/"); idx >= 0 {
		return strings.Trim(path[:idx], "/")
	}
	return strings.Trim(path, "/")
}

func normalizeGitProjectPath(path string) string {
	path = strings.Trim(path, "/")
	if path == "" {
		return ""
	}
	parts := strings.Split(path, "/")
	last := parts[len(parts)-1]
	if strings.HasSuffix(strings.ToLower(last), ".git") {
		parts[len(parts)-1] = strings.TrimSuffix(last, ".git")
	}
	return strings.Join(parts, "/")
}

func dedupeGitLabTargets(targets []gitLabTarget) []gitLabTarget {
	seen := make(map[string]struct{}, len(targets))
	out := make([]gitLabTarget, 0, len(targets))
	for _, target := range targets {
		key := target.apiBase + "|" + target.webPath + "|" + target.projectPath + "|" + target.ref
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, target)
	}
	return out
}

func gitLabProjectPathEncodings(projectPath string) []string {
	normal := gitLabProjectPathEncoding(projectPath)
	double := strings.ReplaceAll(normal, "%2F", "%252F")
	if double == normal {
		return []string{normal}
	}
	return []string{normal, double}
}

func gitLabArchiveCandidates(target gitLabTarget, projectID string) []string {
	ref := url.QueryEscape(target.ref)
	var out []string
	projectRefs := []string{gitLabProjectPathEncoding(target.projectPath)}
	if projectID != "" {
		projectRefs = []string{projectID}
	} else {
		projectRefs = gitLabProjectPathEncodings(target.projectPath)
	}

	for _, projectRef := range projectRefs {
		base := strings.TrimSuffix(target.apiBase, "/") + "/projects/" + projectRef + "/repository"
		out = append(out,
			base+"/archive.zip?sha="+ref,
			base+"/archive?sha="+ref+"&format=zip",
			base+"/archive.tar.gz?sha="+ref,
			base+"/archive.zip?ref="+ref,
			base+"/archive.tar.gz?ref="+ref,
		)
	}
	return out
}

func gitLabWebArchiveCandidates(target gitLabTarget) []string {
	webPath := strings.Trim(target.webPath, "/")
	if webPath == "" {
		return nil
	}
	ref := target.ref
	projectName := webPath[strings.LastIndex(webPath, "/")+1:]
	base := strings.TrimSuffix(target.origin, "/") + "/" + webPath
	refQuery := url.QueryEscape(ref)
	return []string{
		fmt.Sprintf("%s/-/archive/%s/%s-%s.zip", base, ref, projectName, ref),
		fmt.Sprintf("%s/-/archive/%s.zip", base, ref),
		fmt.Sprintf("%s/repository/archive.zip?ref=%s", base, refQuery),
		fmt.Sprintf("%s/repository/archive.tar.gz?ref=%s", base, refQuery),
	}
}

func gitLabAPIAvailable(apiBase, token string) bool {
	versionURL := strings.TrimSuffix(apiBase, "/") + "/version"
	req, err := http.NewRequest(http.MethodGet, versionURL, nil)
	if err != nil {
		return false
	}
	applyGitLabAuth(req, token)
	req.Header.Set("User-Agent", "bifrost-marketplace-import")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false
	}
	return strings.TrimSpace(payload.Version) != ""
}

func downloadGitLabRepository(remoteURL, ref, token string) ([]byte, error) {
	targets, err := parseGitLabRemoteURL(remoteURL, ref)
	if err != nil {
		return nil, err
	}

	var attempts []string
	var lastErr error
	for _, target := range targets {
		var projectID string
		if gitLabAPIAvailable(target.apiBase, token) {
			var lookupErr error
			projectID, lookupErr = resolveGitLabProjectID(target, token)
			if lookupErr != nil {
				lastErr = lookupErr
			}
			for _, archiveURL := range gitLabArchiveCandidates(target, projectID) {
				attempts = append(attempts, archiveURL)
				data, downloadErr := downloadGitLabArchive(archiveURL, token)
				if downloadErr == nil {
					return data, nil
				}
				lastErr = downloadErr
			}
		}

		for _, archiveURL := range gitLabWebArchiveCandidates(target) {
			attempts = append(attempts, archiveURL)
			data, downloadErr := downloadGitLabArchive(archiveURL, token)
			if downloadErr == nil {
				return data, nil
			}
			lastErr = downloadErr
		}
	}

	if lastErr != nil {
		if len(attempts) > 0 {
			return nil, fmt.Errorf("gitlab archive download failed (tried %d urls, last: %s): %w", len(attempts), attempts[len(attempts)-1], lastErr)
		}
		return nil, fmt.Errorf("gitlab archive download failed: %w", lastErr)
	}
	return nil, fmt.Errorf("gitlab archive download failed for %q", remoteURL)
}

func downloadGitLabArchive(archiveURL, token string) ([]byte, error) {
	if token != "" && !strings.Contains(archiveURL, "private_token=") {
		sep := "?"
		if strings.Contains(archiveURL, "?") {
			sep = "&"
		}
		archiveURL = archiveURL + sep + "private_token=" + url.QueryEscape(token)
	}
	data, err := downloadArchive(archiveURL, token)
	if err != nil {
		return nil, err
	}
	if looksLikeHTMLArchive(data) {
		return nil, fmt.Errorf("archive response looks like an HTML login page; check gitlab token permissions")
	}
	return data, nil
}

func looksLikeHTMLArchive(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	trimmed := strings.TrimSpace(strings.ToLower(string(data[:min(len(data), 256)])))
	return strings.HasPrefix(trimmed, "<!doctype html") || strings.HasPrefix(trimmed, "<html")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func gitLabProjectPathEncoding(projectPath string) string {
	return url.PathEscape(projectPath)
}

func resolveGitLabProjectID(target gitLabTarget, token string) (string, error) {
	var lastErr error
	for _, encodedPath := range gitLabProjectPathEncodings(target.projectPath) {
		lookupURL := strings.TrimSuffix(target.apiBase, "/") + "/projects/" + encodedPath
		projectID, err := fetchGitLabProjectID(lookupURL, token)
		if err == nil {
			return projectID, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("gitlab project lookup failed for %q", target.projectPath)
}

func fetchGitLabProjectID(lookupURL, token string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, lookupURL, nil)
	if err != nil {
		return "", err
	}
	applyGitLabAuth(req, token)
	req.Header.Set("User-Agent", "bifrost-marketplace-import")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", fmt.Errorf("project not found at %s", lookupURL)
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("gitlab project lookup failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if payload.ID <= 0 {
		return "", fmt.Errorf("gitlab project lookup returned empty id")
	}
	return fmt.Sprintf("%d", payload.ID), nil
}

func applyGitLabAuth(req *http.Request, token string) {
	if token == "" {
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)
}

func gitArchiveURL(remoteURL, ref string, sourceType schemas.MarketplaceImportSourceType) (string, error) {
	if sourceType == schemas.MarketplaceImportSourceGitLab {
		targets, err := parseGitLabRemoteURL(remoteURL, ref)
		if err != nil {
			return "", err
		}
		return gitLabArchiveCandidates(targets[0], "")[0], nil
	}

	parsed, err := url.Parse(remoteURL)
	if err != nil {
		return "", fmt.Errorf("invalid remote url: %w", err)
	}
	if parsed.Scheme == "" {
		parsed, err = url.Parse("https://" + remoteURL)
		if err != nil {
			return "", fmt.Errorf("invalid remote url: %w", err)
		}
	}
	host := strings.ToLower(parsed.Host)
	pathParts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(pathParts) < 2 {
		return "", fmt.Errorf("remote url must include owner and repository")
	}
	if !strings.Contains(host, "github") {
		return "", fmt.Errorf("github source type requires a github host")
	}
	owner := pathParts[0]
	repo := pathParts[1]
	if strings.HasSuffix(strings.ToLower(repo), ".git") {
		repo = strings.TrimSuffix(repo, ".git")
	}
	if idx := strings.Index(repo, "/"); idx >= 0 {
		repo = repo[:idx]
	}
	return gitHubCodeloadArchiveURL(owner, repo, ref), nil
}

func gitHubCodeloadArchiveURL(owner, repo, ref string) string {
	ref = strings.TrimSpace(ref)
	if len(ref) == 40 && isHexString(ref) {
		return fmt.Sprintf("https://codeload.github.com/%s/%s/zip/%s", owner, repo, ref)
	}
	if strings.HasPrefix(ref, "v") || (strings.Contains(ref, ".") && ref != "main" && ref != "master") {
		return fmt.Sprintf("https://codeload.github.com/%s/%s/zip/refs/tags/%s", owner, repo, ref)
	}
	return fmt.Sprintf("https://codeload.github.com/%s/%s/zip/refs/heads/%s", owner, repo, ref)
}

func isHexString(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
			return false
		}
	}
	return true
}
