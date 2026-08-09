import type { AnalysisResult, ResolutionProposal } from "../../../shared/types.js";

export function proposalActionLabel(action: ResolutionProposal["action"]): string {
	switch (action) {
		case "import_candidates":
			return "Import proposal";
		case "remove_queue_item":
			return "Remove proposal";
		case "ignore_queue_item":
			return "Ignore proposal";
		default:
			return "Needs review";
	}
}

export function historySummary(result: AnalysisResult): string {
	return result.proposal.reason || result.proposal.issueSummary || "No decision reason recorded.";
}
