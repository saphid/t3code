import {
  extensionCommandForPlugin,
  extensionCommandName,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { Json, ViewContext } from "@t3tools/extension-sdk/contracts";
import type {
  GlobalCommandDescriptor,
  GlobalCommandHandler,
} from "@t3tools/extension-sdk/environment";
import type { ViewCommandHandler } from "@t3tools/extension-sdk/host";
import {
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
} from "@t3tools/shared/keybindings";
import type { KeybindingShortcut, KeybindingWhenNode } from "@t3tools/contracts";
import {
  matchesShortcut,
  matchesWhenClause,
  type ShortcutEventLike,
  type ShortcutMatchContext,
} from "../keybindings";
import { installedSurfaceRecord, installedWorkspaceContext } from "./installedContext";
import { randomUUID } from "../lib/utils";
import {
  extensionPanelSurface,
  selectThreadExtensionDock,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { readProject, readThreadShell } from "../state/entities";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  authorizeCaller,
  ClientProviderOpError,
  readInputObject,
  readInputString,
  type ClientLocalProvider,
  type ClientProviderAuthDeps,
  type ClientProviderInvokeCall,
} from "./clientProviderTypes";

export interface ExtensionCommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly defaultKey?: string;
  readonly when?: string;
  readonly scope: "surface" | "thread" | "global";
  readonly activation?: {
    readonly surfaceId: string;
    readonly placement: "side-panel" | "bottom-dock";
  };
}

interface CompiledCommand extends ExtensionCommandDescriptor {
  readonly whenAst: KeybindingWhenNode | null;
  readonly defaultShortcut: KeybindingShortcut | null;
}

interface CommandRegistration {
  readonly token: string;
  readonly environmentId: string;
  readonly installationId: string;
  readonly installationGeneration: number;
  /**
   * The client-side liveness generation at register time — the server-minted
   * `installationGeneration` is not observable from the client, so binding
   * staleness compares this against `deps.installationGeneration` instead.
   */
  readonly clientGeneration: number | null;
  readonly context: ViewContext;
  readonly contextKey: string;
  readonly commandSetHash: string;
  readonly commands: readonly CompiledCommand[];
  readonly installationScoped: boolean;
  readonly handler?: GlobalCommandHandler;
}

interface CommandBinding {
  readonly bindingId: string;
  readonly token: string;
  readonly environmentId: string;
  readonly installationId: string;
  readonly hostKey: string;
  readonly viewId: string;
  readonly context: ViewContext;
  readonly handler: ViewCommandHandler;
}

export interface CommandRegistrationResult {
  readonly commandId: string;
  readonly status: "registered" | "rejected";
  readonly reason?: string;
}

export interface ExtensionCommandEnvironmentDeps {
  /** Current generation for an installation id, or null when uninstalled/ineligible. */
  readonly installationGeneration: (installationId: string) => number | null;
  /** Manifest surfaces for an installation id (for activation eligibility checks). */
  readonly installationSurfaces: (installationId: string) =>
    | readonly {
        readonly id: string;
        readonly title: string;
        readonly placements: readonly string[];
        readonly clients: readonly string[];
        readonly scope: string;
        readonly stateVersion: number;
      }[]
    | null;
  /** The installation's granted project ids — activation requires an eligible thread. */
  readonly installationGrants: (installationId: string) => readonly string[] | null;
  /** The client tag surfaces declare (`"web" | "desktop"`). */
  readonly client: string;
}

/** A staged `ClientHost.registerGlobalCommands` entry awaiting its commit flush. */
export interface StagedGlobalCommands {
  readonly commands: readonly GlobalCommandDescriptor[];
  readonly handler?: GlobalCommandHandler;
  readonly listeners: Set<() => void>;
  status: "staged" | "active" | "rejected";
  token?: string | undefined;
  rejections?: readonly { commandId: string; reason: string }[] | undefined;
}

const registrations = new Map<string, CommandRegistration>();
const bindings = new Map<string, CommandBinding>();
const staged = new Map<string, StagedGlobalCommands[]>();
const environmentDeps = new Map<string, ExtensionCommandEnvironmentDeps>();
const paletteListeners = new Set<() => void>();
let paletteRevision = 0;
let activeThreadRef: ScopedThreadRef | null = null;
let bindingSerial = 0;

const stagedKey = (environmentId: string, installationId: string) =>
  `${environmentId}${installationId}`;

function notifyPalette() {
  paletteRevision++;
  for (const listener of paletteListeners) listener();
}

