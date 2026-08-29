import Foundation
import Testing
@testable import T3Code

@MainActor
@Suite("T3 Connect environment discovery")
struct T3ConnectEnvironmentDiscoveryTests {
    @Test(
        "App startup reconciles Connect before loading the environment snapshot",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func startupRunsDiscovery() async {
        let client = FeatureClientStub()
        client.t3ConnectReconciliationResults = [.changed]
        client.snapshot = FeatureSnapshot(environments: [
            FeatureEnvironment(
                id: "studio",
                name: "Studio",
                endpoint: "https://studio.example",
                source: .t3Connect,
                connectionState: .connected
            ),
        ])
        client.finishEvents()
        let model = testRootModel(client: client)

        await model.start()

        #expect(client.t3ConnectReconciliationCallCount == 1)
        #expect(model.snapshot.environments.map(\.id) == ["studio"])
    }

    @Test(
        "Provisioned hosts use their stable relay identity",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func provisionedHostIsConnectedOnce() {
        let linked = relayEnvironment(id: "studio")

        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [linked],
            saved: [directEnvironment(id: "direct")]
        )

        #expect(plan.connect.map(\.environmentId) == ["studio"])
        #expect(plan.removeEnvironmentIDs.isEmpty)
    }

    @Test(
        "Duplicate relay records collapse by environment identity",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func duplicateRecordsAreDeduplicated() {
        let first = relayEnvironment(id: "studio", label: "First")
        let duplicate = relayEnvironment(id: "studio", label: "Duplicate")

        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [first, duplicate],
            saved: []
        )

        #expect(plan.connect == [first])
    }

    @Test(
        "Relaunch keeps an identical managed environment",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func relaunchKeepsStableEnvironment() {
        let linked = relayEnvironment(id: "studio")

        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [linked],
            saved: [managedEnvironment(id: "studio")]
        )

        #expect(plan.connect.isEmpty)
        #expect(plan.removeEnvironmentIDs.isEmpty)
    }

    @Test(
        "A changed relay endpoint refreshes the existing identity",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func changedEndpointReconnectsStableEnvironment() {
        let linked = relayEnvironment(id: "studio", host: "new.example")

        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [linked],
            saved: [managedEnvironment(id: "studio", host: "old.example")]
        )

        #expect(plan.connect == [linked])
        #expect(plan.removeEnvironmentIDs.isEmpty)
    }

    @Test(
        "A direct entry with the same server identity is deduplicated through managed connect",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func directIdentityIsReconciled() {
        let linked = relayEnvironment(id: "studio")

        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [linked],
            saved: [directEnvironment(id: "studio")]
        )

        #expect(plan.connect == [linked])
        #expect(plan.removeEnvironmentIDs.isEmpty)
    }

    @Test(
        "Discovered hosts do not replace the user's active environment",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func discoveryPreservesActiveSelection() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(
                path: "t3-connect-discovery-\(UUID().uuidString)",
                directoryHint: .isDirectory
            )
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = EnvironmentStore(
            fileURL: directory.appending(path: "environments.json")
        )
        let direct = directEnvironment(id: "direct")
        try await store.save([direct])
        try await store.setActiveEnvironment(id: direct.id)
        let runtime = EnvironmentRuntime(
            environmentStore: store,
            credentialStore: InMemoryCredentialStore()
        )
        let descriptor = try JSONDecoder.t3.decode(
            EnvironmentDescriptor.self,
            from: Data(
                """
                {
                  "environmentId": "studio",
                  "label": "Studio",
                  "platform": {"os": "darwin", "arch": "arm64"},
                  "serverVersion": "1.0.0",
                  "capabilities": {"repositoryIdentity": true}
                }
                """.utf8
            )
        )
        let managed = Environment(
            id: "studio",
            label: "Studio",
            httpBaseURL: try #require(URL(string: "https://studio.example")),
            webSocketBaseURL: try #require(URL(string: "wss://studio.example")),
            kind: .managedDPoP,
            descriptor: descriptor
        )
        let credential = EnvironmentCredential.managedDPoP(
            accessToken: "access-token",
            expiresAt: Date(timeIntervalSince1970: 2_000_000_000),
            scopes: ["orchestration:read"],
            environmentID: managed.id,
            proofKeyThumbprint: "proof-key"
        )

        _ = try await runtime.saveManagedEnvironment(
            managed,
            credential: credential,
            activate: false
        )

        #expect(try await store.activeEnvironmentID() == direct.id)
        #expect(try await store.load().map(\.id) == [direct.id, managed.id])
    }

    @Test(
        "Unlink removes only managed environments",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func unlinkPreservesDirectEnvironment() {
        let plan = T3ConnectEnvironmentReconciliationPlan(
            discovered: [],
            saved: [
                directEnvironment(id: "direct"),
                managedEnvironment(id: "unlinked"),
            ]
        )

        #expect(plan.connect.isEmpty)
        #expect(plan.removeEnvironmentIDs == ["unlinked"])
    }

    @Test(
        "Account changes and sign-out invalidate late discovery",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func previousAccountSnapshotCannotMutateCurrentRuntime() {
        let snapshot = T3ConnectDiscoverySnapshot(
            accountID: "account-a",
            authorizationGeneration: 7,
            environments: [relayEnvironment(id: "studio")]
        )

        #expect(snapshot.isCurrent(
            accountID: "account-a",
            authorizationGeneration: 7,
            isInvalidated: false
        ))
        #expect(snapshot.isCurrent(
            accountID: "account-b",
            authorizationGeneration: 8,
            isInvalidated: false
        ) == false)
        #expect(snapshot.isCurrent(
            accountID: nil,
            authorizationGeneration: 8,
            isInvalidated: true
        ) == false)
    }

    @Test(
        "Failure preserves the current snapshot and retry reloads discovery",
        .bug("https://github.com/saphid/t3code-personal/issues/186")
    )
    func failureAndRetryPreserveHealthyEnvironment() async {
        let client = FeatureClientStub()
        let direct = FeatureEnvironment(
            id: "direct",
            name: "Direct Mac",
            endpoint: "http://direct.example",
            isActive: true,
            source: .direct,
            connectionState: .connected
        )
        client.snapshot = FeatureSnapshot(environments: [direct])
        client.t3ConnectReconciliationResults = [
            .failed("Relay unavailable"),
            .changed,
        ]
        let model = testRootModel(client: client)
        await model.reload()

        await model.refreshT3ConnectEnvironments()
        #expect(model.snapshot.environments == [direct])
        #expect(client.initialSnapshotCallCount == 2)

        await model.refreshT3ConnectEnvironments()
        #expect(client.initialSnapshotCallCount == 3)
        #expect(client.t3ConnectReconciliationCallCount == 2)
    }

    private func relayEnvironment(
        id: String,
        label: String = "Studio",
        host: String = "studio.example"
    ) -> T3ConnectRelayEnvironment {
        T3ConnectRelayEnvironment(
            environmentId: id,
            label: label,
            endpoint: T3ConnectManagedEndpoint(
                httpBaseUrl: "https://\(host)",
                wsBaseUrl: "wss://\(host)",
                providerKind: .t3Relay
            ),
            linkedAt: "2026-08-29T00:00:00.000Z"
        )
    }

    private func directEnvironment(id: String) -> Environment {
        Environment(
            id: id,
            label: "Direct",
            httpBaseURL: URL(string: "http://direct.example")!,
            webSocketBaseURL: URL(string: "ws://direct.example")!
        )
    }

    private func managedEnvironment(
        id: String,
        host: String = "studio.example"
    ) -> Environment {
        Environment(
            id: id,
            label: "Studio",
            httpBaseURL: URL(string: "https://\(host)")!,
            webSocketBaseURL: URL(string: "wss://\(host)")!,
            kind: .managedDPoP
        )
    }
}
