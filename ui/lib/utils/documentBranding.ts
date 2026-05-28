export const PLACEHOLDER_FAVICON = "data:,";
const FAVICON_SELECTOR = 'link[data-bifrost-favicon="true"]';

export function setPlaceholderDocumentBranding() {
	document.title = "";
	upsertFaviconLink(PLACEHOLDER_FAVICON);
}

export function applyDocumentBranding(title: string, faviconSrc: string) {
	document.title = title;
	upsertFaviconLink(faviconSrc);
}

export function prepareDocumentBrandingBeforeLoad() {
	document.head.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach((element) => {
		element.remove();
	});
	setPlaceholderDocumentBranding();
}

function upsertFaviconLink(href: string) {
	let link = document.head.querySelector<HTMLLinkElement>(FAVICON_SELECTOR);
	if (!link) {
		link = document.createElement("link");
		link.rel = "icon";
		link.setAttribute("data-bifrost-favicon", "true");
		document.head.appendChild(link);
	}
	link.href = href;
	if (href === PLACEHOLDER_FAVICON) {
		link.removeAttribute("type");
		return;
	}
	if (href.endsWith(".ico")) {
		link.type = "image/x-icon";
	} else {
		link.removeAttribute("type");
	}
}
