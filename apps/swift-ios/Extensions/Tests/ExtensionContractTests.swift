import Foundation
import XCTest
@testable import T3Code

final class ExtensionContractTests: XCTestCase {
    /// Every channel that ships the widget, keyed by the scheme it configures.
    private let channelSchemes = [
        "t3code-swiftui",
        "t3code-swiftui-dev",
        "t3code-swiftui-personal",
        "t3code-swiftui-personal-dev",
    ]

    #if DEBUG
    private let compiledScheme = "t3code-swiftui-dev"
    #else
    private let compiledScheme = "t3code-swiftui"
    #endif

    func testWidgetFallbackUsesTheConfiguredBuildChannelScheme() {
        for scheme in channelSchemes {
            let resolved = T3SharedContainer.configuredURLScheme(["T3CodeURLScheme": scheme])

            XCTAssertEqual(resolved, scheme)
            XCTAssertEqual(
                T3SharedContainer.newTaskURL(scheme: resolved).absoluteString,
                "\(scheme)://new-task"
            )
        }
    }

    func testWidgetFallbackNeverBorrowsAnotherChannelScheme() {
        for scheme in channelSchemes {
            let fallback = T3SharedContainer.newTaskURL(
                scheme: T3SharedContainer.configuredURLScheme(["T3CodeURLScheme": scheme])
            )
            let others = channelSchemes.filter { $0 != scheme }

            XCTAssertEqual(fallback.scheme, scheme)
            XCTAssertEqual(fallback.host, "new-task")
            XCTAssertFalse(others.contains(fallback.scheme ?? ""))
        }
    }

    func testUnusableSchemeConfigurationFallsBackToTheCompiledChannel() {
        let unusable: [[String: Any]?] = [
            nil,
            [:],
            ["T3CodeURLScheme": ""],
            ["T3CodeURLScheme": "$(T3CODE_URL_SCHEME)"],
            ["T3CodeURLScheme": 17],
        ]

        for info in unusable {
            XCTAssertEqual(T3SharedContainer.configuredURLScheme(info), compiledScheme)
        }
        for scheme in ["", "not a scheme", "$(T3CODE_URL_SCHEME)"] {
            XCTAssertEqual(
                T3SharedContainer.newTaskURL(scheme: scheme).absoluteString,
                "\(compiledScheme)://new-task"
            )
        }
    }

    func testDeepLinkAndFallbackURLsShareOneChannelScheme() throws {
        let row = T3RelayAgentActivityAggregateRow(
            environmentId: "env-1",
            threadId: "thread-1",
            projectTitle: "t3code",
            threadTitle: "Ship widget links",
            modelTitle: "Claude Opus 5",
            phase: .running,
            status: "Working",
            updatedAt: "2026-08-01T12:00:00.000Z",
            deepLink: "/env-1/thread-1"
        )

        let deepLink = try XCTUnwrap(row.nativeDeepLinkURL)
        XCTAssertEqual(deepLink.scheme, T3SharedContainer.urlScheme)
        XCTAssertEqual(T3SharedContainer.newTaskURL.scheme, T3SharedContainer.urlScheme)
        XCTAssertEqual(
            T3SharedContainer.newTaskURL.absoluteString,
            "\(T3SharedContainer.urlScheme)://new-task"
        )
    }

    func testLiveActivityDecodesTheRelayAPNSEnvelope() throws {
        let props = #"{"title":"T3 Code","subtitle":"2 active agents, 1 needs attention","activeCount":2,"updatedAt":"2026-08-01T12:00:00.000Z","activities":[{"environmentId":"env-1","threadId":"thread-working","projectTitle":"t3code","threadTitle":"Build the native app","modelTitle":"GPT-5.6 Sol","phase":"running","status":"Working","updatedAt":"2026-08-01T12:00:00.000Z","deepLink":"/env-1/thread-working"},{"environmentId":"env-2","threadId":"thread-approval","projectTitle":"uploadthing","threadTitle":"Ship upload recovery","modelTitle":"Claude Opus 5","phase":"waiting_for_approval","status":"Approval","updatedAt":"2026-08-01T11:59:00.000Z","deepLink":"/env-2/thread-approval"}]}"#
        let state = LiveActivityAttributes.ContentState(
            name: "AgentActivity",
            props: props
        )

        let aggregate = try XCTUnwrap(state.aggregate)
        XCTAssertEqual(aggregate.activeCount, 2)
        XCTAssertEqual(aggregate.activities.count, 2)
        XCTAssertEqual(aggregate.attentionFirstActivities.first?.threadId, "thread-approval")
        XCTAssertEqual(
            aggregate.attentionFirstActivities.first?.nativeDeepLinkURL?.absoluteString,
            "\(T3SharedContainer.urlScheme)://threads?environment=env-2&thread=thread-approval"
        )
    }

    func testLocalLiveActivityStatePreservesTheExactNameAndPropsKeys() throws {
        let aggregate = T3RelayAgentActivityAggregateState(
            title: "T3 Code",
            subtitle: "1 active agent",
            activeCount: 1,
            updatedAt: "2026-08-01T12:00:00.000Z",
            activities: []
        )
        let state = try LiveActivityAttributes.ContentState(aggregate: aggregate)
        let encoded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any]
        )

        XCTAssertEqual(Set(encoded.keys), Set(["name", "props"]))
        XCTAssertEqual(encoded["name"] as? String, "AgentActivity")
        XCTAssertEqual(state.aggregate, aggregate)
    }

    func testUnexpectedActivityNamesNeverDecodeAsAgentState() {
        let state = LiveActivityAttributes.ContentState(name: "Other", props: "{}")
        XCTAssertNil(state.aggregate)
    }
}
