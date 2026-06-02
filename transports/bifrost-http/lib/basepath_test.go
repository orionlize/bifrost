package lib

import "testing"

func TestNormalizeBasePath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "root slash", input: "/", want: ""},
		{name: "trimmed", input: "  /bifrost/  ", want: "/bifrost"},
		{name: "missing leading slash", input: "bifrost", want: "/bifrost"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := NormalizeBasePath(tc.input); got != tc.want {
				t.Fatalf("NormalizeBasePath(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestStripBasePath(t *testing.T) {
	if got := StripBasePath("/bifrost", "/bifrost/login"); got != "/login" {
		t.Fatalf("StripBasePath = %q, want /login", got)
	}
	if got := StripBasePath("", "/login"); got != "/login" {
		t.Fatalf("StripBasePath empty base = %q, want /login", got)
	}
}

func TestWithBasePath(t *testing.T) {
	if got := WithBasePath("/bifrost", "/workspace"); got != "/bifrost/workspace" {
		t.Fatalf("WithBasePath = %q, want /bifrost/workspace", got)
	}
	if got := WithBasePath("/bifrost", "/login/complete?redirect_uri=x"); got != "/bifrost/login/complete?redirect_uri=x" {
		t.Fatalf("WithBasePath query = %q", got)
	}
	if got := WithBasePath("/bifrost", "/bifrost/workspace"); got != "/bifrost/workspace" {
		t.Fatalf("WithBasePath idempotent = %q", got)
	}
}