export function subscribeExtensionCommands(listener: () => void): () => void {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function extensionCommandRevision(): number {
  return paletteRevision;
}

export function setActiveExtensionThreadRef(ref: ScopedThreadRef | null): void {
  activeThreadRef = ref;
}

export function configureExtensionCommandEnvironment(
  environmentId: string,
  deps: ExtensionCommandEnvironmentDeps,
): void {
  environmentDeps.set(environmentId, deps);
}

export function unconfigureExtensionCommandEnvironment(environmentId: string): void {
  environmentDeps.delete(environmentId);
  for (const [token, registration] of registrations)
    if (registration.environmentId === environmentId) {
      registrations.delete(token);
      for (const [bindingId, binding] of bindings)
        if (binding.token === token) bindings.delete(bindingId);
    }
  for (const [bindingId, binding] of bindings)
    if (binding.environmentId === environmentId) bindings.delete(bindingId);
  for (const [key, entries] of staged)
    if (key.startsWith(environmentId + "")) {
      for (const entry of entries) {
        entry.status = "rejected";
        for (const listener of entry.listeners) listener();
      }
      staged.delete(key);
    }
  notifyPalette();
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

const COMMAND_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

function compileCommand(command: ExtensionCommandDescriptor): CompiledCommand {
  return {
    ...command,
    whenAst: command.when ? parseKeybindingWhenExpression(command.when) : null,
    defaultShortcut: command.defaultKey ? parseKeybindingShortcut(command.defaultKey) : null,
  };
}

/**
 * `t3.client/keybindings.registerCommands` implementation. Idempotent on
 * `{installationId, installationGeneration, context, commandSetHash}` — a
 * remount or reconnect replay of the same set returns the live token.
 */
export function registerCommands(input: {
  readonly environmentId: string;
  readonly installationId: string;
  readonly installationGeneration: number;
  readonly context: ViewContext;
  readonly commands: readonly ExtensionCommandDescriptor[];
  /** The calling installation's granted capabilities — global/activation scopes need extra grants. */
  readonly capabilities: readonly string[];
  readonly installationScoped?: boolean;
  readonly handler?: GlobalCommandHandler;
}): { commandSetToken: string; results: CommandRegistrationResult[] } {
  const deps = environmentDeps.get(input.environmentId);
  const results: CommandRegistrationResult[] = [];
  const accepted: ExtensionCommandDescriptor[] = [];
  const surfaces = deps?.installationSurfaces(input.installationId) ?? null;
  for (const command of input.commands) {
    const reject = (reason: string) =>
      results.push({ commandId: command.id, status: "rejected", reason });
    if (
      typeof command.id !== "string" ||
      !COMMAND_ID_PATTERN.test(command.id) ||
      command.id.length > 80
    ) {
      reject("invalid command id");
      continue;
    }
    if (typeof command.title !== "string" || !command.title.trim() || command.title.length > 200) {
      reject("invalid title");
      continue;
    }
    if (command.scope !== "surface" && command.scope !== "thread" && command.scope !== "global") {
      reject("invalid scope");
      continue;
    }
    if (command.scope === "global" && !input.capabilities.includes("t3.ui/keybindings.global")) {
      reject("missing grant t3.ui/keybindings.global");
      continue;
    }
    if (command.when && parseKeybindingWhenExpression(command.when) === null) {
      reject("invalid when expression");
      continue;
    }
    if (command.defaultKey && parseKeybindingShortcut(command.defaultKey) === null) {
      reject("invalid default key");
      continue;
    }
    if (command.activation !== undefined) {
      if (command.scope !== "global" || input.installationScoped !== true) {
        reject("activation requires an installation-scoped global command");
        continue;
      }
      if (!input.capabilities.includes("t3.ui/panels")) {
        reject("missing grant t3.ui/panels");
        continue;
      }
      const surface = surfaces?.find((candidate) => candidate.id === command.activation!.surfaceId);
      if (!surface || !surface.placements.includes(command.activation.placement)) {
        reject("activation names no own surface and declared placement");
        continue;
      }
    }
    accepted.push(command);
    results.push({ commandId: command.id, status: "registered" });
  }
  const contextKey = canonicalJson(input.context as unknown as Json);
  const commandSetHash = canonicalJson(input.commands as unknown as Json);
  for (const registration of registrations.values()) {
    if (
      registration.environmentId === input.environmentId &&
      registration.installationId === input.installationId &&
      registration.installationGeneration === input.installationGeneration &&
      registration.contextKey === contextKey &&
      registration.commandSetHash === commandSetHash
    ) {
      return { commandSetToken: registration.token, results };
    }
  }
  const token = `cmdset-${randomUUID()}`;
  registrations.set(token, {
    token,
    environmentId: input.environmentId,
    installationId: input.installationId,
    installationGeneration: input.installationGeneration,
    clientGeneration: deps?.installationGeneration(input.installationId) ?? null,
    context: input.context,
    contextKey,
    commandSetHash,
    commands: accepted.map(compileCommand),
    installationScoped: input.installationScoped === true,
    ...(input.handler ? { handler: input.handler } : {}),
  });
  notifyPalette();
  return { commandSetToken: token, results };
}

/**
 * Drops every registration, binding, and staged entry a dead installation
 * owned — a stopped factory's commands must never stay dispatchable.
 */
export function unregisterInstallationCommands(
  environmentId: string,
  installationId: string,
): void {
  let changed = false;
  for (const [token, registration] of registrations) {
    if (
      registration.environmentId !== environmentId ||
      registration.installationId !== installationId
    )
      continue;
    registrations.delete(token);
    for (const [bindingId, binding] of bindings)
      if (binding.token === token) bindings.delete(bindingId);
    changed = true;
  }
  const key = stagedKey(environmentId, installationId);
  const entries = staged.get(key);
  if (entries) {
    for (const entry of entries) {
      if (entry.status === "rejected") continue;
      entry.status = "rejected";
      for (const listener of entry.listeners) listener();
    }
    staged.delete(key);
    changed = true;
  }
  if (changed) notifyPalette();
}

export function unregisterCommands(
  environmentId: string,
  commandSetToken: string,
  installationId: string,
): boolean {
  const registration = registrations.get(commandSetToken);
  if (!registration || registration.environmentId !== environmentId) return false;
  // Owner-scoped like the notification seam: a token that is not the
  // caller's own removes nothing of theirs.
  if (registration.installationId !== installationId) return false;
  registrations.delete(commandSetToken);
  for (const [bindingId, binding] of bindings)
    if (binding.token === commandSetToken) bindings.delete(bindingId);
  notifyPalette();
  return true;
}

/**
 * `ViewSession.bindCommands` backing store. Validates token liveness, caller
 * identity + generation, and context equality; mints the `bindingId`.
 * Idempotent per (view-session, token).
 */
export function bindCommands(call: {
  readonly environmentId: string;
  readonly extensionId: string;
  readonly hostKey: string;
  readonly viewId: string;
  readonly context: ViewContext;
  readonly commandSetToken: string;
  readonly handler: ViewCommandHandler;
}): { bindingId: string; unbind: () => void } {
  const registration = registrations.get(call.commandSetToken);
  if (!registration || registration.environmentId !== call.environmentId)
    throw new ClientProviderOpError("binding-unknown", "Unknown command set token");
  if (registration.installationId !== call.extensionId)
    throw new ClientProviderOpError("binding-unknown", "Command set token belongs elsewhere");
  const current = environmentDeps.get(call.environmentId)?.installationGeneration(call.extensionId);
  if (current === null || current === undefined)
    throw new ClientProviderOpError("binding-unknown", "Installation is no longer available");
  if (current !== registration.clientGeneration)
    throw new ClientProviderOpError("binding-stale", "Command set predates the installation");
  if (registration.contextKey !== canonicalJson(call.context as unknown as Json))
    throw new ClientProviderOpError("binding-unknown", "Context does not match the registration");
  const existing = [...bindings.values()].find(
    (binding) =>
      binding.token === call.commandSetToken &&
      binding.hostKey === call.hostKey &&
      binding.viewId === call.viewId,
  );
  if (existing) return { bindingId: existing.bindingId, unbind: () => unbind(existing.bindingId) };
  const bindingId = `binding-${++bindingSerial}-${randomUUID()}`;
  const binding: CommandBinding = {
    bindingId,
    token: call.commandSetToken,
    environmentId: call.environmentId,
    installationId: call.extensionId,
    hostKey: call.hostKey,
    viewId: call.viewId,
    context: call.context,
    handler: call.handler,
  };
  bindings.set(bindingId, binding);
  return { bindingId, unbind: () => unbind(bindingId) };
}

function unbind(bindingId: string): void {
  bindings.delete(bindingId);
}

// ---------------------------------------------------------------------------
// Staged global command sets (ClientHost.registerGlobalCommands)

export function stageGlobalCommands(
  environmentId: string,
  installationId: string,
  commands: readonly GlobalCommandDescriptor[],
  handler: GlobalCommandHandler | undefined,
): StagedGlobalCommands {
  const entry: StagedGlobalCommands = {
    commands,
    ...(handler ? { handler } : {}),
    listeners: new Set(),
    status: "staged",
  };
  const key = stagedKey(environmentId, installationId);
  const entries = staged.get(key) ?? [];
  entries.push(entry);
  staged.set(key, entries);
  return entry;
}

/** Discards staged entries for a factory that never committed. */
export function discardStagedGlobalCommands(environmentId: string, installationId: string): void {
  const key = stagedKey(environmentId, installationId);
  const entries = staged.get(key);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.status !== "staged") continue;
    entry.status = "rejected";
    for (const listener of entry.listeners) listener();
  }
  staged.set(
    key,
    entries.filter((entry) => entry.status !== "rejected"),
  );
}

