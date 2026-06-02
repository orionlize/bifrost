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

/** Strip the configured base path from a browser pathname. */
export function stripBasePath(pathname: string): string {
	const basePath = getBasePath();
	if (!basePath || !pathname.startsWith(basePath)) {
		return pathname;
	}
	const stripped = pathname.slice(basePath.length);
	return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

/** Join a base path with a root-relative endpoint. */
export function withBasePath(endpoint: string): string {
	const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
	const basePath = getBasePath();
	return basePath ? `${basePath}${cleanEndpoint}` : cleanEndpoint;
}
