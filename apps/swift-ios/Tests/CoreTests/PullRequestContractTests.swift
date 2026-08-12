import XCTest
@testable import T3Code

/// Fixtures mirror `packages/contracts/src/pullRequest.ts` at upstream
/// `cad2c9361` (the Electron PR workspace protocol anchor).
@MainActor
final class PullRequestContractTests: XCTestCase {
    func testListDecodesOpenRecordsAndFutureLiteralsWithoutDroppingThePage() throws {
        let result = try decode(
            PullRequestListResult.self,
            """
            {
              "viewers":{"github.com":"alex","git.example":"reviewer"},
              "providers":[{
                "host":"github.com","kind":"github","searchesOnHost":true,
                "projectCount":2,"configured":true,"detail":null
              }],
              "entries":[{
                "provider":"forgejo","host":"git.example","projectId":"project-1",
                "projectTitle":"T3","repository":"org/repo","number":42,
                "title":"Native PR workspace","url":"https://git.example/org/repo/pulls/42",
                "author":{"login":"alex","name":null,"avatarUrl":null},
                "headBranch":"feature/prs","baseBranch":"main","state":"superseded",
                "isDraft":false,"mergeability":"later-state","additions":0,"deletions":0,
                "createdAt":"2026-08-12T01:02:03Z",
                "updatedAt":"2026-08-12T01:02:03.123456Z",
                "viewerReviewRequested":true,
                "labels":[{"name":"mobile","color":"10a37f"}]
              }],
              "errors":[],"truncated":true,
              "nextCursors":{"git.example org/repo":"opaque-cursor"}
            }
            """
        )

        XCTAssertEqual(result.viewers["git.example"], "reviewer")
        XCTAssertEqual(result.entries.first?.provider, .unknown)
        XCTAssertEqual(result.entries.first?.state, .unknown)
        XCTAssertEqual(result.entries.first?.mergeability, .unknown)
        XCTAssertEqual(result.nextCursors["git.example org/repo"], "opaque-cursor")
        XCTAssertTrue(result.truncated)
    }

    func testDetailActivityCandidatesAndDeferredStatsDecode() throws {
        let detail = try decode(
            PullRequestDetail.self,
            """
            {
              "provider":"github",
              "capabilities":{
                "diff":true,"comment":true,
                "actions":["merge","ready","future-action"],
                "mergeMethods":["merge","squash","future-method"],"search":true,
                "review":{"inlineComment":true,"reply":true,"resolve":true,
                  "verdicts":["comment","approve","future-verdict"]},
                "reviewers":{"request":true,"listCandidates":true}
              },
              "viewerPermissions":{
                "actions":["merge"],"comment":true,"resolve":true,
                "verdicts":["approve"],"requestReviewers":true
              },
              "projectId":"project-1","projectTitle":"T3","workspaceRoot":"/work/t3",
              "repository":"pingdotgg/t3code","number":4849,"title":"PR workspace",
              "body":"## Summary","url":"https://github.com/pingdotgg/t3code/pull/4849",
              "author":{"login":"theo","name":"Theo","avatarUrl":"https://example/avatar.png"},
              "state":"open","isDraft":false,"mergeability":"mergeable",
              "additions":34121,"deletions":443,"changedFiles":143,
              "headBranch":"pr-workspace","baseBranch":"main",
              "createdAt":"2026-08-10T01:02:03Z","updatedAt":"2026-08-12T01:02:03.987Z",
              "mergedAt":null,"closedAt":null,"reviewers":[],
              "labels":[{"name":"size:XL","color":null}],
              "checks":[{"name":"swift","status":"queued-later","description":null,"url":null}],
              "mergeCapabilities":{"merge":true,"squash":true,"rebase":false}
            }
            """
        )
        XCTAssertEqual(detail.capabilities.actions.last, .unknown)
        XCTAssertEqual(detail.capabilities.review.verdicts.last, .unknown)
        XCTAssertEqual(detail.checks.first?.status, .unknown)
        XCTAssertTrue(detail.mergeCapabilities.squash)

        let activity = try decode(
            PullRequestActivity.self,
            """
            {
              "author":null,"reviewers":null,
              "comments":[{
                "id":"comment-1","kind":"review-comment","author":null,"body":"Please adjust",
                "createdAt":"2026-08-12T01:02:03.123456Z","url":null,"path":"App.swift",
                "reviewState":null
              }],
              "commentCount":225,"commentsTruncated":true,
              "reviewThreads":[{
                "id":"thread-1","path":"App.swift","line":18,"side":"right",
                "isResolved":false,"isOutdated":false,
                "comments":[{"id":"reply-1","author":null,"body":"Reply",
                  "createdAt":"2026-08-12T01:03:00Z","url":null}]
              }],
              "commits":[{
                "oid":"abc123","messageHeadline":"Add workspace",
                "committedDate":"2026-08-12T00:00:00Z","additions":20,"deletions":4,
                "authors":[{"login":"alex","name":null,"avatarUrl":null}]
              }]
            }
            """
        )
        XCTAssertEqual(activity.comments.count, 1)
        XCTAssertEqual(activity.commentCount, 225)
        XCTAssertTrue(activity.commentsTruncated)
        XCTAssertEqual(activity.reviewThreads.first?.comments.first?.id, "reply-1")

        let candidates = try decode(
            PullRequestReviewerCandidateList.self,
            """
            {"candidates":[{"login":"mobile","name":"Mobile Team","avatarUrl":null,
              "id":"mobile","kind":"team","isRequested":true}],"truncated":true}
            """
        )
        XCTAssertEqual(candidates.candidates.first?.kind, .team)
        XCTAssertTrue(candidates.truncated)

        let stats = try decode(
            PullRequestListStatsResult.self,
            """
            {"stats":[{"projectId":"project-1","repository":"pingdotgg/t3code",
              "number":4849,"additions":34121,"deletions":443}]}
            """
        )
        XCTAssertEqual(stats.stats.first?.additions, 34_121)
    }

