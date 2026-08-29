import Testing
@testable import T3Code

@Suite("Provider maintenance presentation")
struct ProviderSettingsPresentationTests {
    @Test
    func alreadyCurrentProviderClearsUpdateWarning() throws {
        let row = try #require(rows(provider: provider(
            advisory: .init(
                status: "current",
                currentVersion: "1.2.3",
                latestVersion: "1.2.3",
                canUpdate: false
            ),
            update: .init(
                status: "succeeded",
                reason: "current",
                message: "Provider is current."
            )
        )).first)

        #expect(row.status == "Up to date")
        #expect(row.detail == "Provider is current.")
        #expect(row.actionTitle == nil)
        #expect(row.tone == .success)
    }

    @Test
    func timedOutProviderOffersAnActionableRetry() throws {
        let row = try #require(rows(provider: provider(
            advisory: .init(status: "behind_latest", canUpdate: true),
            update: .init(status: "failed", reason: "timed_out")
        )).first)

        #expect(row.status == "Update failed")
        #expect(row.detail?.contains("timed out") == true)
        #expect(row.actionTitle == "Retry")
        #expect(row.canAct)
        #expect(row.tone == .failure)
    }

    @Test
    func runningProviderCannotStartAConcurrentUpdate() throws {
        let row = try #require(rows(provider: provider(
            advisory: .init(status: "behind_latest", canUpdate: true),
            update: .init(status: "running", message: "Running npm install.")
        )).first)

        #expect(row.status == "Updating")
        #expect(row.actionTitle == nil)
        #expect(!row.canAct)
        #expect(row.tone == .progress)
    }

    @Test
    func offlineProviderExplainsWhyMaintenanceIsUnavailable() throws {
        let row = try #require(rows(
            provider: provider(
                advisory: .init(status: "behind_latest", canUpdate: true)
            ),
            state: .disconnected
        ).first)

        #expect(row.status == "Offline")
        #expect(row.actionTitle == nil)
        #expect(!row.canAct)
    }

    @Test
    func scopedCatalogueMissDoesNotFallBackToAnotherEnvironment() {
        let environment = FeatureEnvironment(
            id: "studio",
            name: "Studio",
            endpoint: "https://studio.example",
            isActive: true,
            connectionState: .connected
        )
        let snapshot = FeatureSnapshot(
            environments: [environment],
            providers: [provider(advisory: .init(status: "current"))],
            providersByEnvironment: [:]
        )

        #expect(ProviderSettingsPresentation.sections(in: snapshot).isEmpty)
    }

    @Test(
        arguments: [
            ("command_not_found", "package manager"),
            ("permission_denied", "permissions"),
            ("nonzero_exit", "command failed"),
            ("cancelled", "cancelled"),
            ("verification_failed", "could not be verified"),
            ("version_mismatch", "did not match"),
        ]
    )
    func terminalReasonsRemainDistinct(reason: String, expectedCopy: String) throws {
        let row = try #require(rows(provider: provider(
            advisory: .init(status: "behind_latest", canUpdate: true),
            update: .init(status: "failed", reason: reason)
        )).first)

        #expect(row.detail?.localizedCaseInsensitiveContains(expectedCopy) == true)
    }

    private func rows(
        provider: FeatureProvider,
        state: FeatureConnection.State = .connected
    ) -> [ProviderMaintenanceRow] {
        let environment = FeatureEnvironment(
            id: "studio",
            name: "Studio",
            endpoint: "https://studio.example",
            isActive: true,
            connectionState: state
        )
        return ProviderSettingsPresentation.sections(in: FeatureSnapshot(
            environments: [environment],
            providersByEnvironment: [environment.id: [provider]]
        )).flatMap(\.rows)
    }

    private func provider(
        advisory: ServerProviderVersionAdvisorySnapshot,
        update: ServerProviderUpdateStateSnapshot? = nil
    ) -> FeatureProvider {
        FeatureProvider(
            id: "codex",
            name: "Codex",
            driver: "codex",
            version: "1.2.3",
            versionAdvisory: advisory,
            updateState: update
        )
    }
}
