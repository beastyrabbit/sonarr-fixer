import { afterEach, describe, expect, it, vi } from "vitest";
import { SonarrClient } from "./sonarr-client.js";

const removalOptions = {
	removeFromClient: true,
	blocklist: true,
	skipRedownload: false,
	changeCategory: false,
};

describe("SonarrClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("handles an empty successful queue removal response", async () => {
		const fetchMock = vi.fn(async () => new Response("", { status: 200, statusText: "OK" }));
		vi.stubGlobal("fetch", fetchMock);

		const client = new SonarrClient("http://sonarr.local/", "test-api-key");
		const result = await client.removeQueueItem(42, removalOptions);

		expect(result).toEqual({ ok: true, message: "Removed queue item 42." });
		expect(fetchMock).toHaveBeenCalledWith(
			"http://sonarr.local/api/v3/queue/42?removeFromClient=true&blocklist=true&skipRedownload=false&changeCategory=false",
			expect.objectContaining({
				method: "DELETE",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					"X-Api-Key": "test-api-key",
				}),
			}),
		);
	});
});