    func testEveryMutationPayloadUsesTheContractKeys() throws {
        let reference = PullRequestRef(
            projectId: "project-1",
            repository: "pingdotgg/t3code",
            number: 42
        )
        let payloads: [(JSONValue, Set<String>)] = [
            (try encoded(PullRequestActionInput(reference: reference, action: .merge, mergeMethod: .squash)),
             ["projectId", "repository", "number", "action", "mergeMethod"]),
            (try encoded(PullRequestCommentInput(reference: reference, body: "Keep  two spaces  ")),
             ["projectId", "repository", "number", "body"]),
            (try encoded(PullRequestSubmitReviewInput(
                reference: reference,
                verdict: .requestChanges,
                body: "Review",
                comments: [.init(path: "App.swift", oldPath: "Old.swift", line: 12, side: .right, body: "Fix")]
            )), ["projectId", "repository", "number", "verdict", "body", "comments"]),
            (try encoded(PullRequestThreadReplyInput(reference: reference, threadId: "thread-1", body: "Reply")),
             ["projectId", "repository", "number", "threadId", "body"]),
            (try encoded(PullRequestThreadResolutionInput(reference: reference, threadId: "thread-1", resolved: true)),
             ["projectId", "repository", "number", "threadId", "resolved"]),
            (try encoded(PullRequestReviewerRequestInput(
                reference: reference,
                reviewers: [.init(id: "mobile", kind: .team)],
                requested: true
            )), ["projectId", "repository", "number", "reviewers", "requested"]),
            (try encoded(PullRequestInvalidateInput(reference: reference)), ["reference"]),
        ]

        for (payload, expectedKeys) in payloads {
            guard case let .object(object) = payload else {
                return XCTFail("Expected object payload")
            }
            XCTAssertEqual(Set(object.keys), expectedKeys)
        }
        let review = payloads[2].0
        XCTAssertEqual(review["verdict"]?.stringValue, "request-changes")
        guard case let .array(comments)? = review["comments"] else {
            return XCTFail("Expected review comments")
        }
        XCTAssertEqual(comments.first?["oldPath"]?.stringValue, "Old.swift")
    }

