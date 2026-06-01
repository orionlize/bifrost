import { Construction } from "lucide-react";
import { useT } from "@/lib/i18n";
import ContactUsView from "../views/contactUsView";

export default function guardrailsProviderView() {
	const t = useT();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Construction className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.views.guardrails.title")}
				description={t("enterprise.licenseDescription")}
				readmeLink="https://docs.getbifrost.ai/enterprise/guardrails"
			/>
		</div>
	);
}