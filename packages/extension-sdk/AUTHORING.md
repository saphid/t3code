# Start small

Use [the workspace reader](examples/start-here/extension.ts) first. defineExtension emits the existing package contracts; useApiRead binds reads to the view's scope, visibility and cancellation. Write a separate Node server.ts only when providing a server API. Set serverEntry in the definition; build supplies an empty tools array when omitted.

Prefer source references over copied contracts:

| Need                                          | Source of truth                        | Example                                                                         |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Author definition and read helper             | [authoring.ts](src/authoring.ts)       | [Start here](examples/start-here/extension.ts)                                  |
| Available shared API descriptors              | [catalogue.ts](src/catalogue.ts)       | [Typed Files provider](examples/files/)                                         |
| Own typed APIs, requirements and dependencies | [capabilities.ts](src/capabilities.ts) | [Typed provider](examples/api-provider/) and [consumer](examples/api-consumer/) |
| Client/server entries and package validation  | [environment.ts](src/environment.ts)   | [Stream provider](examples/installable-stream-provider/)                        |
| View identity, placement and JSON bounds      | [contracts.ts](src/contracts.ts)       | [Typed Files client](examples/files/extension.ts)                               |
| View lifecycle and restoration                | [host.ts](src/host.ts)                 | [Read helper tests](test/authoring.test.mjs)                                    |
| API streams                                   | [capabilities.ts](src/capabilities.ts) | [Live output](examples/installable-terminal-live-output/)                       |
| Verified assets                               | [environment.ts](src/environment.ts)   | [WASM example](examples/installable-package-assets/)                            |

The source and tests are included. Follow the named type/function first; read host internals only for an operation the public API cannot provide. defineExtension covers ordinary surfaces and API providers; the lower-level package contract remains available for assets and other contributions.

A requirement selects an API/version; a named plugin dependency also declares the APIs used from it. Shared providers are explicitly selected in Settings. Installation grants and the authenticated session both constrain access. Discovery describes actual availability; a plausible API name or built-in panel does not prove an API exists. Missing/incompatible dependencies and revoked access must stay visibly unavailable.

useApiRead is for declared read methods. Use [bindApi/bindStreamApi](src/capabilities.ts) for writes or streams, pass cancellation, and handle their actual contract. Do not retry writes on a different provider. Registration, a view or a read subscription never supplies write authority.

Run build/check on the real output, then verify the installed feature. receipt.json identifies checked bytes; it explicitly does not claim installation or behavior. Keep a small feature assertion alongside your source. Platform maintainers own the shared lifecycle/dependency regression suite; authors should not recreate it.
