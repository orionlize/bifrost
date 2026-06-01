import { Building2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import ContactUsView from "../views/contactUsView";

export function BusinessUnitsView() {
	const t = useT();
	return (
		<div className="w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				testIdPrefix="business-units-governance"
				icon={<Building2 className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.views.businessUnits.title")}
				description={t("enterprise.licenseDescription")}
				readmeLink="https://docs.getbifrost.ai/enterprise/advanced-governance"
			/>
		</div>
	);
}