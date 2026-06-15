import { useT } from "./context";

/** Page title/description from sidebar.nav.* locale keys. */
export function useNavTitle(navKey: string): string {
	const t = useT();
	return t(`sidebar.nav.${navKey}.title`);
}

export function useNavDescription(navKey: string): string {
	const t = useT();
	return t(`sidebar.nav.${navKey}.description`);
}