const binaryPlaceholderPattern = /^\[[^\]]+\]$/;

export function isLogBinaryPlaceholder(value?: string | null): boolean {
	return !!value && binaryPlaceholderPattern.test(value);
}

export function formatLogBinaryPlaceholder(value: string): string {
	return value;
}
