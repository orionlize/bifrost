import { createFileRoute } from "@tanstack/react-router";
import WebsitePage from "./page";

export const Route = createFileRoute("/workspace/config/website")({
	component: WebsitePage,
});
