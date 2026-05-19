import { join } from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { registerIpc } from "./ipc.js";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

function createWindow(): void {
	const mainWindow = new BrowserWindow({
		width: 1320,
		height: 860,
		minWidth: 1020,
		minHeight: 680,
		backgroundColor: "#181714",
		autoHideMenuBar: true,
		show: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	mainWindow.setMenu(null);
	mainWindow.setMenuBarVisibility(false);

	registerIpc(mainWindow);

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
		console.error(`Renderer failed to load ${url}: ${code} ${description}`);
	});

	if (process.env.ELECTRON_RENDERER_URL) {
		void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

app.whenReady().then(() => {
	Menu.setApplicationMenu(null);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
