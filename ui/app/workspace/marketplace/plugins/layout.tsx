import { createFileRoute } from "@tanstack/react-router";
import MarketplacePluginsPage from "./page";

export const Route = createFileRoute("/workspace/marketplace/plugins")({
	component: MarketplacePluginsPage,
});