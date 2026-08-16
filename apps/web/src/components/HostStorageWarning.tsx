import { HardDrive } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useHostStorage } from "../lib/resourceTelemetryState";
import { useEnvironments } from "../state/environments";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

function formatStorage(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes < 10 ? gibibytes.toFixed(1) : Math.round(gibibytes)} GiB`;
}

function EnvironmentHostStorageWarning(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const { data: storage } = useHostStorage(props.environmentId);
  if (storage === null || storage.status === "ok") return null;

  const critical = storage.status === "critical";
  return (
    <Alert
      className="pointer-events-auto mx-auto w-full max-w-2xl shadow-lg"
      variant={critical ? "error" : "warning"}
    >
      <HardDrive />
      <AlertTitle>{critical ? "Host storage is critically low" : "Host storage is low"}</AlertTitle>
      <AlertDescription>
        {formatStorage(storage.availableBytes)} remains on {props.environmentLabel}. Free up space
        now to keep new threads, messages, and attachments from failing.
      </AlertDescription>
    </Alert>
  );
}

export function HostStorageWarning() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--workspace-topbar-height)+0.75rem)] z-40 flex flex-col gap-2 px-3">
      {connected.map((environment) => (
        <EnvironmentHostStorageWarning
          key={environment.environmentId}
          environmentId={environment.environmentId}
          environmentLabel={environment.label}
        />
      ))}
    </div>
  );
}
