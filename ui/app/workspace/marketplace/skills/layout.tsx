import { createFileRoute } from "@tanstack/react-router";
import MarketplaceSkillsPage from "./page";

export const Route = createFileRoute("/workspace/marketplace/skills")({
	component: MarketplaceSkillsPage,
});
