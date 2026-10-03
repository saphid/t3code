import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  type EnvironmentId,
  type PluginInstallation,
  type PluginInstallationId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
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
import { useLayoutEffect, useState } from "react";
import { Alert, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ScreenScrollView as ScrollView } from "../../components/ScreenScrollView";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { pluginEnvironment } from "../../state/plugins";
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
  };
  SettingsPluginAdd: { readonly environmentId: EnvironmentId };
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
  if (catalog.state._tag === "unsupported") return null;
  const installations =
    catalog.state._tag === "available" ? catalog.state.view.installations : null;
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
            </View>
          </>
        )}
      </SettingsSection>
      {installations !== null ? <ManagementNotice notice={notice} onRetry={retryAccess} /> : null}
    </View>
  );
}

function PluginListRow({
  installation,
  first,
  onPress,
}: {
  readonly installation: PluginInstallation;
  readonly first: boolean;
  readonly onPress: () => void;
}) {
  const view = presentPluginInstallation(installation);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${view.title}, ${view.stateLabel}`}
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
    />
  );
}

function PluginDetail({
  environmentId,
  installationId,
  addedAfterRevision,
}: {
  readonly environmentId: EnvironmentId;
  readonly installationId: PluginInstallationId;
  readonly addedAfterRevision: number | null;
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

        {view.canReview ? (
          <SettingsSection title="Trusted local code" trailing={<AccessStatus status={status} />}>
            <View className="gap-2 p-4">
              <Text className="text-sm text-foreground">{pluginTrustStatement(label)}</Text>
              <Text className="text-sm text-foreground-muted">{PLUGIN_DIGEST_STATEMENT}</Text>
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
            </View>
          </SettingsSection>
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
                `T3 Code stops the plugin and forgets your approval. Its directory stays on ${label}'s machine.`,
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
