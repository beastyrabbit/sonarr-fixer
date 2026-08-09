import type { DiagnosticExportInput } from "../../shared/types.js";

const SENSITIVE_KEY =
	/(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|token|password)/i;

function redactString(value: string): string {
	return value
		.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
		.replace(/([?&](?:api[-_]?key|access[-_]?token|token)=)[^&#\s]+/gi, "$1[redacted]");
}

export function serializeDiagnosticLog(input: DiagnosticExportInput): string {
	return `${JSON.stringify(
		input,
		(key, value) => {
			if (SENSITIVE_KEY.test(key)) {
				return typeof value === "boolean" ? value : "[redacted]";
			}
			return typeof value === "string" ? redactString(value) : value;
		},
		2,
	)}\n`;
}
