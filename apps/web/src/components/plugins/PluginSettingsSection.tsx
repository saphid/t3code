import { useAtomValue } from "@effect/atom-react";
import { supportsPluginSettings } from "@t3tools/client-runtime/state/pluginSettings";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { pluginEnvironment } from "../../state/plugins";
import { SettingsSection } from "../settings/settingsLayout";
import { PluginSettingsForm } from "./PluginSettingsForm";

/**
 * One form per installed plugin that declares settings. Renders nothing on a
 * server without plugin settings or when no installed plugin declares any.
 */
export function PluginSettingsSection({
  environmentId,
  capabilities,
}: {
  readonly environmentId: EnvironmentId;
  readonly capabilities: Parameters<typeof supportsPluginSettings>[0];
}) {
  if (!supportsPluginSettings(capabilities)) return null;
  return <InstalledPluginSettings environmentId={environmentId} />;
}

function InstalledPluginSettings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const catalog = Option.getOrNull(
    AsyncResult.value(useAtomValue(pluginEnvironment.catalog({ environmentId, input: {} }))),
  );
  const installations =
    catalog?._tag === "available"
      ? catalog.installations.filter(
          (installation) => (installation.manifest?.settings?.length ?? 0) > 0,
        )
      : [];
  if (installations.length === 0) return null;
  return (
    <>
      {installations.map((installation) => (
        <SettingsSection
          key={installation.installationId}
          id={`plugin-settings-${installation.installationId}`}
          title={installation.manifest?.name ?? "Plugin"}
        >
          <div className="p-4">
            <PluginSettingsForm environmentId={environmentId} installation={installation} />
          </div>
        </SettingsSection>
      ))}
    </>
  );
}
