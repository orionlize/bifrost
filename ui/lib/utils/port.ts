/**
 * Port and URL utility - single source of truth for Bifrost backend connectivity
 *
 * This utility handles:
 * - Development vs Production environment detection
 * - Dynamic port resolution
 * - URL generation for API calls and WebSocket connections
 * - Automatic protocol detection (http/https, ws/wss)
 * - Optional subpath deployments via BIFROST_BASE_PATH
 */

import { getBasePath, withBasePath } from "@/lib/utils/basePath";

interface PortConfig {
	port: string;
	isDevelopment: boolean;
	baseUrl: string;
	wsUrl: string;
	host: string;
}

/**
 * Gets the current port configuration based on environment
 */
function getPortConfig(): PortConfig {
	const isDevelopment = process.env.NODE_ENV === "development";

	if (isDevelopment) {
		// Development mode: Vite dev server runs on different port than Go server
		const port = process.env.BIFROST_PORT || "8080";
		return {
			port,
			isDevelopment: true,
			baseUrl: `http://localhost:${port}`,
			wsUrl: `ws://localhost:${port}`,
			host: `localhost:${port}`,
		};
	} else {
		// Production mode: UI is served by the same Go server
		// Use current window location for automatic port detection
		if (typeof window !== "undefined") {
			const protocol = window.location.protocol === "https:" ? "https:" : "http:";
			const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";

			return {
				port: window.location.port || (window.location.protocol === "https:" ? "443" : "80"),
				isDevelopment: false,
				baseUrl: `${protocol}//${window.location.host}`,
				wsUrl: `${wsProtocol}//${window.location.host}`,
				host: window.location.host,
			};
		} else {
			// Server-side rendering fallback - use relative URLs
			return {
				port: "unknown",
				isDevelopment: false,
				baseUrl: "",
				wsUrl: "",
				host: "",
			};
		}
	}
}

/**
 * Get the current port number as a string
 */
export function getPort(): string {
	return getPortConfig().port;
}

/**
 * Get the base URL for API calls (includes protocol and host)
 */
export function getApiBaseUrl(): string {
	// In the browser, always use same-origin `/api` so session cookies set by the
	// server are included on every request. In dev, Vite proxies `/api` to the Go
	// backend; in prod, the Go server serves both UI and API on one origin.
	if (typeof window !== "undefined") {
		return withBasePath("/api");
	}

	const config = getPortConfig();
	if (config.isDevelopment) {
		return `${config.baseUrl}${withBasePath("/api")}`;
	}
	return withBasePath("/api");
}

/**
 * Get the WebSocket URL for real-time connections
 */
export function getWebSocketUrl(path: string = ""): string {
	const cleanPath = path.startsWith("/") ? path : `/${path}`;
	const prefixedPath = withBasePath(cleanPath);

	if (typeof window !== "undefined") {
		const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		return `${wsProtocol}//${window.location.host}${prefixedPath}`;
	}

	const config = getPortConfig();
	return `${config.wsUrl}${prefixedPath}`;
}

/**
 * Get the full base URL (for example code snippets).
 * Includes BIFROST_BASE_PATH so curl/SDK examples match subpath deployments.
 */
export function getExampleBaseUrl(): string {
	const config = getPortConfig();
	return `${config.baseUrl}${getBasePath()}`;
}

/**
 * Get the host (hostname:port) for example code
 */
export function getExampleHost(): string {
	return getPortConfig().host;
}

/**
 * Check if we're in development mode
 */
export function isDevelopmentMode(): boolean {
	return getPortConfig().isDevelopment;
}

/**
 * Generate a complete URL for a specific endpoint
 */
export function getEndpointUrl(endpoint: string): string {
	const prefixedEndpoint = withBasePath(endpoint.startsWith("/") ? endpoint : `/${endpoint}`);

	if (typeof window !== "undefined") {
		return prefixedEndpoint;
	}

	const config = getPortConfig();
	if (config.isDevelopment) {
		return `${config.baseUrl}${prefixedEndpoint}`;
	}
	return prefixedEndpoint;
}