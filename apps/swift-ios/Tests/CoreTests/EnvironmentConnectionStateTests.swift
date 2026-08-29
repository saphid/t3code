import Foundation
import Testing
@testable import T3Code

@Suite("Environment connection state")
struct EnvironmentConnectionStateTests {
    @Test
    func oldEnvironmentRecordsDefaultToEnabled() throws {
        let data = Data(
            #"{"id":"studio","label":"Studio","httpBaseURL":"https://studio.example","webSocketBaseURL":"wss://studio.example/ws","kind":"bearer"}"#.utf8
        )

        let environment = try JSONDecoder.t3.decode(Environment.self, from: data)

        #expect(environment.isEnabled)
    }

    @Test
    func oldFeatureEnvironmentRecordsDefaultToDirectAndEnabled() throws {
        let data = Data(
            #"{"id":"studio","name":"Studio","endpoint":"https://studio.example","isActive":true}"#.utf8
        )

        let environment = try JSONDecoder.t3.decode(FeatureEnvironment.self, from: data)

        #expect(environment.isEnabled)
        #expect(environment.source == .direct)
    }

    @Test(
        "Auth session responses distinguish absent and rejected credentials",
        .bug("https://github.com/saphid/t3code-personal/issues/205"),
        arguments: [
            ("absent", AuthSessionCredentialStatus.absent),
            ("rejected", .rejected),
        ]
    )
    func authSessionCredentialStatusDecodes(
        rawValue: String,
        expected: AuthSessionCredentialStatus
    ) throws {
        let data = Data(
            #"{"authenticated":false,"credentialStatus":"\#(rawValue)"}"#.utf8
        )

        let state = try JSONDecoder.t3.decode(AuthSessionState.self, from: data)

        #expect(state.authenticated == false)
        #expect(state.credentialStatus == expected)
    }

    @Test(
        "Only managed session expiry requires relinking",
        .bug("https://github.com/saphid/t3code-personal/issues/205")
    )
    func connectionFailureKeepsDirectAuthenticationSeparate() throws {
        let direct = environment(id: "direct")
        let managedHTTPURL = try #require(URL(string: "https://managed.example"))
        let managedWebSocketURL = try #require(URL(string: "wss://managed.example/ws"))
        let managed = Environment(
            id: "managed",
            label: "Managed",
            httpBaseURL: managedHTTPURL,
            webSocketBaseURL: managedWebSocketURL,
            kind: .managedDPoP
        )

        let directFailure = NativeFeatureClient.connectionFailure(
            for: direct,
            error: HTTPError.managedSessionExpired
        )
        let managedFailure = NativeFeatureClient.connectionFailure(
            for: managed,
            error: HTTPError.managedSessionExpired
        )

        #expect(directFailure.state == .disconnected)
        #expect(managedFailure.state == .relinkRequired)
        #expect(managedFailure.detail?.contains("Retry or relink") == true)
    }

    @Test
    func disablingLastUsedEnvironmentSelectsAnotherEnabledFallback() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("environment-enabled-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = EnvironmentStore(fileURL: directory.appendingPathComponent("environments.json"))
        let studio = environment(id: "studio")
        let laptop = environment(id: "laptop")
        try await store.save([studio, laptop])
        try await store.setActiveEnvironment(id: studio.id)

        let afterStudio = try await store.setEnabled(id: studio.id, enabled: false)

        #expect(afterStudio.first(where: { $0.id == studio.id })?.isEnabled == false)
        #expect(try await store.activeEnvironmentID() == laptop.id)

        _ = try await store.setEnabled(id: laptop.id, enabled: false)
        #expect(try await store.activeEnvironmentID() == nil)

        _ = try await store.setEnabled(id: studio.id, enabled: true)
        #expect(try await store.activeEnvironmentID() == nil)
        #expect(try await store.load().first(where: { $0.id == studio.id })?.isEnabled == true)
    }

    private func environment(id: String) -> Environment {
        Environment(
            id: id,
            label: id.capitalized,
            httpBaseURL: URL(string: "https://\(id).example")!,
            webSocketBaseURL: URL(string: "wss://\(id).example/ws")!
        )
    }
}
