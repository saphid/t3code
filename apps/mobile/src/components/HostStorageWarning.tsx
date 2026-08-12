import type { EnvironmentId } from "@t3tools/contracts";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "./AppText";
import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";
import { useEnvironments } from "../state/environments";

function formatStorage(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes < 10 ? gibibytes.toFixed(1) : Math.round(gibibytes)} GiB`;
}

export function HostStorageWarning({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const { data } = useEnvironmentQuery(serverEnvironment.hostStorage({ environmentId, input: {} }));
  const storage = data;
  if (storage === null || storage.status === "ok") return null;

  const critical = storage.status === "critical";
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="assertive"
      className={
        critical
          ? "mx-4 mb-2 rounded-xl border border-red-500/40 bg-red-950/90 p-3"
          : "mx-4 mb-2 rounded-xl border border-amber-500/40 bg-amber-950/90 p-3"
      }
    >
      <Text className={critical ? "font-semibold text-red-100" : "font-semibold text-amber-100"}>
        {critical ? "Host storage is critically low" : "Host storage is low"}
      </Text>
      <Text
        className={critical ? "mt-1 text-sm text-red-100/80" : "mt-1 text-sm text-amber-100/80"}
      >
        {formatStorage(storage.availableBytes)} remains on {environmentLabel}. Free up space to keep
        new threads and messages from failing.
      </Text>
    </View>
  );
}

export function ActiveHostStorageWarning() {
  const { environments } = useEnvironments();
  const insets = useSafeAreaInsets();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        left: 0,
        position: "absolute",
        right: 0,
        // Clear both the iOS native search header and Android's taller custom
        // home header. The alert is touch-through on routes with shorter bars.
        top: insets.top + (Platform.OS === "ios" ? 104 : 124),
        zIndex: 40,
      }}
    >
      {connected.map((environment) => (
        <HostStorageWarning
          key={environment.environmentId}
          environmentId={environment.environmentId}
          environmentLabel={environment.label}
        />
      ))}
    </View>
  );
}
