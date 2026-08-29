import { assert, it } from "@effect/vitest";

import { formatServicePruneResult, formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/t3code.service",
  logPath: "/home/me/.t3/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "T3 Code service",
      "  Status: installed · t3@0.0.29",
      "  Unit: /home/me/.config/systemd/user/t3code.service",
      "  Logs: /home/me/.t3/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Next: Run `npx t3@latest service update`.",
  );
});

it("explains where the service is supported", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Supported on: Linux with systemd, macOS with launchd",
  );
});

it("formats an exact service runtime prune preview with recoverable bytes", () => {
  assert.equal(
    formatServicePruneResult({
      dryRun: true,
      versions: ["0.0.31", "0.0.32"],
      runtimes: [
        { version: "0.0.31", recoverableBytes: 1024 },
        { version: "0.0.32", recoverableBytes: 1536 },
      ],
      recoverableBytes: 2560,
    }),
    [
      "Would prune 2 old T3 Code service runtimes and recover 2.50 KiB:",
      "  t3@0.0.31 (1.00 KiB)",
      "  t3@0.0.32 (1.50 KiB)",
    ].join("\n"),
  );
});

it("formats every successful service runtime removal", () => {
  assert.equal(
    formatServicePruneResult({
      dryRun: false,
      versions: ["0.0.31"],
      runtimes: [{ version: "0.0.31", recoverableBytes: 1024 }],
      recoverableBytes: 1024,
    }),
    ["Pruned 1 old T3 Code service runtime and recovered 1.00 KiB:", "  t3@0.0.31 (1.00 KiB)"].join(
      "\n",
    ),
  );
});

it("reports when there are no old service runtimes", () => {
  assert.equal(
    formatServicePruneResult({
      dryRun: false,
      versions: [],
      runtimes: [],
      recoverableBytes: 0,
    }),
    "No old T3 Code service runtimes found.",
  );
});
