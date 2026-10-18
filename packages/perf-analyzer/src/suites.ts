import type { NetworkProfileName, Surface } from "./launch.ts";
import type { FixtureSize } from "./seed.ts";

/**
 * A suite names a purpose-built slice of the matrix: which scenarios, at
 * which sizes, on which surfaces, under which network profiles. Small suites
 * exist so a change can be checked against just the paths it touches; the
 * "full" suite is the daily everything-run. Pick a suite by what your change
 * touches (see the table in PLANS.md).
 */
export interface SuiteDef {
  readonly description: string;
  /** Scenario names, or "all" for every registered scenario. */
  readonly scenarios: ReadonlyArray<string> | "all";
  readonly surfaces: ReadonlyArray<Surface>;
  readonly sizes: ReadonlyArray<FixtureSize>;
  readonly networks: ReadonlyArray<NetworkProfileName>;
  readonly runs: number;
}

export const SUITES: Record<string, SuiteDef> = {
  // ~2 minutes. The pre-merge sanity check: is the app grossly slower?
  smoke: {
    description: "Fast pre-merge check: cold start and one interaction, small fixture.",
    scenarios: ["startup", "open-giant-thread", "compose-typing-latency", "command-palette-open"],
    surfaces: ["web"],
    sizes: ["small"],
    networks: ["good"],
    runs: 3,
  },
  // Changes to the composer, editor, or input handling.
  composer: {
    description: "Per-keystroke composer typing latency in the giant thread.",
    scenarios: ["compose-typing-latency"],
    surfaces: ["web"],
    sizes: ["small", "large"],
    networks: ["good"],
    runs: 5,
  },
  // Changes to diffs or checkpoints.
  diff: {
    description: "Checkpoint diff open cost: the giant thread's 40-file seeded checkpoint.",
    scenarios: ["open-large-diff"],
    surfaces: ["web", "desktop"],
    sizes: ["small", "large"],
    networks: ["good"],
    runs: 5,
  },
  // Changes to the terminal: Ghostty WASM, canvas renderer, PTY relay.
  terminal: {
    description: "Ghostty render cost while ~10k lines stream into the thread terminal.",
    scenarios: ["terminal-output-burst"],
    surfaces: ["web", "desktop"],
    sizes: ["small"],
    networks: ["good"],
    runs: 5,
  },
  // Changes to lists, markdown, chat rendering, CSS, virtualization.
  rendering: {
    description: "Render cost: content mount and scroll across surfaces and sizes.",
    scenarios: [
      "open-giant-thread",
      "scroll-giant-thread",
      "streaming-turn-append",
      "command-palette-open",
      "sidebar-scroll-and-reorder",
      "many-projects-sidebar",
      // Desktop only: the PiP window is an Electron affordance; web skips it.
      "preview-pip-frames",
    ],
    surfaces: ["web", "desktop"],
    // "wide" only matches many-projects-sidebar; the others skip it.
    sizes: ["small", "large", "wide"],
    networks: ["good"],
    runs: 5,
  },
  // Changes to boot, routing, session establishment, bundle size.
  startup: {
    description:
      "Cold start on both surfaces at every size, plus the slow-network variant and the settings-section walk (route-level code-split loads).",
    scenarios: ["startup", "slow-network-startup", "settings-navigation"],
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large"],
    networks: ["good"],
    runs: 5,
  },
  // Changes to the WS layer, RPC contracts, snapshot payloads, reconnect logic.
  network: {
    description: "Every web scenario under degraded and chaotic connections.",
    scenarios: "all",
    surfaces: ["web"],
    sizes: ["small", "medium"],
    networks: ["good", "okay", "flaky"],
    runs: 3,
  },
  // The daily everything-run. Hours, saturating; schedule it, don't block on it.
  full: {
    description: "Everything: all scenarios, surfaces, sizes, and network profiles.",
    scenarios: "all",
    surfaces: ["web", "desktop"],
    sizes: ["small", "medium", "large", "wide"],
    networks: ["good", "okay", "flaky"],
    runs: 5,
  },
};
