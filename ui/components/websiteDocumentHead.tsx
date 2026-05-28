import { useWebsiteBranding } from "@/lib/hooks/useWebsiteBranding";
import { applyDocumentBranding, setPlaceholderDocumentBranding } from "@/lib/utils/documentBranding";
import { useLayoutEffect } from "react";

interface WebsiteDocumentHeadProps {
	preferPublicApi?: boolean;
}

export function WebsiteDocumentHead({ preferPublicApi = false }: WebsiteDocumentHeadProps) {
	const { siteName, faviconSrc, isLoaded } = useWebsiteBranding({ preferPublicApi });

	useLayoutEffect(() => {
		if (!isLoaded) {
			setPlaceholderDocumentBranding();
			return;
		}
		applyDocumentBranding(siteName, faviconSrc);
	}, [faviconSrc, isLoaded, siteName]);

	return null;
}