    func testAllRPCMethodNamesAndListInputKeysMatchTheServerContract() throws {
        let methods: [RPCMethod] = [
            .pullRequestsList,
            .pullRequestsListStats,
            .pullRequestsDetail,
            .pullRequestsActivity,
            .pullRequestsDiffFileContents,
            .pullRequestsRunAction,
            .pullRequestsComment,
            .pullRequestsSubmitReview,
            .pullRequestsReplyToThread,
            .pullRequestsSetThreadResolution,
            .pullRequestsInvalidate,
            .pullRequestsReviewerCandidates,
            .pullRequestsRequestReviewers,
        ]
        XCTAssertEqual(
            methods.map(\.rawValue),
            [
                "pullRequests.list",
                "pullRequests.listStats",
                "pullRequests.detail",
                "pullRequests.activity",
                "pullRequests.diffFileContents",
                "pullRequests.runAction",
                "pullRequests.comment",
                "pullRequests.submitReview",
                "pullRequests.replyToThread",
                "pullRequests.setThreadResolution",
                "pullRequests.invalidate",
                "pullRequests.reviewerCandidates",
                "pullRequests.requestReviewers",
            ]
        )

        let list = try encoded(PullRequestListInput(
            state: .open,
            involvement: .reviewing,
            projectId: "project-1",
            host: "github.com",
            limit: 100,
            cursors: ["github.com org/repo": "cursor"],
            query: "native"
        ))
        guard case let .object(object) = list else {
            return XCTFail("Expected list input object")
        }
        XCTAssertEqual(
            Set(object.keys),
            ["state", "involvement", "projectId", "host", "limit", "cursors", "query"]
        )
    }

    func testDescriptorCapabilityDefaultsToNoProbeAndMapsToFeatureEnvironment() throws {
        let legacy = try decode(EnvironmentDescriptor.self, descriptorJSON(capability: nil))
        let current = try decode(EnvironmentDescriptor.self, descriptorJSON(capability: true))
        XCTAssertNil(legacy.capabilities.pullRequests)
        XCTAssertEqual(current.capabilities.pullRequests, true)

        let defaultEnvironment = FeatureEnvironment(
            id: "legacy",
            name: "Legacy",
            endpoint: "https://legacy.example"
        )
        XCTAssertFalse(defaultEnvironment.supportsPullRequests)
    }

    func testHTTPDiffUsesAuthorizedEndpointAndPreservesCursorResult() async throws {
        let descriptor = try decode(EnvironmentDescriptor.self, descriptorJSON(capability: true))
        let environment = testEnvironment(descriptor: descriptor)
        let credentials = InMemoryCredentialStore(credentials: [
            environment.id: EnvironmentCredential(accessToken: "access-token"),
        ])
        let transport = PullRequestHTTPTransport(response: .success(
            Data(#"{"patch":"diff --git a/A b/A\n","truncated":true,"nextCursor":"slice-2"}"#.utf8)
        ))
        let client = T3Client(
            environment: environment,
            credentialStore: credentials,
            httpTransport: transport
        )
        let result = try await client.pullRequestDiff(.init(
            reference: .init(projectId: "project-1", repository: "org/repo", number: 42),
            cursor: "slice-1",
            commit: "abc123"
        ))

        XCTAssertTrue(result.truncated)
        XCTAssertEqual(result.nextCursor, "slice-2")
        let requests = await transport.requests
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url?.path, "/api/pull-requests/diff")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer access-token")
        let body = try XCTUnwrap(request.httpBody)
        let input = try JSONDecoder.t3.decode(PullRequestDiffInput.self, from: body)
        XCTAssertEqual(input.cursor, "slice-1")
        XCTAssertEqual(input.commit, "abc123")
    }

