import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  type EnvironmentId,
  type PluginInstallation,
  type PluginInstallationId,
  type PluginInstallationManifest,
  type PluginNpmPackage,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  describePluginContributions,
  type PluginOfferedViews,
} from "@t3tools/client-runtime/state/pluginContributions";
import {
  describePluginNpmSource,
  PLUGIN_NPM_INTEGRITY_STATEMENT,
  PLUGIN_NPM_SCRIPTS_STATEMENT,
  pluginNpmInstallRequest,
  pluginNpmListKey,
  pluginNpmRowLabel,
  pluginNpmUpdateRequest,
  presentPluginNpmUpdate,
  resolvePluginNpmPackagesState,
  resolvePluginNpmProvenance,
  supportsPluginNpm,
  type PluginNpmStepMarker,
} from "@t3tools/client-runtime/state/pluginNpmPresentation";
import {
  canManagePlugins,
  createPluginActionGate,
  describePluginSource,
  explainedPluginAccess,
  PLUGIN_ACCESS_CHECKING,
  PLUGIN_DIGEST_STATEMENT,
  PLUGIN_DIRECTORY_GUIDANCE,
  pluginAccessStatus,
  pluginAddDirectory,
  pluginCommandErrorMessage,
  pluginDirectoryLocation,
  pluginManagementNotice,
  pluginTrustStatement,
  presentPluginInstallation,
  resolvePluginCatalogState,
  resolvePluginDetail,
  resolvePluginManageAccess,
  startPluginAddHandoff,
  type PluginActionSubject,
  type PluginManageAccess,
  type PluginStateTone,
} from "@t3tools/client-runtime/state/pluginPresentation";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { usePluginActionsSnapshot } from "../../state/plugin-actions";
import {
  pluginEnvironment,
  pluginNpmEnvironment,
  pluginViewEnvironment,
} from "../../state/plugins";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsActionRow } from "./components/SettingsActionRow";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";

type PluginRoutes = {
  SettingsPlugin: {
    readonly environmentId: EnvironmentId;
    readonly installationId: PluginInstallationId;
    /** Opened by adding: the latest catalogue revision when the add reply arrived; the snapshot listing it may still be on its way. */
    readonly addedAfterRevision?: number;
    /** Opened by installing from npm: the install's reply, until a later npm list read. */
    readonly npmInstalled?: PluginNpmPackage;
  };
  SettingsPluginAdd: { readonly environmentId: EnvironmentId };
  SettingsPluginNpmInstall: { readonly environmentId: EnvironmentId };
};

const TONE_TEXT: Record<PluginStateTone, string> = {
  neutral: "text-foreground-muted",
  success: "text-foreground",
  info: "text-foreground",
  warning: "text-warning-foreground",
  error: "text-danger-foreground",
};

/** Whether this environment's server has the plugin catalogue; older servers never get a plugin call. */
export function supportsPlugins(target: SettingsTarget): boolean {
  return target.serverConfig.environment.capabilities.plugins === true;
}

/** A command's value, or the server's message; an interrupted command has no message. */
async function settle<A, E>(
  command: Promise<AtomCommandResult<A, E>>,
): Promise<{ readonly value: A } | { readonly error: string | null }> {
  const result = await command;
  if (result._tag === "Success") return { value: result.value };
  return {
    error: isAtomCommandInterrupted(result)
      ? null
      : pluginCommandErrorMessage(squashAtomCommandFailure(result)),
  };
}

/** Lets callbacks created earlier (native alerts, multi-step actions) act only on what the screen still shows. */
function usePluginActionGate(current: PluginActionSubject | null) {
  const [gate] = useState(createPluginActionGate);
  useLayoutEffect(() => {
    gate.set(current);
    return () => gate.set(null);
  });
  return gate;
}

/** Management needs positive evidence of access:write from the current session read. */
function usePluginManageAccess(environmentId: EnvironmentId) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const result = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  const retry = useAtomRefresh(environmentSession.sessionStateAtom(environmentId));
  const access = resolvePluginManageAccess({
    session,
    isPending: result.waiting,
    hasError: AsyncResult.isFailure(result),
  });
  return { access, retry };
}

/** The catalogue of a connected environment that supports plugins; anything else gets no call. */
function usePluginCatalog(environmentId: EnvironmentId, environment: SettingsTarget | undefined) {
  const supported = environment !== undefined && supportsPlugins(environment);
  const catalog = useEnvironmentQuery(
    supported ? pluginEnvironment.catalog({ environmentId, input: {} }) : null,
  );
  const state = resolvePluginCatalogState({
    connected: environment !== undefined,
    data: supported ? catalog.data : { _tag: "unsupported" },
    error: catalog.error,
  });
  return { data: catalog.data, state, retry: catalog.refresh };
}

