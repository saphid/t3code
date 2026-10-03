import { useAtomValue } from "@effect/atom-react";
import { supportsPluginSettings } from "@t3tools/client-runtime/state/pluginSettings";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { pluginEnvironment } from "../../state/plugins";
import { PluginSettingsForm } from "./PluginSettingsForm";

/**
 * One form per installed plugin that declares settings. Renders nothing on a
 * server without plugin settings or when no installed plugin declares any.
 */
export function PluginSettingsSections({
  environmentId,
  capabilities,
}: {
  readonly environmentId: EnvironmentId;
  readonly capabilities: ExecutionEnvironmentCapabilities | undefined;
}) {
  if (!supportsPluginSettings(capabilities)) return null;
  return <InstalledPluginSettings environmentId={environmentId} />;
}

function InstalledPluginSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const catalog = Option.getOrNull(
    AsyncResult.value(useAtomValue(pluginEnvironment.catalog({ environmentId, input: {} }))),
  );
  if (catalog?._tag !== "available") return null;
  return catalog.installations
    .filter((installation) => (installation.manifest?.settings?.length ?? 0) > 0)
    .map((installation) => (
      <PluginSettingsForm
        key={installation.installationId}
        environmentId={environmentId}
        installation={installation}
      />
    ));
}
