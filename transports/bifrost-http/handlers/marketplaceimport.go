package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/framework/marketplace"
	"github.com/valyala/fasthttp"
	"gorm.io/gorm"
)

func (h *MarketplaceHandler) importItem(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	form, err := ctx.MultipartForm()
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid multipart form")
		return
	}

	sourceType := schemas.MarketplaceImportSourceType(strings.TrimSpace(firstFormValue(form, "source_type")))
	if sourceType == "" {
		sourceType = schemas.MarketplaceImportSourceZip
	}
	if sourceType != schemas.MarketplaceImportSourceZip &&
		sourceType != schemas.MarketplaceImportSourceGitHub &&
		sourceType != schemas.MarketplaceImportSourceGitLab &&
		sourceType != schemas.MarketplaceImportSourceCatalog {
		SendError(ctx, fasthttp.StatusBadRequest, "source_type must be zip, github, gitlab, or catalog")
		return
	}

	opts := marketplace.ImportOptions{
		Name:        strings.TrimSpace(firstFormValue(form, "name")),
		Description: strings.TrimSpace(firstFormValue(form, "description")),
		Version:     strings.TrimSpace(firstFormValue(form, "version")),
	}
	if itemType := strings.TrimSpace(firstFormValue(form, "item_type")); itemType != "" {
		opts.ItemType = schemas.MarketplaceItemType(itemType)
	}
	if platformRaw := strings.TrimSpace(firstFormValue(form, "platform")); platformRaw != "" {
		opts.Platform = parseMarketplacePlatform(platformRaw)
	}

	var importResult *marketplace.ImportResult
	switch sourceType {
	case schemas.MarketplaceImportSourceZip:
		fileHeaders := form.File["file"]
		if len(fileHeaders) == 0 {
			SendError(ctx, fasthttp.StatusBadRequest, "file is required for zip import")
			return
		}
		data, readErr := readMultipartFile(fileHeaders[0])
		if readErr != nil {
			SendError(ctx, fasthttp.StatusBadRequest, readErr.Error())
			return
		}
		importResult, err = marketplace.ImportFromZip(data, opts)
	case schemas.MarketplaceImportSourceCatalog:
		catalogURL := strings.TrimSpace(firstFormValue(form, "catalog_url"))
		pluginName := strings.TrimSpace(firstFormValue(form, "catalog_plugin"))
		token := h.resolveGitTokenForImport(ctx, sourceType, firstFormValue(form, "git_token"))
		importResult, err = marketplace.ImportFromRemoteCatalog(catalogURL, pluginName, token, opts)
	default:
		remoteURL := strings.TrimSpace(firstFormValue(form, "remote_url"))
		ref := strings.TrimSpace(firstFormValue(form, "remote_ref"))
		token := h.resolveGitTokenForImport(ctx, sourceType, firstFormValue(form, "git_token"))
		importResult, err = marketplace.ImportFromGitRemote(remoteURL, ref, token, sourceType, opts)
	}
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}
	if opts.ItemType != "" && importResult.ItemType != opts.ItemType {
		SendError(ctx, fasthttp.StatusBadRequest, fmt.Sprintf("content looks like %s but item_type is %s", importResult.ItemType, opts.ItemType))
		return
	}

	enabled := true
	if enabledRaw := strings.TrimSpace(firstFormValue(form, "enabled")); enabledRaw != "" {
		enabled = enabledRaw == "true" || enabledRaw == "1"
	}

	item := &tables.TableMarketplaceItem{
		Name:        importResult.Name,
		Platform:    importResult.Platform,
		ItemType:    importResult.ItemType,
		Description: coalesceNonEmpty(importResult.Description, opts.Description),
		Version:     importResult.Version,
		SourceType:  sourceType,
		Enabled:     enabled,
		Category:    strings.TrimSpace(firstFormValue(form, "category")),
		Tags:        splitFormTags(firstFormValue(form, "tags")),
		Content:     importResult.Bundle,
	}
	if sourceType == schemas.MarketplaceImportSourceGitHub || sourceType == schemas.MarketplaceImportSourceGitLab {
		item.RemoteURL = strings.TrimSpace(firstFormValue(form, "remote_url"))
		item.RemoteRef = strings.TrimSpace(firstFormValue(form, "remote_ref"))
		if item.RemoteRef == "" {
			item.RemoteRef = "main"
		}
	}
	if sourceType == schemas.MarketplaceImportSourceCatalog {
		catalogURL := strings.TrimSpace(firstFormValue(form, "catalog_url"))
		manifestURL, _, resolveErr := marketplace.ResolveMarketplaceManifestURL(catalogURL)
		if resolveErr == nil {
			item.RemoteURL = manifestURL
		} else {
			item.RemoteURL = catalogURL
		}
		item.RemoteRef = strings.TrimSpace(firstFormValue(form, "catalog_plugin"))
	}
	if item.Platform == "" {
		item.Platform = schemas.MarketplacePlatformClaude
	}
	if platformRaw := strings.TrimSpace(firstFormValue(form, "platform")); platformRaw != "" {
		item.Platform = parseMarketplacePlatform(platformRaw)
	}
	item.Source = defaultMarketplaceItemSource(item)
	applyMarketplaceIconFromImport(item, importResult.IconData, importResult.IconMediaType)
	if err := applyMarketplaceIconFromForm(item, form); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	if err := h.configStore.CreateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to create marketplace item: %v", err))
		return
	}

	if assignmentUpdate := parseMarketplaceAssignmentForm(form); assignmentUpdate != nil {
		if err := h.configStore.ReplaceMarketplaceItemAssignments(ctx, item.ID, assignmentUpdate); err != nil {
			SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to save item assignments: %v", err))
			return
		}
	}

	SendJSONWithStatus(ctx, map[string]any{"item": marketplaceItemResponse(item, true)}, fasthttp.StatusCreated)
}

