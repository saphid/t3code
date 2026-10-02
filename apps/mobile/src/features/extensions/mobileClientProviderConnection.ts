import { createClientProviderSession } from "@t3tools/client-runtime/client-provider-connection";
import type { ClientProvidersRespondInput, ClientProviderEmitEvent } from "@t3tools/contracts";
import type { createMobileUiProviders } from "./mobileUiProviders";

export type MobileUiProviders = ReturnType<typeof createMobileUiProviders>;

/** Mobile owns native cleanup; the shared dispatcher owns one authenticated registration. */
export function createMobileClientProviderSession(
  ui: MobileUiProviders,
  send: {
    respond: (payload: ClientProvidersRespondInput) => void;
    emit: (id: string, event: ClientProviderEmitEvent) => void;
  },
  changed?: () => void,
) {
  return createClientProviderSession({
    providers: ui.providers,
    ...send,
    requireAccepted: true,
    registered: changed,
    disposed: () => {
      ui.resetConnection();
      changed?.();
    },
  });
}
