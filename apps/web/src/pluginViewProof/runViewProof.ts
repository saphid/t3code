import type { EnvironmentId } from "@t3tools/contracts";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";

import { getProjectFileQueryAtom } from "~/components/files/projectFilesQueryState";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";
import { appAtomRegistry } from "~/rpc/atomRegistry";

import {
  type IsolatedViewMount,
  type IsolatedViewStats,
  mountIsolatedView,
} from "./isolatedViewHost";
import {
  VIEW_BOOTSTRAP_SOURCE,
  type ViewNavigationPolicy,
  ViewDocumentError,
  buildViewDocument,
} from "./viewDocument";

export type ProofOutcome = "blocked" | "works" | "LEAKED" | "info" | "refused" | "unverified";

export interface ProofRow {
  readonly id: number;
  readonly view: string;
  readonly name: string;
  readonly outcome: ProofOutcome;
  readonly detail: string;
}

interface ManifestView {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly control?: boolean;
}

interface ReportedRow {
  readonly name: string;
  readonly outcome: ProofOutcome;
  readonly detail?: string;
}

const PROOF_TIMEOUT_MS = 10_000;
// nav-* views try to leave their document and, if still there, say so after 1.5 s.
const NAVIGATION_SETTLE_MS = 4_000;

function messageType(message: unknown): string | null {
  return typeof message === "object" && message !== null && "type" in message
    ? String(message.type)
    : null;
}

/**
 * Fetches each proof view over the environment's authenticated RPC transport,
 * verifies it, mounts it, and collects what each adversarial view managed to do.
 */
