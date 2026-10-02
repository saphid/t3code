import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  createExtensionCatalogueAtoms,
  environmentExtensionsHttp,
} from "@t3tools/client-runtime/state/extensions";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Option from "effect/Option";
import { Atom } from "effect/unstable/reactivity";
import { connectionAtomRuntime } from "../connection/runtime";

const changes = createExtensionCatalogueAtoms(connectionAtomRuntime);
/** One catalogue/list per environment, shared by thread entries and the mounted host. */
export const mobileExtensionInstallations = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) =>
      Effect.gen(function* () {
        yield* get.result(changes({ environmentId, input: {} }));
        const registry = yield* EnvironmentRegistry;
        return yield* registry.run(
          environmentId,
          Effect.gen(function* () {
            const supervisor = yield* EnvironmentSupervisor;
            const prepared = yield* SubscriptionRef.get(supervisor.prepared);
            if (Option.isNone(prepared))
              return yield* Effect.fail(new Error("Environment not connected"));
            return (yield* environmentExtensionsHttp.list(prepared.value)).installations;
          }),
        );
      }),
    )
    .pipe(Atom.setIdleTTL(0)),
);
