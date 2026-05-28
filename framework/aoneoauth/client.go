package aoneoauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const requestTimeout = 30 * time.Second

// TokenResponse holds tokens returned by Aone OAuth2 token endpoints.
type TokenResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	TokenType    string `json:"tokenType"`
	ExpiresIn    int    `json:"expiresIn"`
}

type apiResponse[T any] struct {
	Success   bool   `json:"success"`
	Data      T      `json:"data"`
	Timestamp string `json:"timestamp"`
}

// UserProfile holds basic user information from Aone.
type UserProfile struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	Name          string `json:"name"`
	Avatar        string `json:"avatar"`
	Status        string `json:"status"`
	EmailVerified bool   `json:"emailVerified"`
	CreatedAt     string `json:"createdAt"`
}

// flexibleString unmarshals JSON string or number values into a string.
type flexibleString string

func (s *flexibleString) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*s = ""
		return nil
	}
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		*s = flexibleString(str)
		return nil
	}
	var num json.Number
	if err := json.Unmarshal(data, &num); err == nil {
		*s = flexibleString(num.String())
		return nil
	}
	return fmt.Errorf("flexibleString: unsupported JSON value %s", string(data))
}

// DingtalkProfile holds DingTalk profile details when the user is linked.
type DingtalkProfile struct {
	Name      string         `json:"name"`
	Title     string         `json:"title"`
	Mobile    string         `json:"mobile"`
	WorkPlace string         `json:"workPlace"`
	JobNumber string         `json:"jobNumber"`
	HiredDate flexibleString `json:"hiredDate"`
	Telephone string         `json:"telephone"`
	OrgEmail  string         `json:"orgEmail"`
	Avatar    string         `json:"avatar"`
}

// DingtalkDepartment holds a DingTalk department entry.
type DingtalkDepartment struct {
	DeptID int    `json:"deptId"`
	Name   string `json:"name"`
}

// DingtalkInfo holds DingTalk linkage details for a user.
type DingtalkInfo struct {
	Profile     DingtalkProfile      `json:"profile"`
	Departments []DingtalkDepartment `json:"departments"`
	SyncedAt    string               `json:"syncedAt"`
}

// ApplicationInfo holds the OAuth application metadata.
type ApplicationInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Logo string `json:"logo"`
}

// MeResponse holds the /api/oauth2/me payload.
type MeResponse struct {
	User        UserProfile     `json:"user"`
	Dingtalk    *DingtalkInfo   `json:"dingtalk"`
	Application ApplicationInfo `json:"application"`
}

// Client communicates with an external Aone OAuth2 provider.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a client for the given Aone base URL (e.g. https://host/aone).
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: requestTimeout,
		},
	}
}

// AuthorizeURL builds the OAuth2 authorization URL for the authorization code flow.
func (c *Client) AuthorizeURL(clientID, redirectURI, state string) string {
	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	params.Set("state", state)
	return c.baseURL + "/oauth2/authorize?" + params.Encode()
}

// ExchangeAuthorizationCode exchanges an authorization code for access and refresh tokens.
func (c *Client) ExchangeAuthorizationCode(ctx context.Context, code, clientID, clientSecret, redirectURI string) (*TokenResponse, error) {
	body := map[string]string{
		"code":         code,
		"clientId":     clientID,
		"clientSecret": clientSecret,
		"redirectUri":  redirectURI,
		"grantType":    "authorization_code",
	}
	return c.postToken(ctx, "/api/oauth2/token", body)
}

// RefreshAccessToken refreshes an access token using a refresh token.
func (c *Client) RefreshAccessToken(ctx context.Context, refreshToken, clientID, clientSecret string) (*TokenResponse, error) {
	body := map[string]string{
		"refreshToken": refreshToken,
		"clientId":     clientID,
		"clientSecret": clientSecret,
		"grantType":    "refresh_token",
	}
	return c.postToken(ctx, "/api/oauth2/token/refresh", body)
}

// GetMe fetches the current user profile using an access token.
func (c *Client) GetMe(ctx context.Context, accessToken string) (*MeResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/oauth2/me", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("aone me request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	var wrapped apiResponse[MeResponse]
	if err := json.Unmarshal(respBody, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to decode aone me response: %w", err)
	}
	if !wrapped.Success {
		return nil, fmt.Errorf("aone me request returned success=false")
	}
	return &wrapped.Data, nil
}

func (c *Client) postToken(ctx context.Context, path string, body map[string]string) (*TokenResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("aone token request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	var wrapped apiResponse[TokenResponse]
	if err := json.Unmarshal(respBody, &wrapped); err != nil {
		return nil, fmt.Errorf("failed to decode aone token response: %w", err)
	}
	if !wrapped.Success {
		return nil, fmt.Errorf("aone token request returned success=false")
	}
	return &wrapped.Data, nil
}
