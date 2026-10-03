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
 * Pass `readOnly` when the session cannot save (no access:write).
 */
export function PluginSettingsSections({
  environmentId,
  capabilities,
  readOnly = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly capabilities: ExecutionEnvironmentCapabilities | undefined;
  readonly readOnly?: boolean;
}) {
  if (!supportsPluginSettings(capabilities)) return null;
  return <InstalledPluginSettings environmentId={environmentId} readOnly={readOnly} />;
}

function InstalledPluginSettings({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
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
        readOnly={readOnly}
      />
    ));
}
