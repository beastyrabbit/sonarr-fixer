export function formatBytes(value?: number): string {
	if (!value || value <= 0) {
		return "-";
	}
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(unit > 1 ? 2 : 1)} ${units[unit]}`;
}

export function cx(...classes: Array<string | false | undefined>): string {
	return classes.filter(Boolean).join(" ");
}

export function confidenceLabel(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export function joinOrDash(values: string[], separator = ", "): string {
	return values.length ? values.join(separator) : "-";
}

function pathParts(path?: string): string[] {
	return (path ?? "").split(/[\\/]+/).filter(Boolean);
}

export function fileName(path?: string): string {
	const parts = pathParts(path);
	return parts.at(-1) ?? path ?? "-";
}

export function folderName(path?: string): string {
	const parts = pathParts(path);
	if (parts.length <= 1) {
		return "";
	}
	return parts.slice(0, -1).join("/");
}

export function absoluteText(values?: number[]): string {
	return values?.length ? `abs ${values.join(", ")}` : "";
}

export function compactDetails(values: Array<string | false | undefined>): string[] {
	return values.filter((value): value is string => Boolean(value));
}
