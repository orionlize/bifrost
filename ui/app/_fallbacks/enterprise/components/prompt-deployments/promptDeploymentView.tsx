import { Router } from "lucide-react";
import { useT } from "@/lib/i18n";
import ContactUsView from "../views/contactUsView";

export default function PromptDeploymentView(_props?: { omitTitle?: boolean }) {
	const t = useT();
	return (
		<div className="w-full">
			<ContactUsView
				align="top"
				className="justify-start gap-3 rounded-md border p-4"
				icon={<Router className="h-8 w-8" strokeWidth={1.5} />}
				title={t("enterprise.views.promptDeployments.title")}
				description={t("enterprise.licenseDescription")}
				readmeLink="https://docs.getbifrost.ai/enterprise/prompt-deployments"
			/>
		</div>
	);
}