func (h *MarketplaceHandler) syncItem(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}
	if item.SourceType != schemas.MarketplaceImportSourceGitHub &&
		item.SourceType != schemas.MarketplaceImportSourceGitLab &&
		item.SourceType != schemas.MarketplaceImportSourceCatalog {
		SendError(ctx, fasthttp.StatusBadRequest, "Only github, gitlab, and catalog items can be synced")
		return
	}
	if strings.TrimSpace(item.RemoteURL) == "" {
		SendError(ctx, fasthttp.StatusBadRequest, "Item has no remote_url configured")
		return
	}

	token := strings.TrimSpace(string(ctx.Request.Header.Peek("X-Marketplace-Git-Token")))
	if token == "" {
		token = h.resolveGitTokenForImport(ctx, item.SourceType, "")
	}
	var importResult *marketplace.ImportResult
	if item.SourceType == schemas.MarketplaceImportSourceCatalog {
		importResult, err = marketplace.ImportFromRemoteCatalog(
			item.RemoteURL,
			item.RemoteRef,
			token,
			marketplace.ImportOptions{
				Name:        item.Name,
				ItemType:    item.ItemType,
				Platform:    item.Platform,
				Description: item.Description,
				Version:     item.Version,
			},
		)
	} else {
		importResult, err = marketplace.ImportFromGitRemote(
			item.RemoteURL,
			item.RemoteRef,
			token,
			item.SourceType,
			marketplace.ImportOptions{
				Name:        item.Name,
				ItemType:    item.ItemType,
				Platform:    item.Platform,
				Description: item.Description,
				Version:     item.Version,
			},
		)
	}
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	item.Content = importResult.Bundle
	if strings.TrimSpace(importResult.Description) != "" {
		item.Description = importResult.Description
	}
	if strings.TrimSpace(importResult.Version) != "" {
		item.Version = importResult.Version
	}
	if len(importResult.IconData) > 0 {
		applyMarketplaceIconFromImport(item, importResult.IconData, importResult.IconMediaType)
	}

	if err := h.configStore.UpdateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to sync marketplace item: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"item": marketplaceItemResponse(item, true)})
}

func firstFormValue(form *multipart.Form, key string) string {
	if form == nil {
		return ""
	}
	values := form.Value[key]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func splitFormTags(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	tags := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			tags = append(tags, part)
		}
	}
	return tags
}

func readMultipartFile(fileHeader *multipart.FileHeader) ([]byte, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("open uploaded file: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("read uploaded file: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("uploaded file is empty")
	}
	return data, nil
}

func coalesceNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseMarketplaceAssignmentForm(form *multipart.Form) *schemas.MarketplaceItemAssignmentsUpdate {
	if form == nil {
		return nil
	}
	if assignmentsJSON := strings.TrimSpace(firstFormValue(form, "assignments")); assignmentsJSON != "" {
		var update schemas.MarketplaceItemAssignmentsUpdate
		if err := json.Unmarshal([]byte(assignmentsJSON), &update); err == nil {
			return &update
		}
	}
	usersRaw := strings.TrimSpace(firstFormValue(form, "assign_users"))
	deptsRaw := strings.TrimSpace(firstFormValue(form, "assign_departments"))
	if usersRaw == "" && deptsRaw == "" {
		return nil
	}
	return &schemas.MarketplaceItemAssignmentsUpdate{
		Users:       splitFormList(usersRaw),
		Departments: splitFormList(deptsRaw),
	}
}

func splitFormList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (h *MarketplaceHandler) serveItemIcon(ctx *fasthttp.RequestCtx) {
	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}
	if !item.Enabled {
		SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
		return
	}
	if strings.TrimSpace(item.IconURL) != "" {
		ctx.Redirect(item.IconURL, fasthttp.StatusFound)
		return
	}
	data, mediaType, ok := decodeMarketplaceIcon(item)
	if !ok {
		SendError(ctx, fasthttp.StatusNotFound, "Icon not found")
		return
	}
	ctx.Response.Header.SetContentType(mediaType)
	ctx.SetStatusCode(fasthttp.StatusOK)
	ctx.SetBody(data)
}

func (h *MarketplaceHandler) uploadItemIcon(ctx *fasthttp.RequestCtx) {
	if !requireLocalAdmin(ctx, h.configStore) {
		SendError(ctx, fasthttp.StatusForbidden, "Admin access required")
		return
	}

	id, err := parseUintPathParam(ctx, "id")
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid item id")
		return
	}

	item, err := h.configStore.GetMarketplaceItemByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			SendError(ctx, fasthttp.StatusNotFound, "Marketplace item not found")
			return
		}
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to get marketplace item: %v", err))
		return
	}

	form, err := ctx.MultipartForm()
	if err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, "Invalid multipart form")
		return
	}
	if err := applyMarketplaceIconFromForm(item, form); err != nil {
		SendError(ctx, fasthttp.StatusBadRequest, err.Error())
		return
	}

	if err := h.configStore.UpdateMarketplaceItem(ctx, item); err != nil {
		SendError(ctx, fasthttp.StatusInternalServerError, fmt.Sprintf("Failed to update marketplace item icon: %v", err))
		return
	}

	SendJSON(ctx, map[string]any{"item": marketplaceItemResponse(item, false)})
}
