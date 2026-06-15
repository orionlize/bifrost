import { createFileRoute } from "@tanstack/react-router";
import MarketplaceSettingsPage from "./page";

export const Route = createFileRoute("/workspace/marketplace/settings")({
	component: MarketplaceSettingsPage,
});