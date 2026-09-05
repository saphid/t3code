import { FolderIcon, MonitorIcon, MoonIcon, SendIcon, SunIcon } from "lucide-react";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import "./whimsy-fixture.css";

import { describeProjectFallbackMark, ProjectFallbackMark } from "./components/ProjectFallbackMark";
import { ConnectionClasp } from "./components/auth/ConnectionClasp";
import {
  TURN_COMPLETION_TICK_VISIBLE_MS,
  TurnCompletionTickIcon,
} from "./components/ThreadStatusIndicators";
import {
  EMPTY_TURN_COMPLETION_TICK_STATE,
  reduceTurnCompletionTick,
  type TurnCompletionTickState,
} from "./components/Sidebar.logic";

const DEMOS = ["projects", "clasp", "spectrum", "completion"] as const;
type Demo = (typeof DEMOS)[number];

const PROJECTS = [
  {
    name: "t3-code",
    cwd: "/Users/alex/Code/t3-code",
    detail: "Desktop and web client",
  },
  {
    name: "personal-ops",
    cwd: "/Users/alex/Code/personal-ops",
    detail: "Operations workspace",
  },
  {
    name: "agent-control-plane",
    cwd: "/Users/alex/Code/agent-control-plane",
    detail: "Agent experiments",
  },
  {
    name: "canvas",
    cwd: "/workspace/canvas",
    detail: "Design prototypes",
  },
] as const;

function readDemo(): Demo {
  const requested = new URLSearchParams(window.location.search).get("demo");
  return DEMOS.find((demo) => demo === requested) ?? "projects";
}

function fixtureHref(demo: Demo, before: boolean): string {
  const search = new URLSearchParams({ demo });
  if (before) search.set("before", "1");
  return `/whimsy-fixture.html?${search.toString()}`;
}

function FixtureApp() {
  const demo = readDemo();
  const before = new URLSearchParams(window.location.search).get("before") === "1";
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <main className={`whimsy-fixture-root ${before ? "whimsy-fixture-before" : ""}`}>
      <header className="whimsy-fixture-toolbar" aria-label="Fixture controls">
        <nav className="whimsy-fixture-tabs" aria-label="Fixture component">
          {DEMOS.map((item) => (
            <a
              key={item}
              aria-current={item === demo ? "page" : undefined}
              href={fixtureHref(item, before)}
            >
              {item[0]?.toUpperCase()}
              {item.slice(1)}
            </a>
          ))}
        </nav>
        <button
          className="whimsy-fixture-theme-toggle"
          type="button"
          onClick={() => setDark((current) => !current)}
        >
          {dark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
          {dark ? "Light" : "Dark"}
        </button>
      </header>

      {demo === "projects" ? <ProjectsFixture before={before} /> : null}
      {demo === "clasp" ? <ClaspFixture before={before} /> : null}
      {demo === "spectrum" ? <SpectrumFixture before={before} /> : null}
      {demo === "completion" ? <CompletionFixture before={before} /> : null}
    </main>
  );
}

function FixtureCanvas({ before, children }: { before: boolean; children: React.ReactNode }) {
  return (
    <section id="capture" aria-label="Component demonstration canvas">
      <div className="whimsy-fixture-canvas-bar">
        <span className="whimsy-fixture-wordmark">T3 Code</span>
        <span className="whimsy-fixture-synthetic-label">Component fixture · synthetic data</span>
        <span className="whimsy-fixture-version">{before ? "Before" : "After"}</span>
      </div>
      <div className="whimsy-fixture-canvas-body">{children}</div>
    </section>
  );
}

