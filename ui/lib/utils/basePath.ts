declare global {
	interface Window {
		/** Injected by the Go server from runtime BIFROST_BASE_PATH when serving index.html. */
		__BIFROST_BASE_PATH__?: string;
	}
}

/** Canonical HTTP path prefix for subpath deployments (for example `/zai`). */
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

/** Base path for subpath deployments (runtime injection, Vite base, or build-time env). */
export function getBasePath(): string {
	if (typeof window !== "undefined") {
		const runtime = normalizeBasePath(window.__BIFROST_BASE_PATH__);
		if (runtime) {
			return runtime;
		}
	}
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
