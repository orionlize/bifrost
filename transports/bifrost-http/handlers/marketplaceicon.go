package handlers

import (
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"path"
	"strings"

	"github.com/maximhq/bifrost/framework/configstore/tables"
)

const maxMarketplaceIconBytes = 256 * 1024

var allowedMarketplaceIconExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
	".gif":  "image/gif",
}

func applyMarketplaceIconFromForm(item *tables.TableMarketplaceItem, form *multipart.Form) error {
	if item == nil || form == nil {
		return nil
	}
	if iconURL := strings.TrimSpace(firstFormValue(form, "icon_url")); iconURL != "" {
		item.IconURL = iconURL
		item.IconData = ""
		item.IconMediaType = ""
	}
	if fileHeaders := form.File["icon"]; len(fileHeaders) > 0 {
		if err := applyMarketplaceIconUpload(item, fileHeaders[0]); err != nil {
			return err
		}
	}
	return nil
}

func applyMarketplaceIconUpload(item *tables.TableMarketplaceItem, fileHeader *multipart.FileHeader) error {
	data, err := readMultipartFile(fileHeader)
	if err != nil {
		return err
	}
	if len(data) > maxMarketplaceIconBytes {
		return fmt.Errorf("icon exceeds %d byte limit", maxMarketplaceIconBytes)
	}
	ext := strings.ToLower(path.Ext(fileHeader.Filename))
	mediaType, ok := allowedMarketplaceIconExt[ext]
	if !ok {
		return fmt.Errorf("unsupported icon format; use png, jpg, svg, webp, or gif")
	}
	item.IconURL = ""
	item.IconData = base64.StdEncoding.EncodeToString(data)
	item.IconMediaType = mediaType
	return nil
}

func applyMarketplaceIconFromImport(item *tables.TableMarketplaceItem, iconData []byte, iconMediaType string) {
	if item == nil || len(iconData) == 0 {
		return
	}
	if len(iconData) > maxMarketplaceIconBytes {
		return
	}
	item.IconURL = ""
	item.IconData = base64.StdEncoding.EncodeToString(iconData)
	item.IconMediaType = strings.TrimSpace(iconMediaType)
	if item.IconMediaType == "" {
		item.IconMediaType = "image/png"
	}
}

func marketplaceIconSrc(item *tables.TableMarketplaceItem) string {
	if item == nil {
		return ""
	}
	if strings.TrimSpace(item.IconURL) != "" {
		return strings.TrimSpace(item.IconURL)
	}
	if strings.TrimSpace(item.IconData) != "" {
		return fmt.Sprintf("/api/marketplace/items/%d/icon", item.ID)
	}
	return ""
}

func decodeMarketplaceIcon(item *tables.TableMarketplaceItem) ([]byte, string, bool) {
	if item == nil || strings.TrimSpace(item.IconData) == "" {
		return nil, "", false
	}
	data, err := base64.StdEncoding.DecodeString(item.IconData)
	if err != nil {
		return nil, "", false
	}
	mediaType := strings.TrimSpace(item.IconMediaType)
	if mediaType == "" {
		mediaType = "image/png"
	}
	return data, mediaType, true
}
