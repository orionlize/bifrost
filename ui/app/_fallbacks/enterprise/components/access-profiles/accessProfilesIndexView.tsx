import { ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n";
import ContactUsView from "../views/contactUsView";

export default function AccessProfilesIndexView() {
	const t = useT();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<ShieldCheck className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.views.accessProfiles.title")}
				description={t("enterprise.views.accessProfiles.description")}
				readmeLink="https://docs.getbifrost.ai/enterprise/access-profiles"
				testIdPrefix="access-profiles"
			/>
		</div>
	);
}