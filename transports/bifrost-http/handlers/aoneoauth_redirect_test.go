package handlers

import "testing"

func TestParseAoneOAuthReturnTo(t *testing.T) {
	redirectURI := "http://localhost:8080/api/aone/oauth/callback"
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "empty defaults to workspace", raw: "", want: "/workspace"},
		{name: "relative workspace path", raw: "/workspace", want: "/workspace"},
		{name: "dev frontend origin", raw: "http://localhost:3000/workspace", want: "http://localhost:3000/workspace"},
		{name: "reject external origin", raw: "https://evil.example.com/workspace", want: "/workspace"},
		{name: "reject non workspace path", raw: "http://localhost:3000/login", want: "/workspace"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseAoneOAuthReturnTo(tt.raw, redirectURI)
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAoneOAuthLoginRedirectUsesFrontendOrigin(t *testing.T) {
	got := aoneOAuthLoginRedirect("http://localhost:3000/workspace", "failed")
	want := "http://localhost:3000/login?error=failed"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAoneOAuthStateStoreReturnTo(t *testing.T) {
	store := NewAoneOAuthStateStore()
	defer store.Stop()

	state, err := store.Issue("http://localhost:3000/workspace")
	if err != nil {
		t.Fatalf("issue state: %v", err)
	}
	returnTo, ok := store.Consume(state)
	if !ok {
		t.Fatal("expected state to be consumable")
	}
	if returnTo != "http://localhost:3000/workspace" {
		t.Fatalf("returnTo = %q", returnTo)
	}
}
