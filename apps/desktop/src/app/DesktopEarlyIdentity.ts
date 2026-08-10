import { app } from "electron";

const appDataDirectory =
  process.platform === "win32" && process.env.APPDATA?.trim()
    ? process.env.APPDATA.trim()
    : app.getPath("appData");
const userDataDirectoryName = app.isPackaged
  ? "T3CodeTypedSwiftUIElectron"
  : "T3CodeTypedSwiftUIElectronDev";
const userDataPath = `${appDataDirectory}/${userDataDirectoryName}`;

// Chromium can create the GPU process while the Effect application layers are
// still being acquired. Configure the typed product's user-data directory at
// module evaluation time so even those earliest child processes stay isolated.
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("user-data-dir", userDataPath);
