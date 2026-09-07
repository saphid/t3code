import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly(?:-v2)?\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  if (/-nightly-v2\.\d{8}\.\d+$/.test(appVersion)) return "nightly-v2";
  return isNightlyDesktopVersion(appVersion) ? "nightly" : "latest";
}
