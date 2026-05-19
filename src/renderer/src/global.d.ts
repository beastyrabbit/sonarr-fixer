import type { SonarrFixerApi } from "../../preload/index.js";

declare global {
	interface Window {
		sonarrFixer: SonarrFixerApi;
	}
}