export function stagedGlobalCommandsFor(
  environmentId: string,
  installationId: string,
): readonly StagedGlobalCommands[] {
  return staged.get(stagedKey(environmentId, installationId)) ?? [];
}

/**
 * Attaches a staged installation-level handler to a committed registration.
 * Handlers are local functions and cannot cross the provider seam, so the
 * flush commits `{commands}` over the wire and lands the handler here.
 */
export function attachRegistrationHandler(
  environmentId: string,
  commandSetToken: string,
  handler: GlobalCommandHandler,
): void {
  const registration = registrations.get(commandSetToken);
  if (!registration || registration.environmentId !== environmentId) return;
  registrations.set(commandSetToken, { ...registration, handler });
  notifyPalette();
}

// ---------------------------------------------------------------------------
// Dispatch

interface DispatchCommandSite {
  readonly registration: CommandRegistration;
  readonly command: CompiledCommand;
}

function commandSites(commandName: string): DispatchCommandSite[] {
  const sites: DispatchCommandSite[] = [];
  for (const registration of registrations.values()) {
    const commandId = extensionCommandForPlugin(commandName, registration.installationId);
    if (commandId === null) continue;
    const command = registration.commands.find((candidate) => candidate.id === commandId);
    if (command) sites.push({ registration, command });
  }
  return sites;
}

