package aoneoauth

import (
	"encoding/json"
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
