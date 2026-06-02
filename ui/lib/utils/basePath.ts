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

/** Base path for subpath deployments (from Vite `base` / BIFROST_BASE_PATH at build time). */
export function getBasePath(): string {
	const fromVite = normalizeBasePath(import.meta.env.BASE_URL);
	if (fromVite) {
		return fromVite;
	}
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
