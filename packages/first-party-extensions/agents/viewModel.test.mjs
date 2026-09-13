import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  DEFERRED_SECTIONS,
  HOST_CHROME_NOTE,
  ROSTER_UNAVAILABLE_NOTICE,
  SCRIPTS_SCOPE_NOTE,
  T3_PROJECT_FILE_MAX_SCRIPTS,
  describeScriptRun,
  nextScriptTerminalId,
  parseT3ProjectFile,
  scriptRuntimeEnv,
  scriptSlug,
  scriptTerminalBaseId,
  scriptWriteData,
  terminalBusy,
  workspaceFromRevision,
} from "./viewModel.ts";

NodeTest.describe("parseT3ProjectFile", () => {
  NodeTest.it("parses checked-in scripts into runnable entries", () => {
    const result = parseT3ProjectFile(
      JSON.stringify({
        $schema: "https://t3.codes/schema/t3.json",
        scripts: [
          { name: "  Dev Server  ", command: " vp run dev ", icon: "play" },
          {
            name: "Setup Worktree",
            command: "vp i",
            icon: "configure",
            runOnWorktreeCreate: true,
          },
          { name: "Preview", command: "vp run build", previewUrl: "http://localhost:5173" },
        ],
      }),
    );
    NodeAssert.equal(result.kind, "ready");
    NodeAssert.deepEqual(result.scripts, [
      {
        name: "Dev Server",
        command: "vp run dev",
        icon: "play",
        runOnWorktreeCreate: false,
        previewUrl: null,
      },
      {
        name: "Setup Worktree",
        command: "vp i",
        icon: "configure",
        runOnWorktreeCreate: true,
        previewUrl: null,
      },
      {
        name: "Preview",
        command: "vp run build",
        icon: null,
        runOnWorktreeCreate: false,
        previewUrl: "http://localhost:5173",
      },
    ]);
  });

  NodeTest.it("treats a file with no scripts key as empty, not invalid", () => {
    NodeAssert.deepEqual(parseT3ProjectFile("{}"), { kind: "empty" });
    NodeAssert.deepEqual(parseT3ProjectFile('{"scripts": []}'), { kind: "empty" });
  });

  NodeTest.it("names invalid files instead of treating them as absent", () => {
    NodeAssert.equal(parseT3ProjectFile("not json").kind, "invalid");
    NodeAssert.equal(parseT3ProjectFile('{"scripts": "build"}').kind, "invalid");
    NodeAssert.equal(parseT3ProjectFile('{"scripts": [{"name": "x"}]}').kind, "invalid");
    NodeAssert.equal(
      parseT3ProjectFile('{"scripts": [{"name": "x", "command": "y", "icon": "fire"}]}').kind,
      "invalid",
    );
    NodeAssert.equal(
      parseT3ProjectFile(
        '{"scripts": [{"name": "x", "command": "y", "runOnWorktreeCreate": "yes"}]}',
      ).kind,
      "invalid",
    );
  });

  NodeTest.it("rejects scripts arrays over the native cap", () => {
    const scripts = Array.from({ length: T3_PROJECT_FILE_MAX_SCRIPTS + 1 }, (_, i) => ({
      name: `s${i}`,
      command: "true",
    }));
    const result = parseT3ProjectFile(JSON.stringify({ scripts }));
    NodeAssert.equal(result.kind, "invalid");
  });
});

NodeTest.describe("workspaceFromRevision", () => {
  NodeTest.it("parses the public extensionWorkspaceRevision payload", () => {
    NodeAssert.deepEqual(workspaceFromRevision('["/repo", null]'), {
      cwd: "/repo",
      workspaceRoot: "/repo",
      worktreePath: null,
    });
    NodeAssert.deepEqual(workspaceFromRevision('["/repo", "/repo/.worktrees/t1"]'), {
      cwd: "/repo/.worktrees/t1",
      workspaceRoot: "/repo",
      worktreePath: "/repo/.worktrees/t1",
    });
  });

  NodeTest.it("rejects absent or malformed revisions", () => {
    NodeAssert.equal(workspaceFromRevision(undefined), null);
    NodeAssert.equal(workspaceFromRevision("not json"), null);
    NodeAssert.equal(workspaceFromRevision('["/repo"]'), null);
    NodeAssert.equal(workspaceFromRevision('["", null]'), null);
    NodeAssert.equal(workspaceFromRevision('{"root": "/repo"}'), null);
  });
});

