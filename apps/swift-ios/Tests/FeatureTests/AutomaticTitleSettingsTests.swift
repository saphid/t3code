import Foundation
import Testing

@testable import T3Code

@Suite("Automatic title settings")
struct AutomaticTitleSettingsTests {
    private let primary = FeatureSelection(providerID: "codex", modelID: "gpt-5.6-luna")

    @Test
    func fallbackCandidatesExcludeThePrimaryProviderInstance() {
        let providers = fixtures()

        let candidates = AutomaticTitleSettingsPolicy.fallbackProviders(
            primary: primary,
            providers: providers
        )

        #expect(candidates.map(\.id) == ["claude_personal", "grok_backup"])
    }

    @Test
    func preferredFallbackKeepsTheModelsDefaultReasoningOption() throws {
        let fallback = try #require(
            AutomaticTitleSettingsPolicy.preferredFallback(
                primary: primary,
                providers: fixtures()
            )
        )

        #expect(fallback.providerID == "claude_personal")
        #expect(fallback.modelID == "claude-haiku-4-5")
        #expect(
            fallback.options == [
                FeatureModelOptionSelection(id: "effort", value: .string("low"))
            ])
    }

    @Test
    func sameProviderFallbackIsRejectedWhileDisabledFallbackIsValid() {
        #expect(AutomaticTitleSettingsPolicy.isValid(primary: primary, fallback: nil))
        #expect(
            AutomaticTitleSettingsPolicy.isValid(
                primary: primary,
                fallback: FeatureSelection(providerID: "codex", modelID: "gpt-5.4")
            ) == false
        )
    }

    @Test
    func removedAndUnavailableProvidersHaveRecoverableMessages() {
        let removed = AutomaticTitleSettingsPolicy.providerStateMessage(
            selection: FeatureSelection(providerID: "removed", modelID: "model"),
            providers: fixtures(),
            role: "backup"
        )
        let unavailable = AutomaticTitleSettingsPolicy.providerStateMessage(
            selection: FeatureSelection(providerID: "grok_backup", modelID: "grok-code-fast-1"),
            providers: fixtures(),
            role: "backup"
        )

        #expect(removed?.contains("was removed") == true)
        #expect(unavailable?.contains("is unavailable") == true)
    }

    @Test
    func serverSettingsDecodePrimaryAndOptionalFallbackSelections() throws {
        let data = Data(
            """
            {
                "defaultThreadEnvMode": "local",
                "newWorktreesStartFromOrigin": true,
                "textGenerationModelSelection": {
                    "instanceId": "codex",
                    "model": "gpt-5.6-luna",
                    "options": [{"id": "reasoningEffort", "value": "low"}]
                },
                "textGenerationFallbackModelSelection": {
                    "instanceId": "claude_personal",
                    "model": "claude-haiku-4-5",
                    "options": [{"id": "effort", "value": "low"}]
                }
            }
            """.utf8
        )

        let settings = try JSONDecoder.t3.decode(ServerSettingsSnapshot.self, from: data)

        #expect(settings.textGenerationModelSelection?.instanceId == "codex")
        #expect(settings.textGenerationFallbackModelSelection?.instanceId == "claude_personal")
        #expect(
            settings.textGenerationFallbackModelSelection?.options == [
                ModelSelection.OptionSelection(id: "effort", value: .string("low"))
            ]
        )
    }

    @Test
    func featureSnapshotPersistsEnvironmentOwnedSelections() throws {
        let expected = FeatureAutomaticTitleSettings(
            primary: primary,
            fallback: FeatureSelection(
                providerID: "claude_personal",
                modelID: "claude-haiku-4-5",
                options: [FeatureModelOptionSelection(id: "effort", value: .string("low"))]
            )
        )
        let snapshot = FeatureSnapshot(
            automaticTitleSettingsByEnvironment: ["studio": expected]
        )

        let decoded = try JSONDecoder.t3.decode(
            FeatureSnapshot.self,
            from: JSONEncoder.t3.encode(snapshot)
        )

        #expect(decoded.automaticTitleSettingsByEnvironment?["studio"] == expected)
    }

    private func fixtures() -> [FeatureProvider] {
        [
            FeatureProvider(
                id: "codex",
                name: "Codex",
                models: [FeatureModel(id: "gpt-5.6-luna", name: "Luna")]
            ),
            FeatureProvider(
                id: "claude_personal",
                name: "Claude Personal",
                models: [
                    FeatureModel(
                        id: "claude-haiku-4-5",
                        name: "Haiku",
                        isDefault: true,
                        options: [
                            FeatureModelOptionDescriptor(
                                id: "effort",
                                label: "Effort",
                                kind: .select,
                                choices: [
                                    FeatureModelOptionChoice(
                                        id: "low",
                                        label: "Low",
                                        isDefault: true
                                    )
                                ]
                            )
                        ]
                    )
                ]
            ),
            FeatureProvider(
                id: "grok_backup",
                name: "Grok Backup",
                isAvailable: false,
                models: [FeatureModel(id: "grok-code-fast-1", name: "Grok Code Fast")]
            ),
        ]
    }
}
