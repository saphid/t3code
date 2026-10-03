import {
  type PluginInstallation,
  PluginInstallationId,
  PluginInstallationManifest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import {
  describePluginSource,
  presentPluginInstallation,
  resolvePluginManageAccess,
} from "./pluginPresentation.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OLD_DIGEST = `sha256:${"b".repeat(64)}`;

const MANIFEST = Schema.decodeSync(PluginInstallationManifest)({
  id: "acme.notifier",
  name: "Notifier",
  version: "1.0.0",
  capabilities: [],
  proposedApi: false,
});

const installation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation => ({
  installationId: PluginInstallationId.make("installation-1"),
  generation: 1,
  directory: "/srv/plugins/notifier/",
  manifest: MANIFEST,
  source: { digest: DIGEST, files: 3, bytes: 2048 },
  problem: null,
  inspectedAt: "2026-10-04T00:00:00.000Z",
  consent: { digest: DIGEST, capabilities: [], grantedAt: "2026-10-04T00:00:00.000Z" },
  enabled: true,
  hostState: { _tag: "idle" },
  addedAt: "2026-10-04T00:00:00.000Z",
  ...overrides,
});

describe("presentPluginInstallation", () => {
  it("treats an enabled plugin with an unknown host state as unknown, not idle", () => {
    const { hostState: _, ...unknownState } = installation();
    const view = presentPluginInstallation(unknownState);
    expect(view.stateLabel).toBe("Unknown state");
    expect(view.canResume).toBe(false);
    expect(view.canEnable).toBe(false);
    expect(view.canDisable).toBe(true);
  });

  it("asks for a fresh review after the approved bytes changed", () => {
    const view = presentPluginInstallation(
      installation({
        enabled: false,
        hostState: undefined,
        consent: { digest: OLD_DIGEST, capabilities: [], grantedAt: "2026-10-04T00:00:00.000Z" },
      }),
    );
    expect(view.status).toBe("needs-consent");
    expect(view.stateLabel).toBe("Changed since approval");
    expect(view.canReview).toBe(true);
    expect(view.canEnable).toBe(false);
  });

  it("offers a first review to a plugin nobody approved yet", () => {
    const view = presentPluginInstallation(
      installation({ enabled: false, hostState: undefined, consent: null }),
    );
    expect(view.stateLabel).toBe("Needs approval");
    expect(view.canReview).toBe(true);
  });

  it("offers resume only for states that wait for it", () => {
    const resumable = (hostState: PluginInstallation["hostState"]) =>
      presentPluginInstallation(installation({ hostState })).canResume;
    expect(resumable({ _tag: "idle" })).toBe(false);
    expect(resumable({ _tag: "running" })).toBe(false);
    expect(
      resumable({
        _tag: "backoff",
        failures: 2,
        reason: "Exited.",
        retryAt: "2026-10-04T00:01:00.000Z",
      }),
    ).toBe(true);
    expect(resumable({ _tag: "quarantined", failures: 6, reason: "Exited." })).toBe(true);
    expect(resumable({ _tag: "incompatible", reason: "Uses top-level await." })).toBe(true);
  });

  it("keeps disable available for an enabled plugin whose directory became unreadable", () => {
    const view = presentPluginInstallation(
      installation({ source: null, problem: "The directory does not exist." }),
    );
    expect(view.status).toBe("unavailable");
    expect(view.detail).toBe("The directory does not exist.");
    expect(view.canDisable).toBe(true);
    expect(view.canEnable).toBe(false);
  });

  it("names a plugin without a readable manifest by its directory", () => {
    const view = presentPluginInstallation(
      installation({ manifest: null, source: null, problem: "No manifest.", enabled: false }),
    );
    expect(view.title).toBe("notifier");
  });
});

describe("describePluginSource", () => {
  it("summarizes the file count and size", () => {
    expect(describePluginSource({ digest: DIGEST, files: 1, bytes: 512 })).toBe("1 file, 512 B");
    expect(describePluginSource({ digest: DIGEST, files: 12, bytes: 3 * 1024 * 1024 })).toBe(
      "12 files, 3.0 MB",
    );
  });
});

describe("resolvePluginManageAccess", () => {
  it("requires access:write", () => {
    const access = (scopes: ReadonlyArray<string> | undefined) =>
      resolvePluginManageAccess({
        session: {
          authenticated: true,
          ...(scopes === undefined ? {} : { scopes: scopes as never }),
        },
        isPending: false,
        hasError: false,
      });
    expect(access(["orchestration:read", "access:write"])).toBe("granted");
    expect(access(["orchestration:read", "orchestration:operate"])).toBe("denied");
    expect(access(undefined)).toBe("denied");
  });

  it("waits while the session loads and stays optimistic when it cannot be read", () => {
    expect(resolvePluginManageAccess({ session: null, isPending: true, hasError: false })).toBe(
      "pending",
    );
    expect(resolvePluginManageAccess({ session: null, isPending: false, hasError: true })).toBe(
      "granted",
    );
  });
});
