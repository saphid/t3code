import Foundation
import Testing
@testable import T3Code

struct OpenCodeProviderContractTests {
    @Test(
        "Recovered OpenCode inventory remains selectable",
        .bug("https://github.com/saphid/t3code-personal/issues/213")
    )
    func recoveredInventoryDecodes() throws {
        let event = try JSONDecoder.t3.decode(
            ServerConfigStreamEvent.self,
            from: Data(
                #"""
                {
                  "type": "providerStatuses",
                  "payload": {
                    "providers": [{
                      "instanceId": "opencode-work",
                      "driver": "opencode",
                      "displayName": "OpenCode Work",
                      "enabled": true,
                      "installed": true,
                      "version": "1.18.23",
                      "status": "ready",
                      "auth": { "status": "authenticated", "type": "opencode" },
                      "checkedAt": "2026-08-29T04:00:00.000Z",
                      "models": [{
                        "slug": "openai/gpt-5.6-sol",
                        "name": "GPT-5.6 Sol",
                        "subProvider": "OpenAI",
                        "isCustom": false,
                        "capabilities": {
                          "optionDescriptors": [{
                            "type": "select",
                            "id": "variant",
                            "label": "Variant",
                            "options": [{
                              "id": "high",
                              "label": "High",
                              "isDefault": true
                            }],
                            "currentValue": "high"
                          }]
                        }
                      }]
                    }]
                  }
                }
                """#.utf8
            )
        )

        guard case let .providerStatuses(providers) = event else {
            Issue.record("Expected provider statuses")
            return
        }
        let provider = try #require(providers.first)
        let model = try #require(provider.models.first)
        #expect(provider.instanceId == "opencode-work")
        #expect(provider.driver == "opencode")
        #expect(provider.status == "ready")
        #expect(provider.auth.status == "authenticated")
        #expect(model.slug == "openai/gpt-5.6-sol")
    }

    @Test(
        "OpenCode inventory failures stay explicit and empty",
        .bug("https://github.com/saphid/t3code-personal/issues/213")
    )
    func failedInventoryDecodesWithoutModels() throws {
        let snapshot = try JSONDecoder.t3.decode(
            ServerConfigSnapshot.self,
            from: Data(
                #"""
                {
                  "providers": [{
                    "instanceId": "opencode",
                    "driver": "opencode",
                    "enabled": true,
                    "installed": true,
                    "version": "1.18.23",
                    "status": "error",
                    "auth": { "status": "unknown", "type": "opencode" },
                    "checkedAt": "2026-08-29T04:00:00.000Z",
                    "message": "Failed to load OpenCode provider inventory.",
                    "models": []
                  }]
                }
                """#.utf8
            )
        )

        let provider = try #require(snapshot.providers.first)
        #expect(provider.status == "error")
        #expect(provider.auth.status == "unknown")
        #expect(provider.models.isEmpty)
        #expect(provider.message == "Failed to load OpenCode provider inventory.")
    }
}