NodeTest.describe("scriptRuntimeEnv", () => {
  NodeTest.it("carries the native T3CODE_* runtime variables", () => {
    const env = scriptRuntimeEnv({
      cwd: "/repo/.worktrees/t1",
      workspaceRoot: "/repo",
      worktreePath: "/repo/.worktrees/t1",
    });
    NodeAssert.equal(env.T3CODE_PROJECT_ROOT, "/repo");
    NodeAssert.equal(env.T3CODE_WORKTREE_PATH, "/repo/.worktrees/t1");
  });

  NodeTest.it("omits the worktree variable for root checkouts", () => {
    const env = scriptRuntimeEnv({ cwd: "/repo", workspaceRoot: "/repo", worktreePath: null });
    NodeAssert.equal(env.T3CODE_PROJECT_ROOT, "/repo");
    NodeAssert.equal("T3CODE_WORKTREE_PATH" in env, false);
  });
});

NodeTest.describe("script terminal ids", () => {
  NodeTest.it("normalizes script names like the native script-id rule", () => {
    NodeAssert.equal(scriptSlug("Dev Server"), "dev-server");
    NodeAssert.equal(scriptSlug("  Build & Test!! "), "build-test");
    NodeAssert.equal(scriptSlug("!!!"), "script");
    NodeAssert.equal(scriptSlug("a".repeat(80)).length <= 24, true);
  });

  NodeTest.it("normalizes script names into the dedicated terminal prefix", () => {
    NodeAssert.equal(scriptTerminalBaseId({ name: "Dev Server" }), "t3-agents-dev-server");
    NodeAssert.equal(scriptTerminalBaseId({ name: "!!!" }), "t3-agents-script");
    NodeAssert.equal(scriptTerminalBaseId({ name: "a".repeat(80) }).length <= 128, true);
  });

  NodeTest.it("allocates the next free numbered id when the base is busy", () => {
    const taken = new Set();
    NodeAssert.equal(nextScriptTerminalId("t3-agents-dev", taken), "t3-agents-dev");
    taken.add("t3-agents-dev");
    NodeAssert.equal(nextScriptTerminalId("t3-agents-dev", taken), "t3-agents-dev-2");
    taken.add("t3-agents-dev-2");
    NodeAssert.equal(nextScriptTerminalId("t3-agents-dev", taken), "t3-agents-dev-3");
  });

  NodeTest.it("reads the busy half of the native allocation rule", () => {
    NodeAssert.equal(terminalBusy({ hasRunningSubprocess: true }), true);
    NodeAssert.equal(terminalBusy({ hasRunningSubprocess: false }), false);
    NodeAssert.equal(terminalBusy(null), false);
  });
});

NodeTest.describe("script run state machine", () => {
  NodeTest.it("writes the command with the native carriage return", () => {
    NodeAssert.equal(scriptWriteData("vp run dev"), "vp run dev\r");
  });

  NodeTest.it("describes each stage and failure honestly", () => {
    NodeAssert.equal(
      describeScriptRun({ kind: "running", stage: "attach", terminalId: "t3-agents-dev" }),
      "Opening terminal t3-agents-dev…",
    );
    NodeAssert.match(
      describeScriptRun({ kind: "running", stage: "respawn", terminalId: "t3-agents-dev-2" }),
      /busy.*t3-agents-dev-2/,
    );
    NodeAssert.match(
      describeScriptRun({ kind: "sent", terminalId: "t3-agents-dev", status: "running" }),
      /Sent to t3-agents-dev \(session running\)/,
    );
    NodeAssert.match(
      describeScriptRun({
        kind: "failed",
        stage: "write",
        terminalId: "t3-agents-dev",
        message: "denied",
      }),
      /writing the command.*denied/,
    );
  });
});

NodeTest.describe("deferred sections", () => {
  NodeTest.it("name every blocked row family with its blocker", () => {
    const blockers = DEFERRED_SECTIONS.map((section) => section.blocker).join(" | ");
    NodeAssert.match(blockers, /t3\.orchestration/);
    NodeAssert.match(blockers, /P12/);
    NodeAssert.match(blockers, /net-new design/);
    const rows = new Set(DEFERRED_SECTIONS.flatMap((section) => section.rows.split(/[–,]\s*/)));
    for (const row of ["2", "6", "9", "15", "16", "20"])
      NodeAssert.ok(rows.has(row), `deferred sections name parity row ${row}`);
  });

  NodeTest.it("name the scripts-list and host-chrome boundaries", () => {
    NodeAssert.match(SCRIPTS_SCOPE_NOTE, /settings/i);
    NodeAssert.match(HOST_CHROME_NOTE, /host chat UI/);
    NodeAssert.match(ROSTER_UNAVAILABLE_NOTICE, /t3\.orchestration/);
  });
});
