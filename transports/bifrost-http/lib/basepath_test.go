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
