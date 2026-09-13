import { defineExtension, requireApi, useApiRead } from "@t3tools/extension-sdk/authoring";
import { orchestrationStatusApi, orchestrationControlApi } from "@t3tools/extension-sdk/catalogue";

export default defineExtension({
  id: "example.orchestration-contracts",
  version: "1.0.0",
  requires: [requireApi(orchestrationStatusApi), requireApi(orchestrationControlApi)],
  surfaces: [
    {
      name: "view",
      title: "Agent capabilities",
      scope: "thread",
      createView(host, session) {
        return {
          renderer: function Capabilities() {
            const result = useApiRead(host, session, orchestrationStatusApi, "getCapabilities", {});
            return host.React.createElement(
              "pre",
              null,
              result.status === "ready"
                ? JSON.stringify(result.value.operations, null, 2)
                : result.status === "unavailable"
                  ? result.error
                  : "Loading…",
            );
          },
        };
      },
    },
  ],
});