/** The access and catalogue that decide whether one environment's plugins can be managed. */
function usePluginManagement(
  environmentId: EnvironmentId,
  environment: SettingsTarget | undefined,
) {
  const catalog = usePluginCatalog(environmentId, environment);
  const { access, retry: retryAccess } = usePluginManageAccess(environmentId);
  // Through a re-check, explain the last settled access so no notice comes and goes.
  const [settledAccess, setSettledAccess] = useState<PluginManageAccess | null>(null);
  if (access !== "pending" && access !== settledAccess) setSettledAccess(access);
  const explainedAccess = explainedPluginAccess(access, settledAccess);
  return {
    catalog,
    retryAccess: explainedAccess === "unreadable" ? retryAccess : null,
    canManage: canManagePlugins(access, catalog.state),
    notice: pluginManagementNotice(
      explainedAccess,
      catalog.state,
      environment?.label ?? "this environment",
    ),
    status: pluginAccessStatus(access, catalog.state),
  };
}

/** Calls `refresh` when `key` changes from one known value to another; never on a timer. */
function useRefreshOnChange(key: string | null, refresh: () => void) {
  const last = useRef(key);
  useEffect(() => {
    const previous = last.current;
    last.current = key;
    if (previous !== null && key !== null && previous !== key) refresh();
  }, [key, refresh]);
}

/**
 * Where an environment's plugins came from on npm. An older server gets no call.
 * The list is a query, so it is read again when installations or their files change.
 */
function usePluginNpmPackages(
  environmentId: EnvironmentId,
  environment: SettingsTarget | undefined,
  installations: ReadonlyArray<PluginInstallation> | null,
) {
  const supported =
    environment !== undefined &&
    supportsPluginNpm(environment.serverConfig.environment.capabilities);
  const query = useEnvironmentQuery(
    supported ? pluginNpmEnvironment.packages({ environmentId, input: {} }) : null,
  );
  useRefreshOnChange(
    supported && installations !== null ? pluginNpmListKey(installations) : null,
    query.refresh,
  );
  return {
    supported,
    state: resolvePluginNpmPackagesState({ supported, data: query.data, error: query.error }),
    refresh: query.refresh,
  };
}

/**
 * A section-header status sized by an invisible copy of its text, so showing or
 * clearing the brief access check changes neither the header nor how its title wraps.
 */
function AccessStatus({ status }: { readonly status: string | null }) {
  return (
    <View className="px-2">
      <Text aria-hidden numberOfLines={1} className="text-sm opacity-0">
        {PLUGIN_ACCESS_CHECKING}
      </Text>
      <Text numberOfLines={1} className="absolute inset-x-2 top-0 text-sm text-foreground-muted">
        {status}
      </Text>
    </View>
  );
}

/** Why controls are off for a lasting reason, with a retry when another read could turn them on. */
function ManagementNotice({
  notice,
  onRetry,
}: {
  readonly notice: string | null;
  readonly onRetry: (() => void) | null;
}) {
  if (notice === null) return null;
  return (
    <View className="gap-2">
      <Text className="px-2 text-sm text-foreground-muted">{notice}</Text>
      {onRetry ? (
        <SettingsSection>
          <SettingsActionRow icon="arrow.clockwise" label="Check access again" onPress={onRetry} />
        </SettingsSection>
      ) : null}
    </View>
  );
}

const SCROLL_PROPS = {
  keyboardShouldPersistTaps: "handled",
  contentInsetAdjustmentBehavior: "automatic",
  showsVerticalScrollIndicator: false,
  className: "flex-1",
  contentContainerClassName: "gap-5 px-5 pt-4",
} as const;

