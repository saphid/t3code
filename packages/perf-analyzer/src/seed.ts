// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side fixture seeder that writes an isolated perf-test database.
import * as NodeBuffer from "node:buffer";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/**
 * Seeds a fresh perf-fixture database with deterministic projection rows, the
 * documented approach for render/load fixtures (see
 * .agents/skills/test-t3-app/references/sqlite-fixtures.md and
 * scripts/mobile-showcase-environment.ts, whose insert shapes this copies).
 * Raw projection rows do not form a coherent event history, which is fine
 * here: these fixtures exist to measure rendering and transport, not to prove
 * backend behavior.
 */

/**
 * `threads` counts project 1 (the giant thread included); when `projects` is
 * greater than 1, every further project seeds `threads - 1` regular threads,
 * so "wide" is 50 projects x 8 threads each plus the giant in project 1.
 */
export const FIXTURE_SIZES = {
  /** A realistic everyday workspace. */
  small: { projects: 1, threads: 12, messagesPerThread: 20, giantThreadMessages: 60 },
  /** A busy workspace; between everyday and stress-test. */
  medium: { projects: 1, threads: 80, messagesPerThread: 25, giantThreadMessages: 200 },
  /** A heavy power-user workspace; stresses lists and long threads. */
  large: { projects: 1, threads: 400, messagesPerThread: 30, giantThreadMessages: 600 },
  /** A many-project workspace; stresses the sidebar and project scope menu. */
  wide: { projects: 50, threads: 9, messagesPerThread: 20, giantThreadMessages: 60 },
} as const;

export type FixtureSize = keyof typeof FIXTURE_SIZES;

export const GIANT_THREAD_ID = "perf-thread-giant";

/**
 * Checkpoint diff fixture (open-large-diff): the giant thread's single turn
 * carries a real turn-1 checkpoint over these files. createWorkspaceRepo
 * commits base and changed states and points the server's checkpoint refs
 * (refs/t3/checkpoints/<base64url(threadId)>/turn/<n>, the exact format of
 * apps/server/src/checkpointing/Utils.ts) at them, so the server's
 * `git diff turn/0 turn/1` resolves; seedFixture writes the matching
 * checkpoint columns on the turn row so the client renders the changed-files
 * card and can request the diff.
 */
const CHECKPOINT_FILE_COUNT = 40;
const CHECKPOINT_FILE_LINES = 160;
const CHECKPOINT_CHANGED_START = 20;
const CHECKPOINT_CHANGED_LINES = 120;

function checkpointFilePath(index: number): string {
  return `src/perf/module${String(index).padStart(2, "0")}.ts`;
}

