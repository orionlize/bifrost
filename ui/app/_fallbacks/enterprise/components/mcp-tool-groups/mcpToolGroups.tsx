import { ToolCase } from "lucide-react";
import { useT } from "@/lib/i18n";
import ContactUsView from "../views/contactUsView";

export default function MCPToolGroups() {
	const t = useT();
	return (
		<>
			<div className="mb-4 flex items-center justify-between gap-4">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">{t("enterprise.views.mcpToolGroups.pageTitle")}</h2>
					<p className="text-muted-foreground text-sm">{t("enterprise.views.mcpToolGroups.pageDesc")}</p>
				</div>
			</div>
			<div className="rounded-sm border">
				<div className="flex w-full flex-col items-center justify-center py-16">
					<ContactUsView
						className="mx-auto w-full max-w-lg"
						icon={<ToolCase className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
						title={t("enterprise.views.mcpToolGroups.title")}
						description={t("enterprise.licenseDescription")}
						readmeLink="https://docs.getbifrost.ai/mcp/overview"
					/>
				</div>
			</div>
		</>
	);
}