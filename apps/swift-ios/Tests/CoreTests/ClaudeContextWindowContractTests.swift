import Foundation
import Testing
@testable import T3Code

struct ClaudeContextWindowContractTests {
    @Test
    func decodesAdvertisedContextWindowChoicesExactly() throws {
        let snapshot = try JSONDecoder.t3.decode(
            ServerConfigSnapshot.self,
            from: Data(
                """
                {
                  "providers": [{
                    "instanceId": "claudeAgent",
                    "driver": "claudeAgent",
                    "enabled": true,
                    "installed": true,
                    "status": "ready",
                    "auth": { "status": "authenticated" },
                    "checkedAt": "2026-08-29T00:00:00.000Z",
                    "models": [{
                      "slug": "claude-opus-5",
                      "name": "Claude Opus 5",
                      "isCustom": false,
                      "capabilities": {
                        "optionDescriptors": [{
                          "id": "contextWindow",
                          "type": "select",
                          "label": "Context Window",
                          "options": [
                            { "id": "200k", "label": "200k" },
                            { "id": "1m", "label": "1M", "isDefault": true }
                          ],
                          "currentValue": "200k"
                        }]
                      }
                    }]
                  }]
                }
                """.utf8
            )
        )

        let provider = try #require(snapshot.providers.first)
        let model = try #require(provider.models.first)
        let descriptor = try #require(model.capabilities?.optionDescriptors?.first)
        guard case let .select(contextWindow) = descriptor else {
            Issue.record("Expected a select context-window descriptor.")
            return
        }

        #expect(contextWindow.id == "contextWindow")
        #expect(contextWindow.options.map(\.id) == ["200k", "1m"])
        #expect(contextWindow.options.map(\.label) == ["200k", "1M"])
        #expect(contextWindow.options.map { $0.isDefault == true } == [false, true])
        #expect(contextWindow.currentValue == "200k")
    }
}
