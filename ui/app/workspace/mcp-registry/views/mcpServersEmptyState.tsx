import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { Server } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

const MCP_SERVERS_DOCS_URL = "https://docs.getbifrost.ai/features/mcp/overview";

interface MCPServersEmptyStateProps {
	onAddClick: () => void;
	canCreate?: boolean;
}

export function MCPServersEmptyState({ onAddClick, canCreate = true }: MCPServersEmptyStateProps) {
	const t = useT();
	return (
		<div className="flex min-h-[80vh] w-full flex-col items-center justify-center gap-4 py-16 text-center">
			<div className="text-muted-foreground">
				<Server className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{t("mcp.empty.title")}</h1>
				<div className="text-muted-foreground mx-auto mt-2 max-w-[600px] text-sm font-normal">{t("mcp.empty.description")}</div>
				<div className="mx-auto mt-6 flex flex-row flex-wrap items-center justify-center gap-2">
					<Button
						variant="outline"
						aria-label={t("mcp.empty.readMoreAria")}
						data-testid="mcp-registry-button-read-more"
						onClick={() => {
							window.open(`${MCP_SERVERS_DOCS_URL}?utm_source=bfd`, "_blank", "noopener,noreferrer");
						}}
					>
						{t("mcp.empty.readMore")} <ArrowUpRight className="text-muted-foreground h-3 w-3" />
					</Button>
					<Button aria-label={t("mcp.empty.addServerAria")} onClick={onAddClick} disabled={!canCreate} data-testid="create-mcp-client-btn">
						{t("mcp.empty.addServer")}
					</Button>
				</div>
			</div>
		</div>
	);
}