/** The `hostKey:viewId` pair of the mounted extension view containing focus. */
export function focusedExtensionViewKey(): string | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const marker = active.closest<HTMLElement>("[data-extension-view]");
  return marker?.dataset.extensionView ?? null;
}

/** The `surfaceId` of the mounted extension surface containing focus. */
export function focusedExtensionSurfaceId(): string | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const marker = active.closest<HTMLElement>("[data-extension-surface]");
  return marker?.dataset.extensionSurface ?? null;
}

function bindingViewKey(binding: CommandBinding): string {
  return `${binding.hostKey}:${binding.viewId}`;
}

function bindingThreadKey(binding: CommandBinding): string | null {
  const { environmentId, threadId } = binding.context.resource;
  return threadId ? `${environmentId}:${threadId}` : null;
}

function whenContext(surfaceId: string | null): ShortcutMatchContext {
  const context: ShortcutMatchContext = {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    "thread.active": activeThreadRef !== null,
  };
  if (surfaceId) context[`extension.${surfaceId}.focus`] = true;
  return context;
}

export type ExtensionCommandDispatch =
  | { readonly kind: "dispatched" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unavailable" };

function dispatchContextFor(registration: CommandRegistration): ViewContext {
  const thread = activeThreadRef;
  const resource = thread
    ? {
        namespace: "t3.extensions",
        id: registration.installationId,
        environmentId: registration.environmentId,
        projectId: projectIdForThread(thread) ?? "",
        threadId: thread.threadId,
      }
    : registration.context.resource;
  return { client: registration.context.client, resource };
}

function projectIdForThread(ref: ScopedThreadRef): string | null {
  return readThreadShell(ref)?.projectId ?? null;
}

/**
 * Resolves one extension surface open for the activation fallback, applying
 * the same eligibility filter the native extension menu applies.
 */
function openActivationSurface(site: DispatchCommandSite): boolean {
  const { registration, command } = site;
  const activation = command.activation;
  const deps = environmentDeps.get(registration.environmentId);
  const thread = activeThreadRef;
  if (!activation || !deps || !thread || thread.environmentId !== registration.environmentId)
    return false;
  const shell = readThreadShell(thread);
  const projectId = shell?.projectId;
  if (
    !projectId ||
    !(deps.installationGrants(registration.installationId) ?? []).includes(projectId)
  )
    return false;
  const surface = deps
    .installationSurfaces(registration.installationId)
    ?.find((candidate) => candidate.id === activation.surfaceId);
  if (
    !surface ||
    !surface.clients.includes(deps.client) ||
    !surface.placements.includes(activation.placement)
  )
    return false;
  const project = readProject(scopeProjectRef(thread.environmentId, projectId));
  if (!project) return false;
  const context = installedWorkspaceContext({
    environmentId: thread.environmentId,
    projectId,
    threadId: thread.threadId,
    projectWorkspaceRoot: project.workspaceRoot,
    threadWorktreePath: shell?.worktreePath ?? null,
    client: deps.client,
  });
  const record = installedSurfaceRecord(
    registration.installationId,
    {
      id: surface.id,
      title: surface.title,
      placements: surface.placements as readonly (
        | "side-panel"
        | "bottom-dock"
        | "full-page"
        | "compact-detail"
      )[],
      clients: surface.clients,
      scope: surface.scope as "environment" | "project" | "thread",
      capabilities: [],
      stateVersion: surface.stateVersion,
    },
    activation.placement,
    context,
  );
  const store = useRightPanelStore.getState();
  const requested = extensionPanelSurface(thread, record);
  if (!requested) return false;
  const layout =
    activation.placement === "bottom-dock"
      ? selectThreadExtensionDock(store.extensionDockByThreadKey, thread)
      : selectThreadRightPanelState(store.byThreadKey, thread);
  const existing = layout.surfaces.find((entry) => entry.id === requested.id);
  if (existing) {
    if (activation.placement === "bottom-dock") store.activateDockExtension(thread, existing.id);
    else store.activateSurface(thread, existing.id);
    return true;
  }
  return store.openExtension(thread, record);
}

/**
 * The single ordered dispatch rule: focused binding → exactly-one
 * thread-matching binding → installation handler → activation fallback.
 */
export function dispatchExtensionCommand(commandName: string): ExtensionCommandDispatch {
  const sites = commandSites(commandName);
  if (sites.length === 0) return { kind: "unavailable" };
  const focusedView = focusedExtensionViewKey();
  const focusedSurface = focusedExtensionSurfaceId();
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const when = whenContext(focusedSurface);

  // (1) A focused view-session binding always wins, for any scope.
  for (const site of sites) {
    if (!matchesWhenClause(site.command.whenAst ?? undefined, when)) continue;
    for (const binding of bindings.values()) {
      if (binding.token !== site.registration.token) continue;
      if (bindingViewKey(binding) !== focusedView) continue;
      if (site.command.scope === "thread") {
        if (bindingThreadKey(binding) !== activeThreadKey) continue;
      }
      binding.handler({ commandId: site.command.id, context: binding.context });
      return { kind: "dispatched" };
    }
  }

  // (2) Global commands only: unfocused dispatch tiers.
  const globalSites = sites.filter(
    (site) =>
      site.command.scope === "global" && matchesWhenClause(site.command.whenAst ?? undefined, when),
  );
  for (const site of globalSites) {
    const eligible = [...bindings.values()].filter(
      (binding) =>
        binding.token === site.registration.token &&
        (activeThreadKey === null || bindingThreadKey(binding) === activeThreadKey),
    );
    if (eligible.length === 1) {
      eligible[0]!.handler({ commandId: site.command.id, context: eligible[0]!.context });
      return { kind: "dispatched" };
    }
    if (eligible.length > 1) return { kind: "ambiguous" };
  }

  // (3) The installation-level handler from registerGlobalCommands.
  for (const site of globalSites) {
    if (!site.registration.handler) continue;
    site.registration.handler({
      commandId: site.command.id,
      context: dispatchContextFor(site.registration),
    });
    return { kind: "dispatched" };
  }

  // (4) The activation record's host-owned openSurface fallback.
  for (const site of globalSites) {
    if (site.command.activation && openActivationSurface(site)) return { kind: "dispatched" };
  }

  return { kind: "unavailable" };
}

/**
 * Matches a keydown against plugin `defaultKey` declarations — consulted only
 * after the user's resolved keybindings miss, so user rules always win.
 */
export function extensionCommandForKeydown(
  event: ShortcutEventLike,
  platform = navigator.platform,
): string | null {
  const focusedSurface = focusedExtensionSurfaceId();
  const when = whenContext(focusedSurface);
  for (const registration of registrations.values()) {
    for (const command of registration.commands) {
      if (!command.defaultShortcut) continue;
      if (!matchesWhenClause(command.whenAst ?? undefined, when)) continue;
      if (!matchesShortcut(event, command.defaultShortcut, platform)) continue;
      return extensionCommandName(registration.installationId, command.id);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Palette enumeration + conflicts

export interface PaletteExtensionCommand {
  readonly command: string;
  readonly title: string;
  readonly installationId: string;
  readonly environmentId: string;
  readonly enabled: boolean;
}

export function listPaletteExtensionCommands(): readonly PaletteExtensionCommand[] {
  const items: PaletteExtensionCommand[] = [];
  const focusedView = focusedExtensionViewKey();
  const focusedSurface = focusedExtensionSurfaceId();
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const when = whenContext(focusedSurface);
  for (const registration of registrations.values()) {
    for (const command of registration.commands) {
      let enabled = matchesWhenClause(command.whenAst ?? undefined, when);
      if (enabled && command.scope !== "global") {
        enabled = [...bindings.values()].some(
          (binding) =>
            binding.token === registration.token &&
            bindingViewKey(binding) === focusedView &&
            (command.scope !== "thread" || bindingThreadKey(binding) === activeThreadKey),
        );
      } else if (enabled) {
        const eligible = [...bindings.values()].filter(
          (binding) =>
            binding.token === registration.token &&
            (activeThreadKey === null || bindingThreadKey(binding) === activeThreadKey),
        );
        enabled =
          eligible.length <= 1 &&
          (eligible.length === 1 ||
            registration.handler !== undefined ||
            command.activation !== undefined);
      }
      items.push({
        command: extensionCommandName(registration.installationId, command.id),
        title: command.title,
        installationId: registration.installationId,
        environmentId: registration.environmentId,
        enabled,
      });
    }
  }
  return items;
}

export function listExtensionCommandConflicts(environmentId: string): readonly {
  readonly command: string;
  readonly key: string;
  readonly winner: "user" | "native" | "plugin";
  readonly loser: string;
}[] {
  const conflicts: {
    command: string;
    key: string;
    winner: "user" | "native" | "plugin";
    loser: string;
  }[] = [];
  const seen = new Map<string, string>();
  for (const registration of registrations.values()) {
    if (registration.environmentId !== environmentId) continue;
    for (const command of registration.commands) {
      if (!command.defaultKey || !command.defaultShortcut) continue;
      const full = extensionCommandName(registration.installationId, command.id);
      const prior = seen.get(command.defaultKey);
      if (prior !== undefined) {
        conflicts.push({ command: full, key: command.defaultKey, winner: "plugin", loser: prior });
      } else {
        seen.set(command.defaultKey, full);
      }
    }
  }
  return conflicts;
}

// ---------------------------------------------------------------------------
// The t3.client/keybindings provider

export function createKeybindingsClientProvider(deps: ClientProviderAuthDeps): ClientLocalProvider {
  const environmentId = deps.environmentId;
  return {
    invoke(call: ClientProviderInvokeCall): Json {
      const installation = authorizeCaller(deps, call.caller, call.context, ["t3.ui/keybindings"]);
      const input = readInputObject(call.input);
      switch (call.method) {
        case "registerCommands": {
          const commands = input.commands;
          if (!Array.isArray(commands))
            throw new ClientProviderOpError("provider-rejected", "commands must be an array");
          const { commandSetToken, results } = registerCommands({
            environmentId,
            installationId: call.caller.installationId,
            installationGeneration: call.caller.installationGeneration,
            context: call.context,
            commands: commands as unknown as ExtensionCommandDescriptor[],
            capabilities: installation.grants.capabilities,
            installationScoped: input.installationScoped === true,
          });
          return { commandSetToken, results } as unknown as Json;
        }
        case "unregisterCommands": {
          const token = readInputString(input, "commandSetToken")!;
          return {
            unregistered: unregisterCommands(environmentId, token, call.caller.installationId),
          } as unknown as Json;
        }
        case "listConflicts": {
          return { conflicts: listExtensionCommandConflicts(environmentId) } as unknown as Json;
        }
        default:
          throw new ClientProviderOpError(
            "client-provider-unavailable",
            `Unknown keybindings op ${call.method}`,
          );
      }
    },
  };
}
