import { Outlet, createRootRoute } from "@tanstack/react-router";

/**
 * Root route. Intentionally minimal — does NOT wrap children in providers,
 * because the existing nested layouts (app/workspace/layout.tsx →
 * ClientLayout, app/login/layout.tsx, app/pprof/layout.tsx) each set up
 * their own ThemeProvider / ReduxProvider / NuqsAdapter / etc.
 *
 * I18nProvider lives in main.tsx (above RouterProvider) so default error/not-found
 * components and all routes share the same i18n context.
 *
 * If/when we consolidate provider setup, the remaining providers can move here.
 */
export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return <Outlet />;
}