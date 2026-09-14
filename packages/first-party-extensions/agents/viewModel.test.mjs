import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  DEFERRED_SECTIONS,
  HOST_CHROME_NOTE,
  ROSTER_UNAVAILABLE_NOTICE,
  SCRIPTS_SCOPE_NOTE,
  SCRIPT_RUN_MAX_CANDIDATES,
  T3_PROJECT_FILE_MAX_SCRIPTS,
  claimableTerminal,
  describeScriptRun,
  parseT3ProjectFile,
  runWorkspaceScript,
  scriptRunNonce,
  scriptRuntimeEnv,
  scriptSlug,
  scriptTerminalBaseId,
  scriptTerminalCandidates,
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

  NodeTest.it("overflow ids carry the mount nonce so recreated panels never re-pick them", () => {
    const candidates = scriptTerminalCandidates("t3-agents-dev", "n1");
    NodeAssert.deepEqual(candidates, [
      "t3-agents-dev",
      "t3-agents-dev-n1-2",
      "t3-agents-dev-n1-3",
      "t3-agents-dev-n1-4",
    ]);
    NodeAssert.equal(candidates.length, SCRIPT_RUN_MAX_CANDIDATES);
    const otherMount = scriptTerminalCandidates("t3-agents-dev", "n2");
    for (const id of otherMount.slice(1))
      NodeAssert.ok(!candidates.includes(id), `${id} disjoint across mounts`);
    NodeAssert.equal(scriptRunNonce() === scriptRunNonce(), false);
  });

  NodeTest.it("reads the busy half of the native allocation rule", () => {
    NodeAssert.equal(terminalBusy({ hasRunningSubprocess: true }), true);
    NodeAssert.equal(terminalBusy({ hasRunningSubprocess: false }), false);
    NodeAssert.equal(terminalBusy(null), false);
  });

  NodeTest.it("claims only the asked-for session when it is alive and not busy", () => {
    const id = "t3-agents-dev";
    const live = { terminalId: id, status: "running", hasRunningSubprocess: false };
    NodeAssert.equal(claimableTerminal(live, id), true);
    NodeAssert.equal(
      claimableTerminal({ terminalId: id, status: "starting", hasRunningSubprocess: false }, id),
      true,
    );
    NodeAssert.equal(
      claimableTerminal({ terminalId: id, status: "running", hasRunningSubprocess: true }, id),
      false,
    );
    NodeAssert.equal(
      claimableTerminal({ terminalId: id, status: "exited", hasRunningSubprocess: false }, id),
      false,
    );
    NodeAssert.equal(
      claimableTerminal(
        { terminalId: "t3-agents-other", status: "running", hasRunningSubprocess: false },
        id,
      ),
      false,
    );
    NodeAssert.equal(claimableTerminal(null, id), false);
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
      describeScriptRun({ kind: "running", stage: "claim", terminalId: "t3-agents-dev-n1-2" }),
      /busy.*t3-agents-dev-n1-2/,
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

NodeTest.describe("runWorkspaceScript glue", () => {
  const workspace = { cwd: "/repo", workspaceRoot: "/repo", worktreePath: null };
  const script = {
    name: "Dev",
    command: "vp run dev",
    icon: null,
    runOnWorktreeCreate: false,
    previewUrl: null,
  };
  const meta = (terminalId, overrides = {}) => ({
    terminalId,
    status: "running",
    hasRunningSubprocess: false,
    ...overrides,
  });

  NodeTest.it("claims the dedicated terminal and writes the command", async () => {
    const calls = [];
    const control = {
      attach: async (input) => {
        calls.push({ method: "attach", input });
        return meta(input.terminalId);
      },
      write: async (input) => {
        calls.push({ method: "write", input });
        return {};
      },
    };
    const reports = [];
    const result = await runWorkspaceScript({
      control,
      script,
      workspace,
      nonce: "n1",
      report: (run) => reports.push(run),
    });
    NodeAssert.deepEqual(result, {
      kind: "sent",
      terminalId: "t3-agents-dev",
      status: "running",
    });
    NodeAssert.equal(calls.filter((c) => c.method === "attach").length, 1);
    NodeAssert.deepEqual(calls.at(-1), {
      method: "write",
      input: { terminalId: "t3-agents-dev", data: "vp run dev\r" },
    });
    NodeAssert.equal(calls[0].input.env.T3CODE_PROJECT_ROOT, "/repo");
  });

  NodeTest.it("overflows past a busy dedicated terminal to a nonce-keyed id", async () => {
    const writes = [];
    const control = {
      attach: async (input) =>
        meta(input.terminalId, {
          hasRunningSubprocess: input.terminalId === "t3-agents-dev",
        }),
      write: async (input) => {
        writes.push(input);
        return {};
      },
    };
    const result = await runWorkspaceScript({
      control,
      script,
      workspace,
      nonce: "n1",
      report: () => {},
    });
    NodeAssert.equal(result.kind, "sent");
    NodeAssert.equal(result.terminalId, "t3-agents-dev-n1-2");
    NodeAssert.deepEqual(writes, [{ terminalId: "t3-agents-dev-n1-2", data: "vp run dev\r" }]);
  });

  NodeTest.it(
    "never writes to a returned busy overflow terminal (recreated-panel collision)",
    async () => {
      // A previous panel mount left t3-agents-dev and the deterministic
      // overflow busy; the server returns those same running sessions for the
      // requested ids (attach is not create-exclusive). The run must skip
      // every busy session and write only to a confirmed-free candidate.
      const calls = [];
      const control = {
        attach: async (input) => {
          calls.push({ method: "attach", input });
          const preExisting = !input.terminalId.endsWith("-4");
          return meta(input.terminalId, { hasRunningSubprocess: preExisting });
        },
        write: async (input) => {
          calls.push({ method: "write", input });
          return {};
        },
      };
      const result = await runWorkspaceScript({
        control,
        script,
        workspace,
        nonce: "n1",
        report: () => {},
      });
      NodeAssert.equal(result.kind, "sent");
      NodeAssert.equal(result.terminalId, "t3-agents-dev-n1-4");
      const writes = calls.filter((c) => c.method === "write");
      NodeAssert.deepEqual(writes, [
        { method: "write", input: { terminalId: "t3-agents-dev-n1-4", data: "vp run dev\r" } },
      ]);
      for (const busy of ["t3-agents-dev", "t3-agents-dev-n1-2", "t3-agents-dev-n1-3"])
        NodeAssert.ok(
          writes.every((c) => c.input.terminalId !== busy),
          `no write to busy ${busy}`,
        );
    },
  );

  NodeTest.it("fails by name with zero writes when every candidate is busy", async () => {
    const writes = [];
    const control = {
      attach: async (input) => meta(input.terminalId, { hasRunningSubprocess: true }),
      write: async (input) => {
        writes.push(input);
        return {};
      },
    };
    const reports = [];
    const result = await runWorkspaceScript({
      control,
      script,
      workspace,
      nonce: "n1",
      report: (run) => reports.push(run),
    });
    NodeAssert.equal(result.kind, "failed");
    NodeAssert.equal(writes.length, 0);
    NodeAssert.match(result.message, /no claimable script terminal/);
    NodeAssert.match(result.message, /busy/);
  });

  NodeTest.it(
    "treats an attach rejection as a claim failure and tries the next candidate",
    async () => {
      const writes = [];
      const control = {
        attach: async (input) => {
          if (input.terminalId === "t3-agents-dev")
            throw new Error("Terminal session is unavailable in the requested workspace");
          return meta(input.terminalId);
        },
        write: async (input) => {
          writes.push(input);
          return {};
        },
      };
      const result = await runWorkspaceScript({
        control,
        script,
        workspace,
        nonce: "n1",
        report: () => {},
      });
      NodeAssert.equal(result.kind, "sent");
      NodeAssert.equal(result.terminalId, "t3-agents-dev-n1-2");
      NodeAssert.equal(writes.length, 1);
    },
  );
});

NodeTest.describe("deferred sections", () => {
  NodeTest.it("name every blocked row family with its blocker", () => {
    const blockers = DEFERRED_SECTIONS.map((section) => section.blocker).join(" | ");
    NodeAssert.match(blockers, /t3\.orchestration/);
    NodeAssert.match(blockers, /P12/);
    NodeAssert.match(blockers, /net-new design/);
    const rows = new Set(DEFERRED_SECTIONS.flatMap((section) => section.rows.split(/[–,]\s*/)));
    for (const row of ["2", "6", "9", "15", "16", "20", "22"])
      NodeAssert.ok(rows.has(row), `deferred sections name parity row ${row}`);
  });

  NodeTest.it("separates the scan/import row (22) from the net-new rows (20-21)", () => {
    const scan = DEFERRED_SECTIONS.find((section) => section.rows === "22");
    NodeAssert.ok(scan, "row 22 gets its own section");
    NodeAssert.match(scan.blocker, /provisioning scan exists/);
    NodeAssert.match(scan.blocker, /narrow public scan contract/);
    NodeAssert.doesNotMatch(scan.blocker, /no native .* binding exists/);
    const netNew = DEFERRED_SECTIONS.find((section) => section.rows === "20–21");
    NodeAssert.ok(netNew, "rows 20-21 keep their own section");
    NodeAssert.match(netNew.blocker, /net-new design/);
  });

  NodeTest.it("name the scripts-list and host-chrome boundaries", () => {
    NodeAssert.match(SCRIPTS_SCOPE_NOTE, /settings/i);
    NodeAssert.match(HOST_CHROME_NOTE, /host chat UI/);
    NodeAssert.match(ROSTER_UNAVAILABLE_NOTICE, /t3\.orchestration/);
  });
});
