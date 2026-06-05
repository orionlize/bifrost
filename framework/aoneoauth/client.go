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
	ID            string         `json:"id"`
	Email         string         `json:"email"`
	Name          string         `json:"name"`
	Avatar        string         `json:"avatar"`
	Status        string         `json:"status"`
	EmailVerified bool           `json:"emailVerified"`
	CreatedAt     flexibleString `json:"createdAt"`
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
	DeptID      int    `json:"deptId"`
	Name        string `json:"name"`
	ParentDeptID *int  `json:"parentDeptId,omitempty"`
	FullPath    string `json:"fullPath,omitempty"`
	PathDeptIDs []int  `json:"pathDeptIds,omitempty"`
}

// OrganizationDepartment holds a node in the full Aone organization tree.
type OrganizationDepartment struct {
	DeptID       int    `json:"deptId"`
	Name         string `json:"name"`
	ParentDeptID int    `json:"parentDeptId"`
	Order        int    `json:"order,omitempty"`
}

// OrganizationInfo holds the full organization structure from Aone OAuth.
type OrganizationInfo struct {
	Departments []OrganizationDepartment `json:"departments"`
	SyncedAt    flexibleString           `json:"syncedAt"`
}

// DingtalkInfo holds DingTalk linkage details for a user.
type DingtalkInfo struct {
	Profile                 DingtalkProfile                `json:"profile"`
	DepartmentPaths         DingtalkDepartmentPaths        `json:"-"`
	DepartmentAssignments   []DingtalkDepartmentAssignment `json:"-"`
	Departments             []DingtalkDepartment           `json:"departments"`
	SyncedAt                flexibleString                 `json:"syncedAt"`
}

// UnmarshalJSON parses departments as multiple org paths or legacy flat arrays.
func (d *DingtalkInfo) UnmarshalJSON(data []byte) error {
	type alias struct {
		Profile     DingtalkProfile `json:"profile"`
		Departments json.RawMessage `json:"departments"`
		SyncedAt    flexibleString  `json:"syncedAt"`
	}
	var raw alias
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	d.Profile = raw.Profile
	d.SyncedAt = raw.SyncedAt
	if len(raw.Departments) == 0 || string(raw.Departments) == "null" {
		d.Departments = nil
		d.DepartmentPaths = DingtalkDepartmentPaths{}
		return nil
	}
	assignments, paths, err := parseDepartmentsJSON(raw.Departments)
	if err != nil {
		return err
	}
	d.DepartmentPaths = DingtalkDepartmentPaths{Paths: paths}
	d.DepartmentAssignments = assignments
	d.Departments = nil
	return nil
}

// MarshalJSON writes departments in the upstream oauth2/me wire format.
func (d DingtalkInfo) MarshalJSON() ([]byte, error) {
	type alias struct {
		Profile     DingtalkProfile `json:"profile"`
		Departments json.RawMessage `json:"departments"`
		SyncedAt    flexibleString  `json:"syncedAt"`
	}
	deptJSON, err := marshalDepartmentsWire(d.DepartmentAssignments, d.DepartmentPaths.Paths)
	if err != nil {
		return nil, err
	}
	return json.Marshal(alias{
		Profile:     d.Profile,
		Departments: deptJSON,
		SyncedAt:    d.SyncedAt,
	})
}

// DepartmentsForResponse returns departments in oauth2/me wire shape for API handlers.
func (d DingtalkInfo) DepartmentsForResponse() any {
	if len(d.DepartmentAssignments) > 0 {
		return d.DepartmentAssignments
	}
	if len(d.DepartmentPaths.Paths) == 0 {
		if len(d.Departments) == 0 {
			return []DingtalkDepartment{}
		}
		return d.Departments
	}
	if len(d.DepartmentPaths.Paths) == 1 {
		chain := make([]DingtalkDepartment, len(d.DepartmentPaths.Paths[0]))
		for i, dept := range d.DepartmentPaths.Paths[0] {
			chain[i] = stripDepartmentForWire(dept)
		}
		return chain
	}
	nested := make([][]DingtalkDepartment, len(d.DepartmentPaths.Paths))
	for i, path := range d.DepartmentPaths.Paths {
		nested[i] = make([]DingtalkDepartment, len(path))
		for j, dept := range path {
			nested[i][j] = stripDepartmentForWire(dept)
		}
	}
	return nested
}

// ApplicationInfo holds the OAuth application metadata.
type ApplicationInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Logo string `json:"logo"`
}

// MeResponse holds the /api/oauth2/me payload.
type MeResponse struct {
	User         UserProfile       `json:"user"`
	Dingtalk     *DingtalkInfo     `json:"dingtalk"`
	Organization *OrganizationInfo `json:"organization"`
	Application  ApplicationInfo   `json:"application"`
}

// MeFetchResult captures the upstream oauth2/me HTTP exchange for debugging.
type MeFetchResult struct {
	URL        string
	StatusCode int
	RawBody    string
	Me         *MeResponse
	ParseError string
}

// MeURL returns the fully qualified oauth2/me endpoint for this client.
func (c *Client) MeURL() string {
	return c.baseURL + "/api/oauth2/me"
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
	var buf strings.Builder
	buf.WriteString(c.baseURL)
	buf.WriteString("/oauth2/authorize?")
	buf.WriteString("client_id=")
	buf.WriteString(url.QueryEscape(clientID))
	buf.WriteString("&redirect_uri=")
	buf.WriteString(url.QueryEscape(redirectURI))
	buf.WriteString("&response_type=code&state=")
	buf.WriteString(url.QueryEscape(state))
	return buf.String()
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
	result, err := c.FetchMe(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return result.Me, nil
}

// FetchMe performs the upstream oauth2/me request and returns raw response details.
func (c *Client) FetchMe(ctx context.Context, accessToken string) (*MeFetchResult, error) {
	meURL := c.MeURL()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, meURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return &MeFetchResult{URL: meURL}, fmt.Errorf("aone me request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return &MeFetchResult{URL: meURL, StatusCode: resp.StatusCode}, fmt.Errorf("read aone me response: %w", err)
	}

	result := &MeFetchResult{
		URL:        meURL,
		StatusCode: resp.StatusCode,
		RawBody:    string(respBody),
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return result, fmt.Errorf("aone me request failed with status %d: %s", resp.StatusCode, result.RawBody)
	}

	var wrapped apiResponse[MeResponse]
	if err := json.Unmarshal(respBody, &wrapped); err != nil {
		result.ParseError = err.Error()
		return result, fmt.Errorf("failed to decode aone me response: %w", err)
	}
	if !wrapped.Success {
		result.ParseError = "success=false"
		return result, fmt.Errorf("aone me request returned success=false")
	}
	result.Me = &wrapped.Data
	return result, nil
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
