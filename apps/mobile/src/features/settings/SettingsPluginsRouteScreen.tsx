import { useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  type EnvironmentId,
  type PluginInstallation,
  type PluginInstallationId,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  describePluginSource,
  PLUGIN_DIGEST_STATEMENT,
  PLUGIN_DIRECTORY_GUIDANCE,
  PLUGIN_MANAGE_ACCESS_REQUIRED,
  pluginCommandErrorMessage,
  pluginDirectoryLocation,
  pluginTrustStatement,
  presentPluginInstallation,
  resolvePluginManageAccess,
  type PluginStateTone,
} from "@t3tools/client-runtime/state/pluginPresentation";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState } from "react";
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

/** Management needs access:write on this environment. */
function usePluginManageAccess(environmentId: EnvironmentId) {
  const session = useAtomValue(environmentSession.sessionStateValueAtom(environmentId));
  const result = useAtomValue(environmentSession.sessionStateAtom(environmentId));
  return resolvePluginManageAccess({
    session,
    isPending: result.waiting,
    hasError: AsyncResult.isFailure(result),
  });
}

function usePluginCatalog(environmentId: EnvironmentId) {
  return useEnvironmentQuery(pluginEnvironment.catalog({ environmentId, input: {} }));
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
  const catalog = usePluginCatalog(environmentId);
  const access = usePluginManageAccess(environmentId);
  const view = catalog.data;
  if (view?._tag === "unsupported") return null;
  const installations = view?.installations ?? null;
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
      >
        {catalog.error ? (
          <Text className="p-4 text-base text-danger-foreground">{catalog.error}</Text>
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
                disabled={access !== "granted"}
                onPress={() => navigation.navigate("SettingsPluginAdd", { environmentId })}
              />
            </View>
          </>
        )}
      </SettingsSection>
      {access === "denied" ? (
        <Text className="px-2 text-sm text-foreground-muted">{PLUGIN_MANAGE_ACCESS_REQUIRED}</Text>
      ) : null}
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
    />
  );
}

function PluginDetail({
  environmentId,
  installationId,
}: {
  readonly environmentId: EnvironmentId;
  readonly installationId: PluginInstallationId;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { availableTargets } = useSettingsEnvironmentFilter();
  const environment = availableTargets.find((target) => target.environmentId === environmentId);
  const label = environment?.label ?? "this environment";
  const catalog = usePluginCatalog(environmentId);
  const access = usePluginManageAccess(environmentId);
  const installation =
    catalog.data?._tag === "available"
      ? (catalog.data.installations.find((entry) => entry.installationId === installationId) ??
        null)
      : null;
  // The digest the user acknowledged; new bytes need a new acknowledgement.
  const [trustedDigest, setTrustedDigest] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const consent = useAtomCommand(pluginEnvironment.consent, "plugin consent");
  const enable = useAtomCommand(pluginEnvironment.enable, "plugin enable");
  const disable = useAtomCommand(pluginEnvironment.disable, "plugin disable");
  const resume = useAtomCommand(pluginEnvironment.resume, "plugin resume");
  const refresh = useAtomCommand(pluginEnvironment.refresh, "plugin refresh");
  const remove = useAtomCommand(pluginEnvironment.remove, "plugin remove");

  const run = async (
    key: string,
    steps: ReadonlyArray<
      () => Promise<{ readonly error: string | null } | { readonly value: unknown }>
    >,
  ) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(key);
    setError(null);
    try {
      for (const step of steps) {
        const outcome = await step();
        if ("error" in outcome) {
          setError(outcome.error);
          return false;
        }
      }
      return true;
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };

  if (installation === null) {
    return (
      <SettingsScreen title="Plugin">
        <ScrollView {...SCROLL_PROPS}>
          <Text className="px-2 text-base text-foreground-muted">
            {catalog.error ??
              (catalog.data === null
                ? "Loading plugin…"
                : `This plugin is no longer installed on ${label}.`)}
          </Text>
        </ScrollView>
      </SettingsScreen>
    );
  }

  const view = presentPluginInstallation(installation);
  const digest = installation.source?.digest ?? null;
  const acknowledged = digest !== null && trustedDigest === digest;
  const canManage = access === "granted";
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
          <SettingsSection title="Trusted local code">
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
                  void run("approve", [
                    () => settle(consent({ environmentId, input: { installationId, digest } })),
                    () => settle(enable(target)),
                  ]);
                }}
              />
            </View>
          </SettingsSection>
        ) : null}

        <SettingsSection title="Manage">
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

        {access === "denied" ? (
          <Text className="px-2 text-sm text-foreground-muted">
            {PLUGIN_MANAGE_ACCESS_REQUIRED}
          </Text>
        ) : null}
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
  const label =
    availableTargets.find((target) => target.environmentId === environmentId)?.label ??
    "this environment";
  const access = usePluginManageAccess(environmentId);
  const add = useAtomCommand(pluginEnvironment.add, "plugin add");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = directory.trim();

  const submit = async () => {
    if (busy || trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    const outcome = await settle(add({ environmentId, input: { directory: trimmed } }));
    setBusy(false);
    if ("value" in outcome)
      navigation.replace("SettingsPlugin", {
        environmentId,
        installationId: outcome.value.installation.installationId,
      });
    else setError(outcome.error);
  };

  return (
    <SettingsScreen title="Add plugin">
      <ScrollView
        {...SCROLL_PROPS}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Plugin directory">
          <View className="px-4 py-3">
            <TextInput
              accessibilityLabel="Plugin directory"
              value={directory}
              onChangeText={setDirectory}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={4096}
              readOnly={busy}
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
              disabled={access !== "granted" || busy || trimmed.length === 0}
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
          {access === "denied" ? (
            <Text className="text-sm text-foreground-muted">{PLUGIN_MANAGE_ACCESS_REQUIRED}</Text>
          ) : null}
          {error ? (
            <Text selectable className="text-sm text-danger-foreground">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}
