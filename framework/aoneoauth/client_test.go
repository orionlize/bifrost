package aoneoauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMeResponseUnmarshalNumericHiredDate(t *testing.T) {
	payload := `{
		"success": true,
		"data": {
			"user": {
				"id": "1",
				"email": "user@example.com",
				"name": "User",
				"avatar": "",
				"status": "ACTIVE",
				"emailVerified": true,
				"createdAt": "2024-01-01T00:00:00.000Z"
			},
			"dingtalk": {
				"profile": {
					"name": "钉钉姓名",
					"title": "职位",
					"mobile": "13800000000",
					"workPlace": "杭州",
					"jobNumber": "1001",
					"hiredDate": 1704067200000,
					"telephone": "1234",
					"orgEmail": "user@corp.com",
					"avatar": "https://example.com/avatar.png"
				},
				"departments": [
					{ "deptId": 1, "name": "根部门" }
				],
				"syncedAt": "2024-01-01T00:00:00.000Z"
			},
			"application": {
				"id": "app-1",
				"name": "App",
				"logo": "https://example.com/logo.png"
			}
		},
		"timestamp": "2024-01-01T00:00:00.000Z"
	}`

	var wrapped apiResponse[MeResponse]
	if err := json.Unmarshal([]byte(payload), &wrapped); err != nil {
		t.Fatalf("unmarshal me response: %v", err)
	}
	if wrapped.Data.Dingtalk == nil {
		t.Fatal("expected dingtalk info")
	}
	if got := string(wrapped.Data.Dingtalk.Profile.HiredDate); got != "1704067200000" {
		t.Fatalf("hiredDate = %q, want %q", got, "1704067200000")
	}
}

func TestMeResponseUnmarshalNumericCreatedAt(t *testing.T) {
	payload := `{
		"success": true,
		"data": {
			"user": {
				"id": "1",
				"email": "user@example.com",
				"name": "User",
				"avatar": "",
				"status": "ACTIVE",
				"emailVerified": true,
				"createdAt": 1704067200000
			},
			"application": { "id": "app-1", "name": "App", "logo": "" }
		}
	}`

	var wrapped apiResponse[MeResponse]
	if err := json.Unmarshal([]byte(payload), &wrapped); err != nil {
		t.Fatalf("unmarshal me response: %v", err)
	}
	if got := string(wrapped.Data.User.CreatedAt); got != "1704067200000" {
		t.Fatalf("createdAt = %q, want %q", got, "1704067200000")
	}
}

func TestFetchMeSuccess(t *testing.T) {
	payload := `{"success":true,"data":{"user":{"id":"u-1","email":"a@b.com","name":"Alice","status":"ACTIVE","emailVerified":true},"application":{"id":"app","name":"App","logo":""}},"timestamp":"2024-01-01T00:00:00.000Z"}`
	srv := httptestServer(t, payload, 200)
	defer srv.Close()

	client := NewClient(srv.URL)
	result, err := client.FetchMe(t.Context(), "access-token")
	if err != nil {
		t.Fatalf("FetchMe: %v", err)
	}
	if result.URL != srv.URL+"/api/oauth2/me" {
		t.Fatalf("url = %q", result.URL)
	}
	if result.Me == nil || result.Me.User.ID != "u-1" {
		t.Fatalf("unexpected me payload: %+v", result.Me)
	}
}

func TestFetchMeHTTPError(t *testing.T) {
	srv := httptestServer(t, `{"success":false}`, 401)
	defer srv.Close()

	client := NewClient(srv.URL)
	result, err := client.FetchMe(t.Context(), "bad-token")
	if err == nil {
		t.Fatal("expected error")
	}
	if result == nil || result.StatusCode != 401 {
		t.Fatalf("result = %+v", result)
	}
}

func httptestServer(t *testing.T, body string, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/oauth2/me" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Fatalf("missing bearer authorization")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}