export function SettingsPluginsRouteScreen() {
  const insets = useSafeAreaInsets();
  const { availableTargets, selectedTargets } = useSettingsEnvironmentFilter();
  const targets = selectedTargets.filter(supportsPlugins);
  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Plugins" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          {...SCROLL_PROPS}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {targets.length > 0 ? (
            targets.map((target) => (
              <EnvironmentPlugins key={target.environmentId} environment={target} />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {availableTargets.length === 0
                ? "Connect an environment to manage its plugins."
                : "Update T3 Code on the selected environments to manage plugins."}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function EnvironmentPlugins({ environment }: { readonly environment: SettingsTarget }) {
  const navigation = useNavigation<NativeStackNavigationProp<PluginRoutes>>();
  const environmentId = environment.environmentId;
  const { catalog, retryAccess, canManage, notice, status } = usePluginManagement(
    environmentId,
    environment,
  );
  const installations =
    catalog.state._tag === "available" ? catalog.state.view.installations : null;
  const npm = usePluginNpmPackages(environmentId, environment, installations);
  if (catalog.state._tag === "unsupported") return null;
  return (
    <View className="gap-2">
      <SettingsSection
        title={environment.label}
        titleIcon={
          <EnvironmentMachineSymbol
            kind={resolveEnvironmentMachineKind(environment.serverConfig)}
            size={16}
            tintColorClassName={
              Platform.OS === "android" ? "accent-primary" : "accent-foreground-muted"
            }
          />
        }
        trailing={<AccessStatus status={status} />}
      >
        {catalog.state._tag === "failed" ? (
          <>
            <Text className="p-4 text-base text-danger-foreground">{catalog.state.message}</Text>
            <View className="border-t border-border-subtle">
              <SettingsActionRow icon="arrow.clockwise" label="Retry" onPress={catalog.retry} />
            </View>
          </>
        ) : installations === null ? (
          <Text className="p-4 text-base text-foreground-muted">Loading plugins…</Text>
        ) : (
          <>
            {installations.length === 0 ? (
              <Text className="p-4 text-base text-foreground-muted">No plugins yet.</Text>
            ) : (
              installations.map((installation, index) => (
                <PluginListRow
                  key={installation.installationId}
                  installation={installation}
                  npmPackage={npmPackageOf(npm.state, installation.installationId)}
                  first={index === 0}
                  onPress={() =>
                    navigation.navigate("SettingsPlugin", {
                      environmentId,
                      installationId: installation.installationId,
                    })
                  }
                />
              ))
            )}
            <View className="border-t border-border-subtle">
              <SettingsActionRow
                icon="plus"
                label="Add plugin"
                disabled={!canManage}
                onPress={() => navigation.navigate("SettingsPluginAdd", { environmentId })}
              />
              {npm.supported ? (
                <SettingsActionRow
                  icon="arrow.down.circle"
                  label="Install from npm"
                  disabled={!canManage}
                  onPress={() => navigation.navigate("SettingsPluginNpmInstall", { environmentId })}
                />
              ) : null}
            </View>
          </>
        )}
      </SettingsSection>
      {installations !== null ? <ManagementNotice notice={notice} onRetry={retryAccess} /> : null}
    </View>
  );
}

/** The npm package behind a listed installation, from the list alone. */
function npmPackageOf(
  state: ReturnType<typeof resolvePluginNpmPackagesState>,
  installationId: PluginInstallationId,
): PluginNpmPackage | null {
  const provenance = resolvePluginNpmProvenance({ state, installationId, step: null });
  return provenance._tag === "found" ? provenance.package : null;
}

function PluginListRow({
  installation,
  npmPackage,
  first,
  onPress,
}: {
  readonly installation: PluginInstallation;
  readonly npmPackage: PluginNpmPackage | null;
  readonly first: boolean;
  readonly onPress: () => void;
}) {
  const view = presentPluginInstallation(installation);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${view.title}, ${view.stateLabel}${view.delivery ? `, ${view.delivery.label}` : ""}`}
      onPress={onPress}
      className={
        first
          ? "flex-row items-center gap-3 px-4 py-4 active:opacity-70"
          : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-4 active:opacity-70"
      }
    >
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-lg font-t3-medium text-foreground" numberOfLines={1}>
          {view.title}
          {installation.manifest ? (
            <Text className="text-sm text-foreground-muted"> {installation.manifest.version}</Text>
          ) : null}
        </Text>
        <Text className={`text-sm ${TONE_TEXT[view.tone]}`} numberOfLines={2}>
          {view.stateLabel}
          {view.detail ? ` · ${view.detail}` : ""}
        </Text>
        {view.delivery ? (
          <Text className={`text-sm ${TONE_TEXT[view.delivery.tone]}`} numberOfLines={2}>
            {view.delivery.label}
            {view.delivery.detail ? ` · ${view.delivery.detail}` : ""}
          </Text>
        ) : null}
        {npmPackage ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={2}>
            {pluginNpmRowLabel(npmPackage)}
          </Text>
        ) : null}
        <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
          {installation.directory}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={16} tintColorClassName="accent-chevron" />
    </Pressable>
  );
}

function DetailField({
  label,
  value,
  mono = false,
  first = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly first?: boolean;
}) {
  return (
    <View className={first ? "gap-1 px-4 py-3" : "gap-1 border-t border-border-subtle px-4 py-3"}>
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <Text
        selectable
        className={mono ? "font-mono text-sm text-foreground" : "text-base text-foreground"}
      >
        {value}
      </Text>
    </View>
  );
}

export function SettingsPluginRouteScreen({
  route,
}: StaticScreenProps<PluginRoutes["SettingsPlugin"]>) {
  return (
    <PluginDetail
      key={`${route.params.environmentId}:${route.params.installationId}`}
      environmentId={route.params.environmentId}
      installationId={route.params.installationId}
      addedAfterRevision={route.params.addedAfterRevision ?? null}
      npmInstalled={route.params.npmInstalled ?? null}
    />
  );
}

function PluginDetail({
  environmentId,
  installationId,
  addedAfterRevision,
  npmInstalled,
}: {
  readonly environmentId: EnvironmentId;
  readonly installationId: PluginInstallationId;
  readonly addedAfterRevision: number | null;
  readonly npmInstalled: PluginNpmPackage | null;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { availableTargets } = useSettingsEnvironmentFilter();
  const environment = availableTargets.find((target) => target.environmentId === environmentId);
  const label = environment?.label ?? "this environment";
  const { catalog, retryAccess, canManage, notice, status } = usePluginManagement(
    environmentId,
    environment,
  );
  const detail = resolvePluginDetail({
    catalog: catalog.state,
    installationId,
    added:
      addedAfterRevision === null
        ? null
        : { afterRevision: addedAfterRevision, installation: null },
  });
  const installation = detail._tag === "found" ? detail.installation : null;
  const npm = usePluginNpmPackages(
    environmentId,
    environment,
    catalog.state._tag === "available" ? catalog.state.view.installations : null,
  );
  const npmList = npm.state._tag === "available" ? npm.state.list : null;
  // The latest npm step's outcome, until a list read after it arrives. An install's
  // reply counts from the list this screen first saw.
  const [npmStep, setNpmStep] = useState<PluginNpmStepMarker | null>(() =>
    npmInstalled === null ? null : { list: npmList, reply: npmInstalled },
  );
  const provenance = resolvePluginNpmProvenance({
    state: npm.state,
    installationId,
    step: npmStep,
  });
  const npmPackage = provenance._tag === "found" ? provenance.package : null;
  const settleNpmStep = (reply: PluginNpmPackage | null) => {
    setNpmStep({ list: npmList, reply });
    npm.refresh();
  };
  // The digest the user acknowledged; new bytes need a new acknowledgement.
  const [trustedDigest, setTrustedDigest] = useState<string | null>(null);
  const digest = installation?.source?.digest ?? null;
  const acknowledged = digest !== null && trustedDigest === digest;
  const gate = usePluginActionGate(
    canManage && installation !== null
      ? { environmentId, installation, acknowledgedDigest: acknowledged ? digest : null }
      : null,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consent = useAtomCommand(pluginEnvironment.consent, "plugin consent");
  const enable = useAtomCommand(pluginEnvironment.enable, "plugin enable");
  const disable = useAtomCommand(pluginEnvironment.disable, "plugin disable");
  const resume = useAtomCommand(pluginEnvironment.resume, "plugin resume");
  const refresh = useAtomCommand(pluginEnvironment.refresh, "plugin refresh");
  const remove = useAtomCommand(pluginEnvironment.remove, "plugin remove");

  // Every action, including a Remove confirmed in an already-open alert, re-checks the gate.
  const run = async (
    key: string,
    steps: Parameters<typeof gate.run>[1],
    approvedDigest?: string,
  ) => {
    let started = false;
    const actionTarget = {
      environmentId,
      installationId,
      ...(approvedDigest === undefined ? {} : { approvedDigest }),
    };
    const outcome = await gate.run(actionTarget, steps, () => {
      started = true;
      setPending(key);
      setError(null);
    });
    if (started) setPending(null);
    if (outcome._tag === "failed") setError(outcome.error);
    return outcome._tag === "done";
  };

  if (installation === null) {
    return (
      <SettingsScreen title="Plugin">
        <ScrollView {...SCROLL_PROPS}>
          {detail._tag === "failed" ? (
            <SettingsSection title="Could not load plugins">
              <Text selectable className="p-4 text-base text-danger-foreground">
                {detail.message}
              </Text>
              <View className="border-t border-border-subtle">
                <SettingsActionRow icon="arrow.clockwise" label="Retry" onPress={catalog.retry} />
              </View>
            </SettingsSection>
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              {detail._tag === "missing"
                ? `This plugin is no longer installed on ${label}.`
                : detail._tag === "loading"
                  ? "Loading plugin…"
                  : notice}
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    );
  }

  const view = presentPluginInstallation(installation);
  const disabled = !canManage || pending !== null;
  const target = { environmentId, input: { installationId } };
  const manifest = installation.manifest;

  return (
    <SettingsScreen title={view.title}>
      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="gap-1 px-2">
          <Text className={`text-base ${TONE_TEXT[view.tone]}`}>{view.stateLabel}</Text>
          {view.detail ? (
            <Text selectable className="text-sm text-foreground-muted">
              {view.detail}
            </Text>
          ) : null}
          {view.delivery ? (
            <>
              <Text className={`text-base ${TONE_TEXT[view.delivery.tone]}`}>
                {view.delivery.label}
              </Text>
              {view.delivery.detail ? (
                <Text selectable className="text-sm text-foreground-muted">
                  {view.delivery.detail}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
        <SettingsSection title="Plugin">
          {manifest ? (
            <>
              <DetailField first label="Plugin ID" value={manifest.id} mono />
              <DetailField label="Version" value={manifest.version} />
              {manifest.description ? (
                <DetailField label="Description" value={manifest.description} />
              ) : null}
            </>
          ) : null}
          {npmPackage ? (
            <>
              <DetailField
                first={manifest === null}
                label="Package"
                value={describePluginNpmSource(npmPackage)}
              />
              <DetailField
                label="Integrity"
                value={`${npmPackage.source.integrity}\n${PLUGIN_NPM_INTEGRITY_STATEMENT}`}
                mono
              />
            </>
          ) : provenance._tag === "checking" ? (
            <DetailField
              first={manifest === null}
              label="Package"
              value="Checking what is installed…"
            />
          ) : null}
          <DetailField
            first={manifest === null}
            label={`Directory on ${label}`}
            value={installation.directory}
            mono
          />
          <DetailField
            label="Files"
            value={installation.source ? describePluginSource(installation.source) : "Unreadable"}
          />
          {digest !== null ? <DetailField label="Digest" value={digest} mono /> : null}
          {manifest ? (
            <DetailField
              label="Capabilities"
              value={
                (manifest.capabilities.length === 0
                  ? "None declared"
                  : manifest.capabilities.join(", ")) +
                (manifest.proposedApi
                  ? "\nUses proposed APIs that may change between T3 Code versions."
                  : "")
              }
            />
          ) : null}
          {installation.problem ? (
            <DetailField label="Problem" value={installation.problem} />
          ) : null}
        </SettingsSection>

        {manifest ? (
          <PluginContributionsSection
            environmentId={environmentId}
            environment={environment}
            manifest={manifest}
            installation={installation}
            title="Contributes"
          />
        ) : null}

        {view.canReview ? (
          <SettingsSection title="Trusted local code" trailing={<AccessStatus status={status} />}>
            <View className="gap-2 p-4">
              <Text className="text-sm text-foreground">{pluginTrustStatement(label)}</Text>
              <Text className="text-sm text-foreground-muted">{PLUGIN_DIGEST_STATEMENT}</Text>
              {npmPackage ? (
                <Text className="text-sm text-foreground-muted">
                  {PLUGIN_NPM_SCRIPTS_STATEMENT}
                </Text>
              ) : null}
            </View>
            <View className="flex-row items-center gap-3 border-t border-border-subtle px-4 py-3">
              <Text className="min-w-0 flex-1 text-base text-foreground">
                I trust this code to run as my user on {label}
              </Text>
              <ThemedSwitch
                accessibilityLabel={`I trust this code to run as my user on ${label}`}
                value={acknowledged}
                disabled={disabled || digest === null}
                onValueChange={(value) => setTrustedDigest(value ? digest : null)}
              />
            </View>
            <View className="border-t border-border-subtle">
              <SettingsActionRow
                icon="checkmark.circle"
                label="Approve and enable"
                disabled={disabled || !acknowledged}
                loading={pending === "approve"}
                onPress={() => {
                  if (digest === null || !acknowledged) return;
                  // Bound to these exact files: new bytes stop it before enable.
                  void run(
                    "approve",
                    [
                      () => settle(consent({ environmentId, input: { installationId, digest } })),
                      () => settle(enable(target)),
                    ],
                    digest,
                  );
                }}
              />
              {npmPackage !== null && installation.consent === null ? (
                // A download nobody approved yet: removing it deletes the server's copy.
                <SettingsActionRow
                  icon="trash"
                  label="Discard download"
                  tone="danger"
                  disabled={disabled}
                  loading={pending === "discard"}
                  onPress={() =>
                    void run("discard", [() => settle(remove(target))]).then((removed) => {
                      if (removed) navigation.goBack();
                    })
                  }
                />
              ) : null}
            </View>
          </SettingsSection>
        ) : null}

        {npm.state._tag === "failed" ? (
          <SettingsSection title="npm package">
            <Text selectable className="p-4 text-base text-danger-foreground">
              {npm.state.message}
            </Text>
            <View className="border-t border-border-subtle">
              <SettingsActionRow icon="arrow.clockwise" label="Retry" onPress={npm.refresh} />
            </View>
          </SettingsSection>
        ) : !view.canReview && provenance._tag !== "none" ? (
          <PluginNpmUpdateSection
            environmentId={environmentId}
            environment={environment}
            label={label}
            installation={installation}
            pkg={npmPackage}
            canManage={canManage}
            status={status}
            onSettled={settleNpmStep}
          />
        ) : null}

        <SettingsSection title="Manage" trailing={<AccessStatus status={status} />}>
          {view.canEnable ? (
            <SettingsActionRow
              icon="play"
              label="Enable"
              disabled={disabled}
              loading={pending === "enable"}
              onPress={() => void run("enable", [() => settle(enable(target))])}
            />
          ) : null}
          {view.canDisable ? (
            <SettingsActionRow
              icon="stop.fill"
              label="Disable"
              disabled={disabled}
              loading={pending === "disable"}
              onPress={() => void run("disable", [() => settle(disable(target))])}
            />
          ) : null}
          {view.canResume ? (
            <SettingsActionRow
              icon="arrow.clockwise"
              label="Resume"
              disabled={disabled}
              loading={pending === "resume"}
              onPress={() => void run("resume", [() => settle(resume(target))])}
            />
          ) : null}
          <SettingsActionRow
            icon="doc.text"
            label="Check files again"
            disabled={disabled}
            loading={pending === "refresh"}
            onPress={() => void run("refresh", [() => settle(refresh(target))])}
          />
          <SettingsActionRow
            icon="trash"
            label="Remove"
            tone="danger"
            disabled={disabled}
            loading={pending === "remove"}
            onPress={() =>
              Alert.alert(
                `Remove ${view.title}?`,
                npmPackage
                  ? `T3 Code stops the plugin, forgets your approval, and deletes the copy of ${npmPackage.source.name} it downloaded to ${label}'s machine.`
                  : `T3 Code stops the plugin and forgets your approval. Its directory stays on ${label}'s machine.`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Remove",
                    style: "destructive",
                    onPress: () =>
                      void run("remove", [() => settle(remove(target))]).then((removed) => {
                        if (removed) navigation.goBack();
                      }),
                  },
                ],
              )
            }
          />
        </SettingsSection>

        <ManagementNotice notice={notice} onRetry={retryAccess} />
        {error ? (
          <Text selectable className="px-2 text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SettingsScreen>
  );
}