export function runViewProof(input: {
  readonly environmentId: EnvironmentId;
  readonly root: string;
  readonly navigationPolicy: ViewNavigationPolicy;
  readonly container: HTMLElement;
  readonly onRows: (rows: ReadonlyArray<ProofRow>) => void;
}): { readonly dispose: () => void } {
  const rows: ProofRow[] = [];
  const mounts = new Map<string, IsolatedViewMount>();
  const stats = new Map<string, IsolatedViewStats>();
  const pending = new Set<string>();
  const startHref = window.location.href;
  let finished = false;
  let cancelled = false;

  const push = (row: Omit<ProofRow, "id">) => {
    if (cancelled) return;
    rows.push({ ...row, id: rows.length });
    input.onRows([...rows]);
  };

  const readText = async (relativePath: string) => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      getProjectFileQueryAtom(input.environmentId, input.root, relativePath),
      { reportDefect: false, reportFailure: false },
    );
    if (result._tag !== "Success") throw new Error(`readFile ${relativePath} failed`);
    if (result.value.truncated) throw new Error(`readFile ${relativePath} truncated`);
    return result.value.contents;
  };

  const onSpoofedWindowMessage = (event: MessageEvent) => {
    const type = messageType(event.data);
    if (type === "tampered-executed") {
      push({ view: "tampered", name: "tampered bytes executed", outcome: "LEAKED", detail: "" });
    }
    if (type === "report") {
      push({
        view: "host",
        name: "report posted on window (not a port)",
        outcome: "blocked",
        detail: "ignored by host; only port reports are recorded",
      });
    }
  };
  window.addEventListener("message", onSpoofedWindowMessage);

  const finish = () => {
    if (finished || cancelled) return;
    finished = true;
    for (const id of pending) {
      push({ view: id, name: "report", outcome: "unverified", detail: "no report before timeout" });
    }
    push({
      view: "host",
      name: "app URL unchanged after navigation probes",
      outcome: window.location.href === startHref ? "blocked" : "LEAKED",
      detail: window.location.href === startHref ? "unchanged" : window.location.href,
    });
    for (const [id, viewStats] of stats) {
      push({ view: id, name: "host stats", outcome: "info", detail: JSON.stringify(viewStats) });
    }
    (window as unknown as { __viewProof?: unknown }).__viewProof = { done: true, rows };
    input.onRows([...rows]);
  };

  const settle = (id: string) => {
    pending.delete(id);
    if (pending.size === 0) finish();
  };

  const record = (id: string, message: unknown) => {
    const reported = (message as { results?: ReadonlyArray<ReportedRow> }).results ?? [];
    for (const row of reported) {
      push({ view: id, name: row.name, outcome: row.outcome, detail: row.detail ?? "" });
    }
    const violations = (message as { violations?: ReadonlyArray<string> }).violations ?? [];
    if (violations.length > 0) {
      push({
        view: id,
        name: "CSP violations seen in frame",
        outcome: "info",
        detail: violations.join(" | "),
      });
    }
  };

  const mount = (view: ManifestView, documentSource: string, generation: number) => {
    const frame = document.createElement("iframe");
    frame.title = view.id;
    frame.name = view.id;
    frame.dataset.viewId = view.id;
    frame.dataset.generation = String(generation);
    frame.className = "h-24 w-full rounded border border-border bg-white";
    input.container.append(frame);
    const viewStats: IsolatedViewStats = {
      loads: 0,
      connects: 0,
      ignoredWindowMessages: 0,
      droppedPortMessages: 0,
      teardownReason: null,
    };
    stats.set(`${view.id}#${generation}`, viewStats);
    const handle = mountIsolatedView({
      frame,
      documentSource,
      generation,
      // The control document has no wrapper: it shows the inherited policy alone.
      navigationPolicy: view.control ? "none" : input.navigationPolicy,
      init: {
        viewId: view.id,
        appOrigin: window.location.origin,
        serverOrigin: new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin,
      },
      stats: viewStats,
      onMessage: (message) => onViewMessage(view, generation, frame, viewStats, message),
    });
    mounts.set(`${view.id}#${generation}`, handle);
    if (view.id.startsWith("nav-")) {
      setTimeout(() => {
        if (stillAlive.has(view.id)) return;
        push({
          view: view.id,
          name: "verified document still loaded after self-navigation attempt",
          outcome: "info",
          detail: `no still-alive message; the runner's fixture log and frame state decide (host loads=${viewStats.loads}, teardown=${viewStats.teardownReason})`,
        });
        settle(view.id);
      }, NAVIGATION_SETTLE_MS);
    }
    return { frame, handle, viewStats };
  };

  const stillAlive = new Set<string>();
  let victimReady = false;
  let attackerDone = false;
  const staleState = { gen1AfterReplace: 0, gen2Ticks: 0, gen2AfterRevoke: 0, replaced: false };

  const releaseVictim = () => {
    if (victimReady && attackerDone) mounts.get("port-victim#1")?.post({ type: "finish" });
  };

  const onViewMessage = (
    view: ManifestView,
    generation: number,
    frame: HTMLIFrameElement,
    viewStats: IsolatedViewStats,
    message: unknown,
  ) => {
    const type = messageType(message);
    if (type === "ping") {
      mounts.get(`${view.id}#${generation}`)?.post({ type: "pong", nonce: "n1" });
      return;
    }
    if (type === "ready-for-attack") {
      victimReady = true;
      releaseVictim();
      return;
    }
    if (type === "still-alive") {
      if (stillAlive.has(view.id)) return;
      stillAlive.add(view.id);
      push({
        view: view.id,
        name: "verified document still loaded after self-navigation attempt",
        outcome: "blocked",
        detail: `still-alive after ${String((message as { target?: unknown }).target)}`,
      });
      settle(view.id);
      return;
    }
    if (type === "tick") {
      onStaleTick(view, generation, frame);
      return;
    }
    if (type === "navigating") {
      // The frame's next load must tear the mount down. A navigation the policy
      // refuses never loads, so settle on a timer too.
      const fallback = setTimeout(() => {
        push({
          view: view.id,
          name: "host tore down after self-navigation",
          outcome: "info",
          detail: `no second load (navigation refused or replaced by an error page); loads=${viewStats.loads}`,
        });
        settle(view.id);
      }, NAVIGATION_SETTLE_MS);
      frame.addEventListener(
        "load",
        () => {
          clearTimeout(fallback);
          queueMicrotask(() => {
            push({
              view: view.id,
              name: "host tore down after self-navigation",
              outcome: viewStats.teardownReason === "frame-navigated" ? "blocked" : "LEAKED",
              detail: String(viewStats.teardownReason),
            });
            settle(view.id);
          });
        },
        { once: true },
      );
      return;
    }
    if (type === "report") {
      record(view.id, message);
      if (view.id === "port-attacker") {
        attackerDone = true;
        releaseVictim();
      }
      // Give the benign view's oversize message time to be counted first.
      setTimeout(() => settle(view.id), 50);
    }
  };

  const onStaleTick = (view: ManifestView, generation: number, frame: HTMLIFrameElement) => {
    if (generation === 1) {
      if (staleState.replaced) {
        staleState.gen1AfterReplace += 1;
        return;
      }
      staleState.replaced = true;
      // Replace generation 1 with a fresh frame, as a host does on reload or update.
      mounts.get(`${view.id}#1`)?.dispose("replaced");
      frame.remove();
      void readText(view.file)
        .then((source) =>
          buildViewDocument({
            viewSource: source,
            declaredDigest: view.sha256,
            title: view.id,
            navigationPolicy: input.navigationPolicy,
          }),
        )
        .then((source) => {
          if (!cancelled) mount(view, source, 2);
        });
      return;
    }
    staleState.gen2Ticks += 1;
    if (staleState.gen2Ticks === 3) {
      mounts.get(`${view.id}#2`)?.dispose("revoked");
      setTimeout(() => {
        push({
          view: view.id,
          name: "messages from replaced generation-1 port",
          outcome: staleState.gen1AfterReplace === 0 ? "blocked" : "LEAKED",
          detail: String(staleState.gen1AfterReplace),
        });
        push({
          view: view.id,
          name: "messages after revoke",
          outcome: staleState.gen2AfterRevoke === 0 ? "blocked" : "LEAKED",
          detail: String(staleState.gen2AfterRevoke),
        });
        settle(view.id);
      }, 300);
    } else if (staleState.gen2Ticks > 3) {
      staleState.gen2AfterRevoke += 1;
    }
  };

  const start = async () => {
    const manifest = JSON.parse(await readText("manifest.json")) as {
      readonly views: ReadonlyArray<ManifestView>;
    };
    for (const view of manifest.views) pending.add(view.id);
    for (const view of manifest.views) {
      if (cancelled) return;
      let documentSource: string;
      try {
        const source = await readText(view.file);
        documentSource = view.control
          ? controlDocumentWithoutFrameCsp(source)
          : await buildViewDocument({
              viewSource: source,
              declaredDigest: view.sha256,
              title: view.id,
              navigationPolicy: input.navigationPolicy,
            });
      } catch (error) {
        push({
          view: view.id,
          name: "mount",
          outcome: "refused",
          detail:
            error instanceof ViewDocumentError
              ? `${error.reason}: ${error.message}`
              : String(error),
        });
        settle(view.id);
        continue;
      }
      if (cancelled) return;
      mount(view, documentSource, 1);
    }
  };

  const timeout = setTimeout(finish, PROOF_TIMEOUT_MS);
  start().catch((error: unknown) => {
    push({ view: "host", name: "start", outcome: "unverified", detail: String(error) });
    finish();
  });

  return {
    dispose: () => {
      cancelled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", onSpoofedWindowMessage);
      for (const handle of mounts.values()) handle.dispose("page-unmounted");
      input.container.replaceChildren();
    },
  };
}

/** Control only: the same frame and bootstrap with no frame CSP, leaving the inherited app policy. */
function controlDocumentWithoutFrameCsp(viewSource: string): string {
  const tag = "script";
  return `<!doctype html><html><head><meta charset="utf-8"><${tag}>${VIEW_BOOTSTRAP_SOURCE}</${tag}></head><body><${tag}>${viewSource}</${tag}></body></html>`;
}