function checkpointFileContent(index: number, changed: boolean): string {
  const lines: Array<string> = [];
  for (let line = 0; line < CHECKPOINT_FILE_LINES; line++) {
    const isChanged =
      changed &&
      line >= CHECKPOINT_CHANGED_START &&
      line < CHECKPOINT_CHANGED_START + CHECKPOINT_CHANGED_LINES;
    lines.push(
      isChanged
        ? `export const v${index}_${line} = perfDiffChanged(${index}, ${line});`
        : `export const v${index}_${line} = seedValue(${index}, ${line});`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Mirrors checkpointRefForThreadTurn (base64url strips padding, like Buffer's). */
function giantCheckpointRef(turnCount: number): string {
  const encoded = NodeBuffer.Buffer.from(GIANT_THREAD_ID, "utf8").toString("base64url");
  return `refs/t3/checkpoints/${encoded}/turn/${turnCount}`;
}

/**
 * A substring of the first hunk's first deleted line in the first checkpoint
 * file. The deletion block leads the hunk, and the diff view virtualizes rows,
 * so the additions (perfDiffChanged lines) are below the fold when the first
 * hunk paints; the timeline's seeded message bodies never contain "seedValue".
 */
const CHECKPOINT_FIRST_HUNK_SNIPPET = `seedValue(0, ${CHECKPOINT_CHANGED_START})`;

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
] as const;

const SEEDED_TABLES = [
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_turns",
  "projection_threads",
  "projection_projects",
  "projection_state",
] as const;

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });

/**
 * Seeded pinned block, in display order. Keys are the exact output of
 * generateSpreadPinOrderKeys(3) (packages/client-runtime/src/state/
 * threadSort.ts), the same values a client writes when it materializes a
 * pinned section, so every seeded pin is drag-reorderable with real-shaped
 * keys. Thread ids exist at every fixture size (small seeds 1-11).
 */
const PINNED_THREADS = [
  { threadId: "perf-thread-3", orderKey: "gn" },
  { threadId: "perf-thread-4", orderKey: "nb" },
  { threadId: "perf-thread-5", orderKey: "tn" },
] as const;

/** mulberry32: tiny deterministic PRNG so every run renders identical bytes. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "checkpoint relay projector adapter turn receipt worktree pairing tunnel surface thread reactor decider schema socket render frame commit branch review".split(
    " ",
  );

function sentence(rng: () => number, words: number): string {
  const parts: Array<string> = [];
  for (let i = 0; i < words; i++) {
    const word = WORDS[Math.floor(rng() * WORDS.length)] ?? "thread";
    parts.push(word);
  }
  const text = parts.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

function messageBody(rng: () => number, index: number, giant: boolean): string {
  const paragraphs: Array<string> = [];
  const count = giant && index % 5 === 0 ? 6 : 1 + Math.floor(rng() * 3);
  for (let p = 0; p < count; p++) paragraphs.push(sentence(rng, 12 + Math.floor(rng() * 25)));
  if (index % 4 === 1) {
    const lines = giant && index % 8 === 1 ? 120 : 15;
    const code: Array<string> = [];
    for (let line = 0; line < lines; line++) {
      code.push(`export const ${WORDS[line % WORDS.length]}${line} = compute(${Math.floor(rng() * 1000)});`);
    }
    paragraphs.push("```ts\n" + code.join("\n") + "\n```");
  }
  return paragraphs.join("\n\n");
}

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

async function waitForSeedableSchema(dbPath: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
      try {
        const found = database
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${SEEDED_TABLES.map(() => "?").join(", ")})`,
          )
          .get(...SEEDED_TABLES) as { count: number };
        if (found.count === SEEDED_TABLES.length) return;
      } finally {
        database.close();
      }
    } catch {
      // Database not created yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The server did not migrate ${dbPath} within ${timeoutMs}ms.`);
}

function assertSafeHome(homeDir: string): void {
  const resolved = NodePath.resolve(homeDir);
  const liveHome = NodePath.join(NodeOS.homedir(), ".t3");
  if (resolved === liveHome || resolved.startsWith(liveHome + NodePath.sep)) {
    throw new Error(`Refusing to touch the live T3 home at ${liveHome}.`);
  }
}

/**
 * Creates a real git repo so project workspace lookups have a target, then
 * commits the checkpoint fixture at two states (base, then ~40 files x ~120
 * changed lines) and points the giant thread's turn/0 and turn/1 checkpoint
 * refs at them, so the server can compute the seeded checkpoint's diff.
 */
export async function createWorkspaceRepo(root: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(root, "src", "perf"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(root, "README.md"),
    "# Perf fixture workspace\n\nSeeded by @t3tools/perf-analyzer.\n",
  );
  const git = (...args: Array<string>) => execFile("git", ["-C", root, ...args]);
  const commit = (message: string) =>
    git(
      "-c",
      "user.email=perf@t3.local",
      "-c",
      "user.name=Perf Fixture",
      "commit",
      "--quiet",
      "-m",
      message,
      "--no-verify",
      "--no-gpg-sign",
    );
  const writeCheckpointFiles = async (changed: boolean) => {
    for (let index = 0; index < CHECKPOINT_FILE_COUNT; index++) {
      await NodeFSP.writeFile(
        NodePath.join(root, checkpointFilePath(index)),
        checkpointFileContent(index, changed),
      );
    }
  };
  await git("init", "--quiet", "--initial-branch=main");
  await writeCheckpointFiles(false);
  await git("add", "-A");
  await commit("seed");
  await git("update-ref", giantCheckpointRef(0), "HEAD");
  await writeCheckpointFiles(true);
  await git("add", "-A");
  await commit("perf checkpoint turn 1");
  await git("update-ref", giantCheckpointRef(1), "HEAD");
}

export interface SeedResult {
  readonly dbPath: string;
  readonly projectId: string;
  readonly threadCount: number;
  readonly messageCount: number;
  /** Deterministic seeded titles, used by scenarios to find UI elements. */
  readonly giantThreadTitle: string;
  readonly sampleThreadTitle: string;
  /** A stable substring of the giant thread's newest message body. */
  readonly giantLastMessageSnippet: string;
  /** A substring unique to the seeded checkpoint diff's first hunk. */
  readonly checkpointFirstHunkSnippet: string;
  /** All seeded threads in insertion order (giant first). */
  readonly threads: ReadonlyArray<{
    readonly title: string;
    readonly lastMessageSnippet: string;
  }>;
  /** Titles of the seeded pinned threads in pinned-block display order. */
  readonly pinnedThreadTitles: ReadonlyArray<string>;
  /** Seeded projects in insertion order (project 1 first), with one thread each. */
  readonly projects: ReadonlyArray<{
    readonly title: string;
    readonly sampleThreadTitle: string;
  }>;
}

/**
 * Seeds the database under homeDir/userdata once the running server has
 * migrated it. Deterministic for a given size.
 */
export async function seedFixture(input: {
  readonly homeDir: string;
  readonly size: FixtureSize;
  readonly workspaceRoot: string;
}): Promise<SeedResult> {
  assertSafeHome(input.homeDir);
  const config = FIXTURE_SIZES[input.size];
  const dbPath = NodePath.join(input.homeDir, "userdata", "state.sqlite");
  await waitForSeedableSchema(dbPath);
  const rng = createRng(0x7e5f);
  // A fixed clock keeps titles and orderings byte-identical across runs.
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const projectId = "perf-project";
  // Extra projects (wide size): deterministic titles, one plain directory
  // each. Deliberately not the shared git repo and not git repos at all: the
  // sidebar's default "repository" grouping mode merges projects with the
  // same repository identity into one group, and this fixture exists to
  // render many distinct groups.
  const extraProjects = Array.from({ length: config.projects - 1 }, (_, index) => {
    const label = String(index + 2).padStart(2, "0");
    return {
      projectId: `perf-project-${label}`,
      title: `Perf Project ${label}`,
      workspaceRoot: `${input.workspaceRoot}-p${label}`,
      threadPrefix: `perf-p${label}-thread`,
    };
  });
  for (const project of extraProjects) {
    await NodeFSP.mkdir(project.workspaceRoot, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(project.workspaceRoot, "README.md"),
      `# ${project.title}\n\nSeeded by @t3tools/perf-analyzer.\n`,
    );
  }
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  let messageCount = 0;
  const titles = new Map<string, string>();
  const lastBodies = new Map<string, string>();
  const sampleThreadIdByProject = new Map<string, string>();
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of SEEDED_TABLES) database.exec(`DELETE FROM ${table}`);

    const insertProject = database.prepare(
      `INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json, scripts_json,
        created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, '[]', ?, ?, NULL)`,
    );
    insertProject.run(
      projectId,
      "Perf Fixture",
      input.workspaceRoot,
      MODEL_SELECTION,
      minutesBefore(now, 60 * 24 * 30),
      minutesBefore(now, 1),
    );
    extraProjects.forEach((project, index) => {
      insertProject.run(
        project.projectId,
        project.title,
        project.workspaceRoot,
        MODEL_SELECTION,
        minutesBefore(now, 60 * 24 * 30 + index + 1),
        minutesBefore(now, 2 + index),
      );
    });

    const insertThread = database.prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at
      ) VALUES (?, ?, ?, ?, 'full-access', 'default', ?, NULL, ?, ?, 0, 0, 0, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
    );
    const insertTurn = database.prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id
      ) VALUES (?, ?, NULL, ?, 'completed', ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
    );
    const insertSession = database.prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, 'ready', 'Codex', 'codex', NULL, NULL, 'full-access', NULL, NULL, ?)`,
    );
    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );

    const seedThread = (
      threadId: string,
      ownerProjectId: string,
      index: number,
      messages: number,
    ) => {
      const minutesAgo = 5 + index * 7;
      const turnId = `${threadId}-turn`;
      const updatedAt = minutesBefore(now, minutesAgo);
      const title = sentence(rng, 4 + Math.floor(rng() * 4)).slice(0, -1);
      titles.set(threadId, title);
      insertThread.run(
        threadId,
        ownerProjectId,
        title,
        MODEL_SELECTION,
        index % 3 === 0 ? "main" : `perf/branch-${index}`,
        turnId,
        minutesBefore(now, minutesAgo + 1),
        minutesBefore(now, minutesAgo + 240),
        updatedAt,
        "settled",
        updatedAt,
      );
      insertTurn.run(
        threadId,
        turnId,
        `${threadId}-m${messages - 1}`,
        minutesBefore(now, minutesAgo + 2),
        minutesBefore(now, minutesAgo + 2),
        updatedAt,
      );
      insertSession.run(threadId, updatedAt);
      for (let m = 0; m < messages; m++) {
        const at = minutesBefore(now, minutesAgo + (messages - m));
        const body = messageBody(rng, m, threadId === GIANT_THREAD_ID);
        if (m === messages - 1) lastBodies.set(threadId, body);
        insertMessage.run(
          `${threadId}-m${m}`,
          threadId,
          turnId,
          m % 2 === 0 ? "user" : "assistant",
          body,
          at,
          at,
        );
        messageCount++;
      }
    };

    seedThread(GIANT_THREAD_ID, projectId, 0, config.giantThreadMessages);
    for (let t = 1; t < config.threads; t++) {
      seedThread(`perf-thread-${t}`, projectId, t, config.messagesPerThread);
    }
    sampleThreadIdByProject.set(projectId, "perf-thread-1");
    // Extra projects seed after project 1, so single-project sizes stay
    // byte-identical to what they seeded before the wide size existed.
    let globalIndex = config.threads;
    for (const project of extraProjects) {
      for (let t = 1; t < config.threads; t++) {
        const threadId = `${project.threadPrefix}-${t}`;
        seedThread(threadId, project.projectId, globalIndex++, config.messagesPerThread);
        if (t === 1) sampleThreadIdByProject.set(project.projectId, threadId);
      }
    }

    // The giant thread's turn carries the checkpoint the workspace repo's
    // refs back (see createWorkspaceRepo); file stats match the real commit.
    const checkpointFiles = Array.from({ length: CHECKPOINT_FILE_COUNT }, (_, index) => ({
      path: checkpointFilePath(index),
      kind: "modified",
      additions: CHECKPOINT_CHANGED_LINES,
      deletions: CHECKPOINT_CHANGED_LINES,
    }));
    database
      .prepare(
        `UPDATE projection_turns SET checkpoint_turn_count = 1, checkpoint_ref = ?,
          checkpoint_status = 'ready', checkpoint_files_json = ? WHERE thread_id = ?`,
      )
      .run(giantCheckpointRef(1), JSON.stringify(checkpointFiles), GIANT_THREAD_ID);

    const setPinned = database.prepare(
      "UPDATE projection_threads SET pinned_at = ?, pin_order_key = ? WHERE thread_id = ?",
    );
    PINNED_THREADS.forEach((pin, index) => {
      setPinned.run(minutesBefore(now, 90 + index), pin.orderKey, pin.threadId);
    });

    const insertState = database.prepare(
      "INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)",
    );
    const maxSequence = (
      database.prepare("SELECT COALESCE(MAX(sequence), 0) AS max FROM orchestration_events").get() as {
        max: number;
      }
    ).max;
    for (const projector of PROJECTOR_NAMES) {
      insertState.run(projector, maxSequence, minutesBefore(now, 1));
    }
    database.exec("COMMIT");
    // Fold the seed back into the main db file so the fixture survives even
    // an unclean shutdown of whichever server migrated it.
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
  const snippet = (threadId: string) =>
    (lastBodies.get(threadId) ?? "").split("\n")[0]?.slice(0, 60) ?? "";
  const threads = [...titles.keys()].map((threadId) => ({
    title: titles.get(threadId) ?? "",
    lastMessageSnippet: snippet(threadId),
  }));
  const sampleTitle = (ownerProjectId: string) =>
    titles.get(sampleThreadIdByProject.get(ownerProjectId) ?? "") ?? "";
  return {
    dbPath,
    projectId,
    threadCount: config.threads + extraProjects.length * (config.threads - 1),
    messageCount,
    giantThreadTitle: titles.get(GIANT_THREAD_ID) ?? "",
    sampleThreadTitle: titles.get("perf-thread-1") ?? "",
    giantLastMessageSnippet: snippet(GIANT_THREAD_ID),
    checkpointFirstHunkSnippet: CHECKPOINT_FIRST_HUNK_SNIPPET,
    threads,
    pinnedThreadTitles: PINNED_THREADS.map((pin) => titles.get(pin.threadId) ?? ""),
    projects: [
      { title: "Perf Fixture", sampleThreadTitle: sampleTitle(projectId) },
      ...extraProjects.map((project) => ({
        title: project.title,
        sampleThreadTitle: sampleTitle(project.projectId),
      })),
    ],
  };
}