export function SettingsPluginAddRouteScreen({
  route,
}: StaticScreenProps<PluginRoutes["SettingsPluginAdd"]>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<PluginRoutes>>();
  const environmentId = route.params.environmentId;
  const { availableTargets } = useSettingsEnvironmentFilter();
  const environment = availableTargets.find((target) => target.environmentId === environmentId);
  const label = environment?.label ?? "this environment";
  const { catalog, retryAccess, canManage, notice, status } = usePluginManagement(
    environmentId,
    environment,
  );
  const add = useAtomCommand(pluginEnvironment.add, "plugin add");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = pluginAddDirectory({ canManage, busy, directory });

  // The keyboard's Done key and the action row share this gate.
  const submit = async () => {
    if (trimmed === null) return;
    setBusy(true);
    setError(null);
    const outcome = await settle(add({ environmentId, input: { directory: trimmed } }));
    setBusy(false);
    if ("value" in outcome) {
      const marker = startPluginAddHandoff({ installation: null, restartCatalog: catalog.retry });
      navigation.replace("SettingsPlugin", {
        environmentId,
        installationId: outcome.value.installation.installationId,
        addedAfterRevision: marker.afterRevision,
      });
    } else setError(outcome.error);
  };

  return (
    <SettingsScreen title="Add plugin">
      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Plugin directory" trailing={<AccessStatus status={status} />}>
          <View className="px-4 py-3">
            <TextInput
              accessibilityLabel="Plugin directory"
              value={directory}
              onChangeText={setDirectory}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={4096}
              readOnly={busy || !canManage}
              placeholder="/path/to/plugin"
              placeholderTextColorClassName="accent-foreground-muted"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              className="min-h-8 font-mono text-base text-foreground"
            />
          </View>
          <View className="border-t border-border-subtle">
            <SettingsActionRow
              icon="plus"
              label="Add and review"
              disabled={trimmed === null}
              loading={busy}
              onPress={() => void submit()}
            />
          </View>
        </SettingsSection>
        <View className="gap-2 px-2">
          <Text className="text-sm text-foreground-muted">
            {pluginDirectoryLocation(label, "other-device")}
          </Text>
          <Text className="text-sm text-foreground-muted">{PLUGIN_DIRECTORY_GUIDANCE}</Text>
          {error ? (
            <Text selectable className="text-sm text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </View>
        <ManagementNotice notice={notice} onRetry={retryAccess} />
      </ScrollView>
    </SettingsScreen>
  );
}

/**
 * What a plugin adds to T3 Code, from its manifest summary. For the enabled
 * installation, the environment's action and view snapshots say what is offered
 * now; listing them never starts the plugin. `installation` is null for a
 * manifest that is not installed yet, such as a downloaded update.
 */
function PluginContributionsSection({
  environmentId,
  environment,
  manifest,
  installation,
  title,
}: {
  readonly environmentId: EnvironmentId;
  readonly environment: SettingsTarget | undefined;
  readonly manifest: PluginInstallationManifest;
  readonly installation: PluginInstallation | null;
  readonly title: string;
}) {
  const capabilities = environment?.serverConfig.environment.capabilities;
  const offered = installation !== null && installation.enabled;
  const actions = usePluginActionsSnapshot(
    offered && capabilities?.pluginActions === true ? environmentId : null,
  );
  const views = useEnvironmentQuery(
    offered && capabilities?.pluginViews === true
      ? pluginViewEnvironment.views({ environmentId, input: {} })
      : null,
  ).data;
  const offeredViews: PluginOfferedViews | null =
    installation !== null && views?._tag === "available"
      ? {
          views: views.views.filter(
            (view) =>
              view.installationId === installation.installationId &&
              view.generation === installation.generation,
          ),
          problems: views.problems.filter(
            (problem) =>
              problem.installationId === installation.installationId &&
              problem.generation === installation.generation,
          ),
        }
      : null;
  const groups = describePluginContributions({
    manifest,
    installation,
    actions: actions ?? null,
    views: offeredViews,
  });
  return (
    <SettingsSection title={title}>
      {groups.length === 0 ? (
        <Text className="p-4 text-base text-foreground-muted">Nothing declared</Text>
      ) : (
        groups.map((group, index) => (
          <View
            key={group.kind}
            className={
              index === 0 ? "gap-2 px-4 py-3" : "gap-2 border-t border-border-subtle px-4 py-3"
            }
          >
            <Text className="text-sm text-foreground-muted">{group.label}</Text>
            {group.items.map((item) => (
              <View key={item.key} className="gap-0.5">
                <Text selectable className="text-base text-foreground">
                  {item.title}
                </Text>
                {item.detail ? (
                  <Text selectable className="text-sm text-foreground-muted">
                    {item.detail}
                  </Text>
                ) : null}
              </View>
            ))}
            {group.notice ? (
              <Text className="text-sm text-warning-foreground">{group.notice}</Text>
            ) : null}
          </View>
        ))
      )}
    </SettingsSection>
  );
}

/**
 * Updating an npm installation: download a version next to the installed one,
 * review it, then apply it, which approves its files. `pkg` is null while the
 * screen checks what is installed after a step whose outcome it does not know.
 */
function PluginNpmUpdateSection({
  environmentId,
  environment,
  label,
  installation,
  pkg,
  canManage,
  status,
  onSettled,
}: {
  readonly environmentId: EnvironmentId;
  readonly environment: SettingsTarget | undefined;
  readonly label: string;
  readonly installation: PluginInstallation;
  readonly pkg: PluginNpmPackage | null;
  readonly canManage: boolean;
  readonly status: string | null;
  /** Called after every step that ran, with its reply or null when it failed. */
  readonly onSettled: (reply: PluginNpmPackage | null) => void;
}) {
  const installationId = installation.installationId;
  const [version, setVersion] = useState("");
  // The downloaded update's digest the user acknowledged; another download needs a new one.
  const [trustedDigest, setTrustedDigest] = useState<string | null>(null);
  const [pending, setPending] = useState<"download" | "apply" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const stageUpdate = useAtomCommand(pluginNpmEnvironment.stageUpdate, "plugin update download");
  const applyUpdate = useAtomCommand(pluginNpmEnvironment.applyUpdate, "plugin update");
  const discardUpdate = useAtomCommand(pluginNpmEnvironment.discardUpdate, "plugin update discard");
  const update = pkg ? presentPluginNpmUpdate(installation, pkg) : null;
  const stagedDigest = update?.update.source.digest ?? null;
  const acknowledged = stagedDigest !== null && trustedDigest === stagedDigest;
  const gate = usePluginActionGate(
    canManage && pkg !== null
      ? {
          environmentId,
          installation,
          acknowledgedDigest: null,
          stagedUpdateDigest: stagedDigest,
          acknowledgedUpdateDigest: acknowledged ? stagedDigest : null,
        }
      : null,
  );
  const request = pluginNpmUpdateRequest({ canManage, busy: pending !== null, version });
  const disabled = !canManage || pending !== null;

  const run = async (
    key: "download" | "apply" | "discard",
    step: () => Promise<
      { readonly value: { readonly package: PluginNpmPackage } } | { readonly error: string | null }
    >,
    approvedUpdateDigest?: string,
  ) => {
    let started = false;
    const reply: { current: PluginNpmPackage | null } = { current: null };
    const outcome = await gate.run(
      {
        environmentId,
        installationId,
        ...(approvedUpdateDigest === undefined ? {} : { approvedUpdateDigest }),
      },
      [
        async () => {
          const settled = await step();
          if ("value" in settled) reply.current = settled.value.package;
          return settled;
        },
      ],
      () => {
        started = true;
        setPending(key);
        setError(null);
        setApplied(null);
      },
    );
    if (!started) return false;
    setPending(null);
    onSettled(reply.current);
    if (outcome._tag === "failed") setError(outcome.error);
    return outcome._tag === "done";
  };

  // The keyboard's Done key and the action row share this gate.
  const download = async () => {
    if (request._tag !== "ready") return;
    if (
      await run("download", () =>
        settle(stageUpdate({ environmentId, input: { installationId, version: request.input } })),
      )
    )
      setVersion("");
  };

  return (
    <>
      <SettingsSection title="Updates" trailing={<AccessStatus status={status} />}>
        {pkg === null ? (
          <Text className="p-4 text-base text-foreground-muted">Checking what is installed…</Text>
        ) : update === null ? (
          <>
            <View className="gap-1 px-4 py-3">
              <Text className="text-sm text-foreground-muted">Version or tag</Text>
              <TextInput
                accessibilityLabel="Version or tag"
                value={version}
                onChangeText={setVersion}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={256}
                readOnly={disabled}
                placeholder="latest"
                placeholderTextColorClassName="accent-foreground-muted"
                returnKeyType="done"
                onSubmitEditing={() => void download()}
                className="min-h-8 font-mono text-base text-foreground"
              />
            </View>
            <View className="border-t border-border-subtle">
              <SettingsActionRow
                icon="arrow.down.circle"
                label="Download update"
                disabled={request._tag !== "ready"}
                loading={pending === "download"}
                onPress={() => void download()}
              />
            </View>
          </>
        ) : (
          <>
            <DetailField
              first
              label="New version"
              value={`${update.update.version}${update.sameAsInstalled ? " (the files already installed)" : ""}`}
            />
            <DetailField label="Integrity" value={update.update.integrity} mono />
            <DetailField label="Files" value={describePluginSource(update.update.source)} />
            <DetailField label="Digest" value={update.update.source.digest} mono />
            <DetailField
              label="Capabilities"
              value={[
                update.update.manifest.capabilities.length === 0
                  ? "None declared"
                  : update.update.manifest.capabilities.join(", "),
                update.addedCapabilities.length > 0
                  ? `New: ${update.addedCapabilities.join(", ")}`
                  : null,
                update.removedCapabilities.length > 0
                  ? `No longer declared: ${update.removedCapabilities.join(", ")}`
                  : null,
              ]
                .filter((line) => line !== null)
                .join("\n")}
            />
            <View className="gap-2 border-t border-border-subtle p-4">
              <Text className="text-sm text-foreground-muted">
                Nothing in the download has run. Applying approves these files in place of the
                installed ones. If anything fails before that, the installed version stays. A server
                restart discards the download.
              </Text>
            </View>
            <View className="flex-row items-center gap-3 border-t border-border-subtle px-4 py-3">
              <Text className="min-w-0 flex-1 text-base text-foreground">
                I trust version {update.update.version} to run as my user on {label}
              </Text>
              <ThemedSwitch
                accessibilityLabel={`I trust version ${update.update.version} to run as my user on ${label}`}
                value={acknowledged}
                disabled={disabled}
                onValueChange={(value) => setTrustedDigest(value ? stagedDigest : null)}
              />
            </View>
            <View className="border-t border-border-subtle">
              <SettingsActionRow
                icon="checkmark.circle"
                label="Apply update"
                disabled={disabled || !acknowledged}
                loading={pending === "apply"}
                onPress={() => {
                  if (stagedDigest === null || !acknowledged) return;
                  // Bound to the files the user reviewed: another download stops it before it is sent.
                  void run(
                    "apply",
                    () =>
                      settle(
                        applyUpdate({
                          environmentId,
                          input: { installationId, digest: stagedDigest },
                        }),
                      ),
                    stagedDigest,
                  ).then((done) => {
                    if (done) setApplied(update.update.version);
                  });
                }}
              />
              <SettingsActionRow
                icon="trash"
                label="Discard update"
                tone="danger"
                disabled={disabled}
                loading={pending === "discard"}
                onPress={() =>
                  void run("discard", () =>
                    settle(discardUpdate({ environmentId, input: { installationId } })),
                  )
                }
              />
            </View>
          </>
        )}
      </SettingsSection>
      {update !== null ? (
        <PluginContributionsSection
          environmentId={environmentId}
          environment={environment}
          manifest={update.update.manifest}
          installation={null}
          title={`Version ${update.update.version} contributes`}
        />
      ) : null}
      <View className="gap-2 px-2">
        {request._tag === "invalid" && update === null && pkg !== null ? (
          <Text className="text-sm text-danger-foreground">{request.message}</Text>
        ) : null}
        {update === null && pkg !== null ? (
          <Text className="text-sm text-foreground-muted">
            Downloads that version next to the installed one and checks it. The installed version
            keeps running until you apply the update.
          </Text>
        ) : null}
        {applied ? <Text className="text-sm text-foreground">Updated to {applied}.</Text> : null}
        {error ? (
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>
    </>
  );
}

export function SettingsPluginNpmInstallRouteScreen({
  route,
}: StaticScreenProps<PluginRoutes["SettingsPluginNpmInstall"]>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<PluginRoutes>>();
  const environmentId = route.params.environmentId;
  const { availableTargets } = useSettingsEnvironmentFilter();
  const environment = availableTargets.find((target) => target.environmentId === environmentId);
  const label = environment?.label ?? "this environment";
  const { catalog, retryAccess, canManage, notice, status } = usePluginManagement(
    environmentId,
    environment,
  );
  const install = useAtomCommand(pluginNpmEnvironment.add, "plugin install from npm");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [registry, setRegistry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = pluginNpmInstallRequest({ canManage, busy, name, version, registry });
  const locked = busy || !canManage;

  // Every field's Done key and the action row share this gate.
  const submit = async () => {
    if (request._tag !== "ready") return;
    setBusy(true);
    setError(null);
    const outcome = await settle(install({ environmentId, input: request.input }));
    setBusy(false);
    if ("value" in outcome) {
      const marker = startPluginAddHandoff({ installation: null, restartCatalog: catalog.retry });
      navigation.replace("SettingsPlugin", {
        environmentId,
        installationId: outcome.value.installation.installationId,
        addedAfterRevision: marker.afterRevision,
        npmInstalled: outcome.value.package,
      });
    } else setError(outcome.error);
  };

  const field = (
    fieldLabel: string,
    value: string,
    onChange: (text: string) => void,
    placeholder: string,
    maxLength: number,
    first = false,
  ) => (
    <View className={first ? "gap-1 px-4 py-3" : "gap-1 border-t border-border-subtle px-4 py-3"}>
      <Text className="text-sm text-foreground-muted">{fieldLabel}</Text>
      <TextInput
        accessibilityLabel={fieldLabel}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={first}
        maxLength={maxLength}
        readOnly={locked}
        placeholder={placeholder}
        placeholderTextColorClassName="accent-foreground-muted"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        className="min-h-8 font-mono text-base text-foreground"
      />
    </View>
  );

  return (
    <SettingsScreen title="Install from npm">
      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Package" trailing={<AccessStatus status={status} />}>
          {field("Package name", name, setName, "t3-notifier or @acme/t3-notifier", 214, true)}
          {field("Version or tag", version, setVersion, "latest", 256)}
          {field("Registry (optional)", registry, setRegistry, "https://registry.npmjs.org", 2048)}
          <View className="border-t border-border-subtle">
            <SettingsActionRow
              icon="arrow.down.circle"
              label="Download and review"
              disabled={request._tag !== "ready"}
              loading={busy}
              onPress={() => void submit()}
            />
          </View>
        </SettingsSection>
        <View className="gap-2 px-2">
          {request._tag === "invalid" ? (
            <Text className="text-sm text-danger-foreground">{request.message}</Text>
          ) : null}
          <Text className="text-sm text-foreground-muted">
            {label} downloads the package, checks it against the registry's checksum, and unpacks
            it. Review its files before approving it.
          </Text>
          <Text className="text-sm text-foreground-muted">{PLUGIN_NPM_SCRIPTS_STATEMENT}</Text>
          {error ? (
            <Text selectable className="text-sm text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </View>
        <ManagementNotice notice={notice} onRetry={retryAccess} />
      </ScrollView>
    </SettingsScreen>
  );
}