function ProjectsFixture({ before }: { before: boolean }) {
  return (
    <>
      <FixtureCanvas before={before}>
        <div className="whimsy-projects-shell">
          <aside className="whimsy-projects-sidebar">
            <div className="whimsy-projects-heading">
              <div>
                <p>Workspace</p>
                <h1>Projects</h1>
              </div>
              <span>4</span>
            </div>
            <div className="whimsy-project-list">
              {PROJECTS.map((project, index) => {
                const descriptor = describeProjectFallbackMark("local", project.cwd);
                return (
                  <div
                    className={`whimsy-project-row ${index === 0 ? "is-active" : ""}`}
                    key={project.cwd}
                  >
                    <span className="whimsy-project-mark">
                      {before || !descriptor ? (
                        <FolderIcon aria-hidden="true" />
                      ) : (
                        <ProjectFallbackMark descriptor={descriptor} />
                      )}
                    </span>
                    <span className="whimsy-project-copy">
                      <strong>{project.name}</strong>
                      <small>{project.detail}</small>
                    </span>
                    <span className="whimsy-project-state">
                      {before ? "Folder" : descriptor?.variant}
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>
          <div className="whimsy-project-detail">
            <MonitorIcon aria-hidden="true" />
            <p>Local environment</p>
            <strong>Choose a project to view its threads</strong>
          </div>
        </div>
      </FixtureCanvas>
      <div className="whimsy-fixture-controls" aria-label="Project icon controls">
        <button type="button" disabled aria-describedby="project-favicon-limit">
          Custom icon
        </button>
        <p id="project-favicon-limit">
          Automatic fallback preview. Custom favicons require the runtime connection provider.
        </p>
      </div>
    </>
  );
}

type PairingDemoState = "ready" | "paired" | "failed";

function ClaspFixture({ before }: { before: boolean }) {
  const [state, setState] = useState<PairingDemoState>("ready");
  const [attempt, setAttempt] = useState(0);

  const pair = () => {
    setAttempt((current) => current + 1);
    setState("paired");
  };

  return (
    <>
      <FixtureCanvas before={before}>
        <div className="whimsy-pairing-backdrop">
          <section className="whimsy-pairing-card" aria-live="polite">
            <p className="whimsy-pairing-eyebrow">T3 Code</p>
            <div className="whimsy-pairing-heading">
              <h1>
                {state === "paired"
                  ? "Backend paired"
                  : state === "failed"
                    ? "Pairing failed"
                    : "Pairing backend"}
              </h1>
              {state === "paired" && !before ? (
                <ConnectionClasp key={attempt} playJoiningMotion />
              ) : null}
            </div>
            <p>
              {state === "paired"
                ? "Studio Mac is saved in this browser."
                : state === "failed"
                  ? "The pairing code could not be accepted."
                  : "Ready to demonstrate a local pairing result."}
            </p>
            <div className="whimsy-pairing-host">
              Host: <code>studio-mac.example.test</code>
            </div>
            {state === "failed" ? (
              <div className="whimsy-pairing-error">
                Verify the backend is reachable, supports CORS for hosted clients, and uses HTTPS.
              </div>
            ) : null}
            {state === "paired" ? (
              <span className="whimsy-pairing-action">Open app</span>
            ) : state === "failed" ? (
              <span className="whimsy-pairing-action">Try again</span>
            ) : null}
          </section>
        </div>
      </FixtureCanvas>
      <div className="whimsy-fixture-controls" aria-label="Pairing demonstration controls">
        <button type="button" onClick={pair}>
          Pair backend
        </button>
        <button type="button" onClick={() => setState("ready")}>
          Reset
        </button>
        <button type="button" onClick={() => setState("failed")}>
          Fail pairing
        </button>
        <p>These controls switch synthetic UI states immediately; they do not send a request.</p>
      </div>
    </>
  );
}

function SpectrumFixture({ before }: { before: boolean }) {
  const [prompt, setPrompt] = useState("Sketch a smaller model for project navigation.");
  const [enabled, setEnabled] = useState(true);
  const previewPrompt = useMemo(() => prompt.trim() || "Ask T3 Code anything", [prompt]);

  return (
    <>
      <FixtureCanvas before={before}>
        <div className="whimsy-chat-shell">
          <div className="whimsy-chat-header">
            <div>
              <strong>t3-code</strong>
              <span>whimsy/catalog</span>
            </div>
            <span>Claude Code · Opus</span>
          </div>
          <div className="whimsy-chat-context">
            <span>You</span>
            <p>Can you simplify the project switcher?</p>
          </div>
          <div className={`whimsy-composer-frame ${enabled ? "ultrathink-frame" : ""}`}>
            <div className={`whimsy-composer-surface ${enabled ? "ultrathink-surface" : ""}`}>
              <p>{previewPrompt}</p>
              <div>
                <span className={enabled ? "ultrathink-chroma" : ""}>
                  {enabled ? "Ultrathink" : "Standard"}
                </span>
                <SendIcon aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </FixtureCanvas>
      <div className="whimsy-fixture-controls whimsy-spectrum-controls">
        <label htmlFor="fixture-prompt">Prompt</label>
        <textarea
          id="fixture-prompt"
          rows={2}
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
        <div>
          <button type="button" aria-pressed={enabled} onClick={() => setEnabled(true)}>
            Enable ultrathink
          </button>
          <button type="button" aria-pressed={!enabled} onClick={() => setEnabled(false)}>
            Disable ultrathink
          </button>
        </div>
      </div>
    </>
  );
}

type CompletionTransitionInput = Parameters<typeof reduceTurnCompletionTick>[1];
type CompletionSnapshot = Pick<
  CompletionTransitionInput,
  "latestTurn" | "latestUserMessageAt" | "session"
>;

const COMPLETION_FIXTURE_THREAD_ID = "completion-fixture-thread" as never;

function completionRequestedAt(turnNumber: number): string {
  return new Date(Date.UTC(2026, 8, 5, 10, 0, turnNumber)).toISOString();
}

function runningCompletionSnapshot(turnNumber: number): CompletionSnapshot {
  const turnId = `fixture-turn-${turnNumber}` as never;
  const requestedAt = completionRequestedAt(turnNumber);
  return {
    latestTurn: {
      turnId,
      state: "running",
      requestedAt,
      startedAt: requestedAt,
      completedAt: null,
      assistantMessageId: null,
    },
    latestUserMessageAt: requestedAt,
    session: {
      threadId: COMPLETION_FIXTURE_THREAD_ID,
      status: "running",
      providerName: "Codex",
      runtimeMode: "full-access",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: requestedAt,
    },
  };
}

function completedCompletionSnapshot(snapshot: CompletionSnapshot): CompletionSnapshot {
  const completedAt = new Date(
    Date.parse(snapshot.latestTurn?.requestedAt ?? completionRequestedAt(0)) + 45_000,
  ).toISOString();
  return {
    ...snapshot,
    latestTurn:
      snapshot.latestTurn === null
        ? null
        : { ...snapshot.latestTurn, state: "completed", completedAt },
    session:
      snapshot.session === null
        ? null
        : {
            ...snapshot.session,
            status: "ready",
            activeTurnId: null,
            updatedAt: completedAt,
          },
  };
}

function failedCompletionSnapshot(snapshot: CompletionSnapshot): CompletionSnapshot {
  const failedAt = new Date(
    Date.parse(snapshot.latestTurn?.requestedAt ?? completionRequestedAt(0)) + 45_000,
  ).toISOString();
  return {
    ...snapshot,
    latestTurn:
      snapshot.latestTurn === null
        ? null
        : { ...snapshot.latestTurn, state: "error", completedAt: failedAt },
    session:
      snapshot.session === null
        ? null
        : {
            ...snapshot.session,
            status: "error",
            activeTurnId: null,
            lastError: "Synthetic provider failure",
            updatedAt: failedAt,
          },
  };
}

function CompletionFixture({ before }: { before: boolean }) {
  const [snapshot, setSnapshot] = useState<CompletionSnapshot>(() => ({
    latestTurn: null,
    latestUserMessageAt: null,
    session: null,
  }));
  const [showTick, setShowTick] = useState(false);
  const [recentEvent, setRecentEvent] = useState("Ready · choose a manual action");
  const observerRef = useRef<TurnCompletionTickState>(EMPTY_TURN_COMPLETION_TICK_STATE);
  const turnNumberRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTick = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowTick(false);
  };

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const applySnapshot = (
    nextSnapshot: CompletionSnapshot,
    options: { canObserveLiveTransitions?: boolean; event: string },
  ) => {
    const transition = reduceTurnCompletionTick(observerRef.current, {
      ...nextSnapshot,
      canObserveLiveTransitions: options.canObserveLiveTransitions ?? true,
      isForeground: true,
    });
    observerRef.current = transition.state;
    setSnapshot(nextSnapshot);
    clearTick();

    if (transition.action === "start" && !before) {
      setShowTick(true);
      setRecentEvent(`${options.event} · trigger=start`);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setShowTick(false);
        setRecentEvent(`${options.event} · tick complete`);
      }, TURN_COMPLETION_TICK_VISIBLE_MS);
      return;
    }

    setRecentEvent(
      transition.action === "start"
        ? `${options.event} · trigger=start · hidden in Before`
        : `${options.event} · trigger=${transition.action}`,
    );
  };

  const startTurn = () => {
    turnNumberRef.current += 1;
    applySnapshot(runningCompletionSnapshot(turnNumberRef.current), {
      event: `fixture-turn-${turnNumberRef.current} running`,
    });
  };

  const completeTurn = () => {
    applySnapshot(completedCompletionSnapshot(snapshot), {
      event: `${snapshot.latestTurn?.turnId ?? "No turn"} completed`,
    });
  };

  const failTurn = () => {
    applySnapshot(failedCompletionSnapshot(snapshot), {
      event: `${snapshot.latestTurn?.turnId ?? "No turn"} failed`,
    });
  };

  const replayReconnectCatchUp = () => {
    turnNumberRef.current += 1;
    const running = runningCompletionSnapshot(turnNumberRef.current);
    const observed = reduceTurnCompletionTick(observerRef.current, {
      ...running,
      canObserveLiveTransitions: true,
      isForeground: true,
    });
    const disconnected = reduceTurnCompletionTick(observed.state, {
      ...running,
      canObserveLiveTransitions: false,
      isForeground: true,
    });
    observerRef.current = disconnected.state;
    applySnapshot(completedCompletionSnapshot(running), {
      event: `fixture-turn-${turnNumberRef.current} reconnect catch-up`,
    });
  };

  const reset = () => {
    clearTick();
    observerRef.current = EMPTY_TURN_COMPLETION_TICK_STATE;
    setSnapshot({ latestTurn: null, latestUserMessageAt: null, session: null });
    setRecentEvent("Ready · choose a manual action");
  };

  const turnState = snapshot.latestTurn?.state ?? "idle";
  const statusLabel =
    turnState === "running"
      ? "Running"
      : turnState === "completed"
        ? "Completed"
        : turnState === "error"
          ? "Failed"
          : "Ready";

  return (
    <>
      <FixtureCanvas before={before}>
        <div className="whimsy-completion-shell">
          <section className="whimsy-completion-card" aria-label="Synthetic turn status">
            <div className="whimsy-completion-heading">
              <div>
                <p>Thread status</p>
                <h1>Live completion tick</h1>
              </div>
              <span>{before ? "Transient hidden" : "900 ms"}</span>
            </div>
            <div className="whimsy-completion-thread-row">
              <span className="whimsy-completion-avatar">T3</span>
              <span className="whimsy-completion-copy">
                <strong>Polish the Electron sidebar</strong>
                <small>Codex · fixture environment</small>
              </span>
              <span className={`whimsy-completion-status is-${turnState}`}>
                {showTick ? (
                  <TurnCompletionTickIcon className="whimsy-completion-tick" />
                ) : (
                  <span className="whimsy-completion-status-dot" aria-hidden="true" />
                )}
                <span>{statusLabel}</span>
              </span>
            </div>
            <div className="whimsy-completion-evidence">
              <span>
                Normalized state <code>{turnState}</code>
              </span>
              <small>{recentEvent}</small>
            </div>
          </section>
        </div>
      </FixtureCanvas>
      <div className="whimsy-fixture-controls" aria-label="Completion demonstration controls">
        <button type="button" onClick={startTurn}>
          Start turn
        </button>
        <button type="button" onClick={completeTurn} disabled={turnState !== "running"}>
          Complete turn
        </button>
        <button type="button" onClick={failTurn} disabled={turnState !== "running"}>
          Fail turn
        </button>
        <button type="button" onClick={replayReconnectCatchUp}>
          Reconnect catch-up
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
        <p>Manual synthetic transitions only. No provider request or automatic progress runs.</p>
      </div>
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <FixtureApp />
  </StrictMode>,
);
