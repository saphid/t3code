import Foundation
import XCTest
@testable import T3Code

final class ExtensionContractTests: XCTestCase {
    func testPersonalBuildIdentityConfiguresSharedContainerAndRoutes() throws {
        let identities = [
            (
                appGroupID: "group.com.saphid.t3code.swiftui.dev",
                urlScheme: "t3code-swiftui-personal-dev",
                buildChannel: "dev"
            ),
            (
                appGroupID: "group.com.alxs.t3code.typed-swiftui.dev",
                urlScheme: "t3code-swiftui-personal",
                buildChannel: "test"
            ),
        ]

        for identity in identities {
            let configuration = try XCTUnwrap(T3SharedContainerConfiguration(infoDictionary: [
                "T3AppGroupIdentifier": identity.appGroupID,
                "T3URLScheme": identity.urlScheme,
                "T3BuildChannel": identity.buildChannel,
            ]))

            XCTAssertEqual(configuration.appGroupID, identity.appGroupID)
            XCTAssertEqual(configuration.urlScheme, identity.urlScheme)
            XCTAssertEqual(configuration.buildChannel, identity.buildChannel)
            XCTAssertEqual(
                configuration.routeURL(host: "threads", queryItems: [
                    URLQueryItem(name: "environment", value: "env"),
                    URLQueryItem(name: "thread", value: "thread"),
                ])?.absoluteString,
                "\(identity.urlScheme)://threads?environment=env&thread=thread"
            )
        }
    }

    func testSharedContainerConfigurationRejectsMissingBuildIdentity() {
        XCTAssertNil(T3SharedContainerConfiguration(infoDictionary: [:]))
        XCTAssertNil(T3SharedContainerConfiguration(infoDictionary: [
            "T3URLScheme": "t3code-swiftui-personal",
            "T3BuildChannel": "test",
        ]))
        XCTAssertNil(T3SharedContainerConfiguration(infoDictionary: [
            "T3AppGroupIdentifier": "group.com.alxs.t3code.typed-swiftui.dev",
            "T3BuildChannel": "test",
        ]))
        for dictionary: [String: Any] in [
            [
                "T3AppGroupIdentifier": " group.com.alxs.t3code.typed-swiftui.dev",
                "T3URLScheme": "t3code-swiftui-personal",
                "T3BuildChannel": "dev",
            ],
            [
                "T3AppGroupIdentifier": "$(T3CODE_APP_GROUP_IDENTIFIER)",
                "T3URLScheme": "$(T3CODE_URL_SCHEME)",
                "T3BuildChannel": "$(T3_BUILD_CHANNEL)",
            ],
            [
                "T3AppGroupIdentifier": "not-an-app-group",
                "T3URLScheme": "t3code_swiftui",
                "T3BuildChannel": "Dev Test",
            ],
        ] {
            XCTAssertNil(T3SharedContainerConfiguration(infoDictionary: dictionary))
        }
    }

    func testContributorNeutralBuildIdentityDoesNotRequireAPrivateChannel() throws {
        let configuration = try XCTUnwrap(T3SharedContainerConfiguration(infoDictionary: [
            "T3AppGroupIdentifier": "group.com.t3tools.t3code.swiftui",
            "T3URLScheme": "t3code-swiftui",
            "T3BuildChannel": "",
        ]))

        XCTAssertNil(configuration.buildChannel)
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
