package handlers

import (
	"testing"

	"github.com/valyala/fasthttp"
)

func TestBuildOAuthCallbackRedirectURIStripsPostLoginQuery(t *testing.T) {
	base := "http://localhost:8080/api/aone/oauth/callback?post_login_redirect=https%3A%2F%2Fapp.example.com%2Fcallback"
	got := buildOAuthCallbackRedirectURI(base)
	want := "http://localhost:8080/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildOAuthCallbackRedirectURIIgnoresPostLoginRedirectArg(t *testing.T) {
	base := "http://localhost:8080/api/aone/oauth/callback"
	got := buildOAuthCallbackRedirectURI(base)
	want := "http://localhost:8080/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestExtractPostLoginRedirectFromCallback(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.URI().SetQueryString("code=abc&state=xyz&post_login_redirect=https%3A%2F%2Fapp.example.com%2Fcb")
	got := extractPostLoginRedirectFromCallback(ctx, "")
	want := "https://app.example.com/cb"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParseAoneOAuthReturnTo(t *testing.T) {
	redirectURI := "http://localhost:8080/api/aone/oauth/callback"
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "empty defaults to workspace", raw: "", want: "/workspace"},
		{name: "relative workspace path", raw: "/workspace", want: "/workspace"},
		{name: "dev frontend origin", raw: "http://localhost:8080/workspace", want: "http://localhost:8080/workspace"},
		{name: "login complete handoff", raw: "http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb", want: "http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb"},
		{name: "reject external origin", raw: "https://evil.example.com/workspace", want: "/workspace"},
		{name: "reject non workspace path", raw: "http://localhost:8080/login", want: "/workspace"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseAoneOAuthReturnTo(tt.raw, redirectURI, "")
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestValidateLoginRedirectURI(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "external https", raw: "https://app.example.com/callback", want: "https://app.example.com/callback"},
		{name: "workspace path", raw: "/workspace/quick-start", want: "/workspace/quick-start"},
		{name: "reject protocol relative", raw: "//evil.example.com", want: ""},
		{name: "reject oauth callback path", raw: "http://localhost:8080/api/aone/oauth/callback", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := validateLoginRedirectURI(tt.raw, "")
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAoneOAuthLoginRedirectUsesFrontendOrigin(t *testing.T) {
	got := aoneOAuthLoginRedirect("http://localhost:8080/workspace", "", "", "failed", "/bifrost")
	want := "http://localhost:8080/bifrost/login?error=failed"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAoneOAuthLoginRedirectPreservesRedirectURI(t *testing.T) {
	got := aoneOAuthLoginRedirect("", "https://app.example.com/callback", "", "failed", "/bifrost")
	want := "/bifrost/login?error=failed&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAoneOAuthLoginRedirectPreservesZwtichSource(t *testing.T) {
	got := aoneOAuthLoginRedirect("", "", loginSourceZwitch, "failed", "/bifrost")
	want := "/bifrost/login?error=failed&source=zwitch"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestExtractRedirectURIFromLoginCompleteReturnTo(t *testing.T) {
	got := extractRedirectURIFromLoginCompleteReturnTo("http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb", "")
	want := "https://app.example.com/cb"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveAuthorizeReturnToPrefersClientReturnTo(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/login")
	returnTo := "http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb"
	redirectURI := "https://app.example.com/cb"
	got := resolveAuthorizeReturnTo(ctx, returnTo, redirectURI, "")
	if got != returnTo {
		t.Fatalf("got %q, want %q", got, returnTo)
	}
}

func TestExtractRedirectURIFromLoginReferer(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/login?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback")
	got := extractRedirectURIFromLoginReferer(ctx, "")
	want := "https://app.example.com/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolvePostLoginRedirectURIPrefersExplicitParam(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.URI().SetQueryString("redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&return_to=http%3A%2F%2Flocalhost%3A8080%2Fworkspace")
	got := resolvePostLoginRedirectURI(ctx, "")
	want := "https://app.example.com/cb"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAoneOAuthStateStoreRecoversEmbeddedRedirectWithoutEntry(t *testing.T) {
	store := NewAoneOAuthStateStore()
	defer store.Stop()

	state := encodeAoneOAuthState("deadbeef", "https://app.example.com/callback")
	returnTo, redirectURI, oauthRedirectURI, loginSource, _, ok := store.Consume(state)
	if !ok {
		t.Fatal("expected embedded redirect to be recoverable")
	}
	if redirectURI != "https://app.example.com/callback" {
		t.Fatalf("redirectURI = %q", redirectURI)
	}
	if oauthRedirectURI != "" {
		t.Fatalf("oauthRedirectURI = %q, want empty without stored entry", oauthRedirectURI)
	}
	if loginSource != "" {
		t.Fatalf("loginSource = %q, want empty without stored entry", loginSource)
	}
	if returnTo != "/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback" {
		t.Fatalf("returnTo = %q", returnTo)
	}
}

func TestAoneOAuthStateStoreReturnTo(t *testing.T) {
	store := NewAoneOAuthStateStore()
	defer store.Stop()

	oauthRedirectURI := "http://localhost:8080/api/aone/oauth/callback"
	state, err := store.Issue("http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback", "https://app.example.com/callback", oauthRedirectURI, "", "")
	if err != nil {
		t.Fatalf("issue state: %v", err)
	}
	returnTo, redirectURI, storedOAuthRedirectURI, loginSource, _, ok := store.Consume(state)
	if !ok {
		t.Fatal("expected state to be consumable")
	}
	if loginSource != "" {
		t.Fatalf("loginSource = %q", loginSource)
	}
	if returnTo != "http://localhost:8080/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback" {
		t.Fatalf("returnTo = %q", returnTo)
	}
	if redirectURI != "https://app.example.com/callback" {
		t.Fatalf("redirectURI = %q", redirectURI)
	}
	if storedOAuthRedirectURI != oauthRedirectURI {
		t.Fatalf("oauthRedirectURI = %q", storedOAuthRedirectURI)
	}
}

func TestResolveOAuthRedirectURIUsesConfiguredCallback(t *testing.T) {
	got := buildOAuthCallbackRedirectURI("http://localhost:8080/api/aone/oauth/callback")
	want := "http://localhost:8080/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildZwtichOAuthCallbackURI(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/login?source=zwitch")
	ctx.Request.SetHost("localhost:8080")
	got := buildZwitchOAuthCallbackURI(ctx, "http://localhost:8080/api/aone/oauth/callback", "")
	want := "http://localhost:8080/api/aone/oauth/zwitch/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestValidateZwitchOAuthCallbackURIUpgradesRemoteHTTP(t *testing.T) {
	got := validateZwitchOAuthCallbackURI("http://ft-app.wxhand.com/zai/api/aone/oauth/zwitch/callback", "/zai")
	want := "https://ft-app.wxhand.com/zai/api/aone/oauth/zwitch/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveZwitchOAuthRedirectURIPrefersExplicitHTTPS(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.URI().SetQueryString("source=zwitch&redirect_uri=https%3A%2F%2Fft-app.wxhand.com%2Fzai%2Fapi%2Faone%2Foauth%2Fzwitch%2Fcallback")
	got := resolveZwitchOAuthRedirectURI(ctx, "http://ft-app.wxhand.com/zai/api/aone/oauth/callback", "/zai")
	want := "https://ft-app.wxhand.com/zai/api/aone/oauth/zwitch/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildZwtichDeeplink(t *testing.T) {
	got := buildZwitchDeeplink("token-123", "http://localhost:8080")
	want := "zwitch://open?access_token=token-123&base_url=http%3A%2F%2Flocalhost%3A8080"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveDashboardReturnTo(t *testing.T) {
	tests := []struct {
		name             string
		returnTo         string
		dashboardOrigin  string
		want             string
	}{
		{
			name:            "absolute return unchanged",
			returnTo:        "http://localhost:8080/workspace",
			dashboardOrigin: "http://localhost:3000",
			want:            "http://localhost:8080/workspace",
		},
		{
			name:            "relative path uses dashboard origin",
			returnTo:        "/workspace",
			dashboardOrigin: "http://localhost:3000",
			want:            "http://localhost:3000/workspace",
		},
		{
			name:            "login complete keeps query on dashboard origin",
			returnTo:        "/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb",
			dashboardOrigin: "http://localhost:3000",
			want:            "http://localhost:3000/login/complete?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb",
		},
		{
			name:            "missing origin keeps relative path",
			returnTo:        "/workspace",
			dashboardOrigin: "",
			want:            "/workspace",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveDashboardReturnTo(tt.returnTo, tt.dashboardOrigin, "")
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDashboardOriginPrefersReferer(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:3000/login")
	ctx.Request.SetHost("localhost:8080")
	got := dashboardOrigin(ctx)
	want := "http://localhost:3000"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildZwtichSuccessReturnTo(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/login?source=zwitch")
	ctx.Request.SetHost("localhost:8080")
	got := buildZwitchSuccessReturnTo(ctx, "token-123", "http://localhost:8080/api/aone/oauth/callback", "")
	want := "http://localhost:8080/login/zwitch/success?access_token=token-123&base_url=http%3A%2F%2Flocalhost%3A8080"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBifrostAPIOriginPrefersRequestHost(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/login")
	ctx.Request.SetHost("localhost:8080")
	got := bifrostAPIOrigin(ctx, "http://localhost:8080/api/aone/oauth/callback")
	want := "http://localhost:8080"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBifrostAPIOriginRewritesLegacyLocalhostPort(t *testing.T) {
	got := bifrostAPIOrigin(&fasthttp.RequestCtx{}, "http://localhost:3000/api/aone/oauth/callback")
	want := "http://localhost:8080"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveAoneOAuthCallbackBaseURIRewritesLegacyLocalhostPort(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetHost("localhost:8080")
	got := resolveAoneOAuthCallbackBaseURI(ctx, "http://localhost:3000/api/aone/oauth/callback", "")
	want := "http://localhost:8080/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBuildOAuthCallbackRedirectURIUsesNormalizedBase(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetHost("localhost:8080")
	base := resolveAoneOAuthCallbackBaseURI(ctx, "http://localhost:3000/api/aone/oauth/callback", "")
	got := buildOAuthCallbackRedirectURI(base)
	want := "http://localhost:8080/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveEffectiveBasePathConfiguredZai(t *testing.T) {
	got := resolveEffectiveBasePath("/zai", nil, "http://localhost:8080/workspace/api/aone/oauth/callback")
	if got != "/zai" {
		t.Fatalf("got %q, want /zai", got)
	}
	got = resolveAoneOAuthSuccessReturnTo(&fasthttp.RequestCtx{}, "/workspace", "", "/zai")
	if got != "/zai/workspace" {
		t.Fatalf("success return got %q, want /zai/workspace", got)
	}
}

func TestResolveEffectiveBasePathFromCallbackURI(t *testing.T) {
	got := resolveEffectiveBasePath("", nil, "http://localhost:8080/bifrost/api/aone/oauth/callback")
	if got != "/bifrost" {
		t.Fatalf("got %q, want /bifrost", got)
	}
	got = resolveEffectiveBasePath("", nil, "http://localhost:8080/zai/api/aone/oauth/callback")
	if got != "/zai" {
		t.Fatalf("got %q, want /zai", got)
	}
}

func TestResolveEffectiveBasePathFromReferer(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/bifrost/login")
	got := resolveEffectiveBasePath("", ctx, "")
	if got != "/bifrost" {
		t.Fatalf("got %q, want /bifrost", got)
	}
}

func TestResolveEffectiveBasePathFromForwardedPrefix(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("X-Forwarded-Prefix", "/bifrost")
	got := resolveEffectiveBasePath("", ctx, "")
	if got != "/bifrost" {
		t.Fatalf("got %q, want /bifrost", got)
	}
}

func TestResolveLoginSource(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.URI().SetQueryString("source=zwitch")
	if got := resolveLoginSource(ctx, ""); got != loginSourceZwitch {
		t.Fatalf("got %q, want %q", got, loginSourceZwitch)
	}
}

func TestValidateLoginRedirectURIRejectsZwitchCallback(t *testing.T) {
	got := validateLoginRedirectURI("http://localhost:8080/api/aone/oauth/zwitch/callback", "")
	if got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}

func TestResolveDashboardReturnToWithBasePath(t *testing.T) {
	got := resolveDashboardReturnTo("/workspace", "http://localhost:8080", "/bifrost")
	want := "http://localhost:8080/bifrost/workspace"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestParseAoneOAuthReturnToAppliesBasePath(t *testing.T) {
	redirectURI := "http://localhost:8080/bifrost/api/aone/oauth/callback"
	got := parseAoneOAuthReturnTo("http://localhost:8080/workspace", redirectURI, "/bifrost")
	want := "http://localhost:8080/bifrost/workspace"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveAoneOAuthSuccessReturnToAppliesBasePath(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	got := resolveAoneOAuthSuccessReturnTo(ctx, "/workspace", "", "/bifrost")
	want := "/bifrost/workspace"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestDefaultAppReturnTo(t *testing.T) {
	if got, want := defaultAppReturnTo("/bifrost"), "/bifrost/workspace"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got, want := defaultAppReturnTo(""), "/workspace"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveAoneOAuthCallbackBaseURIWithBasePath(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetHost("localhost:8080")
	got := resolveAoneOAuthCallbackBaseURI(ctx, "http://localhost:8080/api/aone/oauth/callback", "/bifrost")
	want := "http://localhost:8080/bifrost/api/aone/oauth/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestExtractRedirectURIFromLoginRefererWithBasePath(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/bifrost/login?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback")
	got := extractRedirectURIFromLoginReferer(ctx, "/bifrost")
	want := "https://app.example.com/callback"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestAuthorizeFlowDefaultReturnToWithInferredBasePath(t *testing.T) {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Referer", "http://localhost:8080/bifrost/login")
	basePath := resolveEffectiveBasePath("", ctx, "http://localhost:8080/bifrost/api/aone/oauth/callback")
	got := ensureSubpathRedirect(basePath, defaultAoneOAuthReturnTo)
	want := "/bifrost/workspace"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
