/** Canonical HTTP path prefix for subpath deployments (for example `/bifrost`). */
export function normalizeBasePath(path: string | undefined): string {
	if (!path || path === "/") {
		return "";
	}
	let normalized = path.trim();
	if (!normalized.startsWith("/")) {
		normalized = `/${normalized}`;
	}
	return normalized.replace(/\/+$/, "");
}

/** Build-time base path injected by Vite from BIFROST_BASE_PATH. */
export function getBasePath(): string {
	return normalizeBasePath(process.env.BIFROST_BASE_PATH ?? "");
}

/** Join a base path with a root-relative endpoint. */
export function withBasePath(endpoint: string): string {
	const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
	const basePath = getBasePath();
	return basePath ? `${basePath}${cleanEndpoint}` : cleanEndpoint;
}