    func testHTTPTaggedErrorMapsWithoutLosingSetupReason() async throws {
        let descriptor = try decode(EnvironmentDescriptor.self, descriptorJSON(capability: true))
        let environment = testEnvironment(descriptor: descriptor)
        let transport = PullRequestHTTPTransport(response: .failure(
            503,
            Data(#"{"_tag":"PullRequestUnavailableError","reason":"cli-unauthenticated","provider":"github","message":"Run gh auth login."}"#.utf8)
        ))
        let client = T3Client(
            environment: environment,
            credentialStore: InMemoryCredentialStore(credentials: [
                environment.id: EnvironmentCredential(accessToken: "access-token"),
            ]),
            httpTransport: transport
        )

        do {
            _ = try await client.pullRequestDiff(.init(
                reference: .init(projectId: "project-1", repository: "org/repo", number: 42)
            ))
            XCTFail("Expected tagged error")
        } catch let error as PullRequestServiceError {
            XCTAssertEqual(error.tag, "PullRequestUnavailableError")
            XCTAssertEqual(error.reason, .cliUnauthenticated)
            XCTAssertEqual(error.provider, .github)
            XCTAssertEqual(error.detail, "Run gh auth login.")
        }
    }

    func testRPCTaggedErrorsRetainPayloadAndDeriveSetupGuidance() {
        let unavailablePayload: JSONValue = .object([
            "_tag": .string("PullRequestUnavailableError"),
            "reason": .string("cli-unauthenticated"),
            "provider": .string("github"),
        ])
        let unavailable = PullRequestServiceError(error: RPCError.remotePayload(
            message: "The environment rejected the RPC request.",
            payload: unavailablePayload
        ))
        XCTAssertEqual(unavailable.payload, unavailablePayload)
        XCTAssertEqual(
            unavailable.detail,
            "GitHub CLI is not authenticated. Run `gh auth login` and retry."
        )

        let operationPayload: JSONValue = .object([
            "_tag": .string("PullRequestOperationError"),
            "operation": .string("submit review"),
            "detail": .string("The provider rejected the verdict."),
        ])
        let operation = PullRequestServiceError(error: RPCError.remotePayload(
            message: "The environment rejected the RPC request.",
            payload: operationPayload
        ))
        XCTAssertEqual(operation.operation, "submit review")
        XCTAssertEqual(operation.detail, "The provider rejected the verdict.")

        let authorization = PullRequestServiceError(error: RPCError.remotePayload(
            message: "Reconnect this environment.",
            payload: .object([
                "_tag": .string("EnvironmentAuthorizationError"),
                "message": .string("Reconnect this environment."),
                "requiredScope": .string("write"),
            ])
        ))
        XCTAssertEqual(authorization.tag, "EnvironmentAuthorizationError")
        XCTAssertEqual(authorization.detail, "Reconnect this environment.")
    }

    func testAbsentCapabilityNeverSendsTheHTTPDiffRequest() async throws {
        let descriptor = try decode(EnvironmentDescriptor.self, descriptorJSON(capability: nil))
        let environment = testEnvironment(descriptor: descriptor)
        let transport = PullRequestHTTPTransport(response: .success(
            Data(#"{"patch":"","truncated":false,"nextCursor":null}"#.utf8)
        ))
        let client = T3Client(
            environment: environment,
            credentialStore: InMemoryCredentialStore(credentials: [
                environment.id: EnvironmentCredential(accessToken: "access-token"),
            ]),
            httpTransport: transport
        )

        await XCTAssertThrowsErrorAsync {
            _ = try await client.pullRequestDiff(.init(
                reference: .init(projectId: "project-1", repository: "org/repo", number: 42)
            ))
        } verify: { error in
            XCTAssertTrue(error is PullRequestCapabilityUnavailableError)
        }
        let requests = await transport.requests
        XCTAssertTrue(requests.isEmpty)
    }

    private func decode<Value: Decodable>(_ type: Value.Type, _ json: String) throws -> Value {
        try JSONDecoder.t3.decode(type, from: Data(json.utf8))
    }

    private func encoded<Value: Encodable & Sendable>(_ value: Value) throws -> JSONValue {
        try JSONValue.encode(value)
    }

    private func descriptorJSON(capability: Bool?) -> String {
        let capabilityField = capability.map { ",\"pullRequests\":\($0)" } ?? ""
        return """
        {"environmentId":"environment-1","label":"Studio",
         "platform":{"os":"darwin","arch":"arm64"},"serverVersion":"1.0.0",
         "capabilities":{"repositoryIdentity":true\(capabilityField)}}
        """
    }

    private func testEnvironment(descriptor: EnvironmentDescriptor) -> Environment {
        Environment(
            id: descriptor.environmentId,
            label: descriptor.label,
            httpBaseURL: URL(string: "https://studio.example")!,
            webSocketBaseURL: URL(string: "wss://studio.example")!,
            descriptor: descriptor
        )
    }
}

private actor PullRequestHTTPTransport: HTTPTransport {
    enum Response: Sendable {
        case success(Data)
        case failure(Int, Data)
    }

    private(set) var requests: [URLRequest] = []
    private let response: Response

    init(response: Response) { self.response = response }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let status: Int
        let data: Data
        switch response {
        case let .success(body):
            status = 200
            data = body
        case let .failure(code, body):
            status = code
            data = body
        }
        return (
            data,
            HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
        )
    }
}

@MainActor
private func XCTAssertThrowsErrorAsync(
    _ expression: () async throws -> Void,
    verify: (any Error) -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected error", file: file, line: line)
    } catch {
        verify(error)
    }
}
