import Foundation

/// String unions in the server protocol grow over time. Known clients keep
/// rendering the rest of a response when a newer server adds a literal.
public protocol ForwardCompatibleStringEnum: RawRepresentable, Codable, Sendable
where RawValue == String {
    static var unknownValue: Self { get }
}

public extension ForwardCompatibleStringEnum {
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknownValue
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum PullRequestInvolvement: String, ForwardCompatibleStringEnum, CaseIterable {
    case all, reviewing, authored, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestState: String, ForwardCompatibleStringEnum, CaseIterable {
    case open, closed, merged, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestListState: String, ForwardCompatibleStringEnum, CaseIterable {
    case all, open, closed, merged, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestMergeability: String, ForwardCompatibleStringEnum {
    case mergeable, conflicting, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestMergeMethod: String, ForwardCompatibleStringEnum, CaseIterable {
    case merge, squash, rebase, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestAction: String, ForwardCompatibleStringEnum, CaseIterable {
    case merge, ready, draft, close, reopen, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestCheckStatus: String, ForwardCompatibleStringEnum {
    case pending, success, failure, skipped, neutral, cancelled, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestCommentKind: String, ForwardCompatibleStringEnum {
    case issueComment = "issue-comment"
    case reviewComment = "review-comment"
    case review
    case unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestDiffSide: String, ForwardCompatibleStringEnum {
    case left, right, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestReviewVerdict: String, ForwardCompatibleStringEnum, CaseIterable {
    case comment, approve
    case requestChanges = "request-changes"
    case unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestReviewerKind: String, ForwardCompatibleStringEnum {
    case user, team, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestDiffChangeType: String, ForwardCompatibleStringEnum {
    case change
    case renamePure = "rename-pure"
    case renameChanged = "rename-changed"
    case new, deleted, unknown
    public static let unknownValue = Self.unknown
}

public enum PullRequestUnavailableReason: String, ForwardCompatibleStringEnum {
    case cliMissing = "cli-missing"
    case cliUnauthenticated = "cli-unauthenticated"
    case providerUnsupported = "provider-unsupported"
    case unknown
    public static let unknownValue = Self.unknown
}

public struct PullRequestActor: Codable, Equatable, Sendable {
    public let login: String
    public let name: String?
    public let avatarUrl: String?
}

public struct PullRequestLabel: Codable, Equatable, Sendable {
    public let name: String
    public let color: String?
}

public struct PullRequestCheck: Codable, Equatable, Sendable {
    public let name: String
    public let status: PullRequestCheckStatus
    public let description: String?
    public let url: String?
}

public struct PullRequestComment: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let kind: PullRequestCommentKind
    public let author: PullRequestActor?
    public let body: String
    /// Kept as the source ISO-8601 string so fractional seconds and future
    /// server precision cannot invalidate an otherwise useful response.
    public let createdAt: String
    public let url: String?
    public let path: String?
    public let reviewState: String?
}

public struct PullRequestThreadComment: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let author: PullRequestActor?
    public let body: String
    public let createdAt: String
    public let url: String?
}

public struct PullRequestReviewThread: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let path: String
    public let line: Int?
    public let side: PullRequestDiffSide
    public let isResolved: Bool
    public let isOutdated: Bool
    public let comments: [PullRequestThreadComment]
}

public struct PullRequestReviewerCandidate: Codable, Equatable, Sendable, Identifiable {
    public let login: String
    public let name: String?
    public let avatarUrl: String?
    public let id: String
    public let kind: PullRequestReviewerKind
    public let isRequested: Bool
}

public struct PullRequestReviewerCandidateList: Codable, Equatable, Sendable {
    public let candidates: [PullRequestReviewerCandidate]
    public let truncated: Bool
}

public struct PullRequestCommit: Codable, Equatable, Sendable, Identifiable {
    public var id: String { oid }
    public let oid: String
    public let messageHeadline: String
    public let committedDate: String
    public let additions: Int?
    public let deletions: Int?
    public let authors: [PullRequestActor]?
}

public struct PullRequestReviewCapabilities: Codable, Equatable, Sendable {
    public let inlineComment: Bool
    public let reply: Bool
    public let resolve: Bool
    public let verdicts: [PullRequestReviewVerdict]
}

public struct PullRequestReviewerCapabilities: Codable, Equatable, Sendable {
    public let request: Bool
    public let listCandidates: Bool
}

public struct PullRequestCapabilities: Codable, Equatable, Sendable {
    public let diff: Bool
    public let comment: Bool
    public let actions: [PullRequestAction]
    public let mergeMethods: [PullRequestMergeMethod]
    public let search: Bool
    public let review: PullRequestReviewCapabilities
    public let reviewers: PullRequestReviewerCapabilities
}

public struct PullRequestViewerPermissions: Codable, Equatable, Sendable {
    public let actions: [PullRequestAction]
    public let comment: Bool
    public let resolve: Bool
    public let verdicts: [PullRequestReviewVerdict]
    public let requestReviewers: Bool
}

public struct PullRequestMergeCapabilities: Codable, Equatable, Sendable {
    public let merge: Bool
    public let squash: Bool
    public let rebase: Bool
}

public struct PullRequestListEntry: Codable, Equatable, Sendable, Identifiable {
    /// Repository plus number is unique on one host. This deliberately matches
    /// the Electron list's canonical row key rather than the project attribution.
    public var id: String { "\(host) \(repository)#\(number)" }
    public let provider: SourceControlProviderKind
    public let host: String
    public let projectId: String
    public let projectTitle: String
    public let repository: String
    public let number: Int
    public let title: String
    public let url: String
    public let author: PullRequestActor?
    public let headBranch: String
    public let baseBranch: String
    public let state: PullRequestState
    public let isDraft: Bool
    public let mergeability: PullRequestMergeability
    public let additions: Int
    public let deletions: Int
    public let createdAt: String
    public let updatedAt: String
    public let viewerReviewRequested: Bool
    public let labels: [PullRequestLabel]
}

public struct PullRequestListInput: Codable, Equatable, Sendable {
    public let state: PullRequestListState
    public let involvement: PullRequestInvolvement?
    public let projectId: String?
    public let host: String?
    public let limit: Int?
    public let cursors: [String: String]?
    public let query: String?

    public init(
        state: PullRequestListState,
        involvement: PullRequestInvolvement? = nil,
        projectId: String? = nil,
        host: String? = nil,
        limit: Int? = nil,
        cursors: [String: String]? = nil,
        query: String? = nil
    ) {
        self.state = state
        self.involvement = involvement
        self.projectId = projectId
        self.host = host
        self.limit = limit
        self.cursors = cursors
        self.query = query
    }
}

public struct PullRequestProviderSummary: Codable, Equatable, Sendable, Identifiable {
    public var id: String { host }
    public let host: String
    public let kind: SourceControlProviderKind
    public let searchesOnHost: Bool
    public let projectCount: Int
    public let configured: Bool
    public let detail: String?
}

public struct PullRequestListProjectError: Codable, Equatable, Sendable, Identifiable {
    public var id: String { projectId }
    public let projectId: String
    public let projectTitle: String
    public let message: String
}

public struct PullRequestListResult: Codable, Equatable, Sendable {
    public let viewers: [String: String]
    public let providers: [PullRequestProviderSummary]
    public let entries: [PullRequestListEntry]
    public let errors: [PullRequestListProjectError]
    public let truncated: Bool
    public let nextCursors: [String: String]
}

public struct PullRequestRef: Codable, Equatable, Hashable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int

    public init(projectId: String, repository: String, number: Int) {
        self.projectId = projectId
        self.repository = repository
        self.number = number
    }
}

public struct PullRequestDiffStat: Codable, Equatable, Sendable, Identifiable {
    public var id: String { "\(projectId) \(repository)#\(number)" }
    public let projectId: String
    public let repository: String
    public let number: Int
    public let additions: Int
    public let deletions: Int
}

public struct PullRequestListStatsInput: Codable, Equatable, Sendable {
    public let refs: [PullRequestRef]
    public init(refs: [PullRequestRef]) { self.refs = refs }
}

public struct PullRequestListStatsResult: Codable, Equatable, Sendable {
    public let stats: [PullRequestDiffStat]
}

public struct PullRequestInvalidateInput: Codable, Equatable, Sendable {
    public let reference: PullRequestRef?
    public init(reference: PullRequestRef? = nil) { self.reference = reference }
}

public struct PullRequestDetail: Codable, Equatable, Sendable {
    public let provider: SourceControlProviderKind
    public let capabilities: PullRequestCapabilities
    public let viewerPermissions: PullRequestViewerPermissions
    public let projectId: String
    public let projectTitle: String
    public let workspaceRoot: String
    public let repository: String
    public let number: Int
    public let title: String
    public let body: String
    public let url: String
    public let author: PullRequestActor?
    public let state: PullRequestState
    public let isDraft: Bool
    public let mergeability: PullRequestMergeability
    public let additions: Int
    public let deletions: Int
    public let changedFiles: Int
    public let headBranch: String
    public let baseBranch: String
    public let createdAt: String
    public let updatedAt: String
    public let mergedAt: String?
    public let closedAt: String?
    public let reviewers: [PullRequestActor]
    public let labels: [PullRequestLabel]
    public let checks: [PullRequestCheck]
    public let mergeCapabilities: PullRequestMergeCapabilities
}

public struct PullRequestActivity: Codable, Equatable, Sendable {
    public let author: PullRequestActor?
    public let reviewers: [PullRequestActor]?
    public let comments: [PullRequestComment]
    public let commentCount: Int
    public let commentsTruncated: Bool
    public let reviewThreads: [PullRequestReviewThread]
    public let commits: [PullRequestCommit]
}

public struct PullRequestDiffInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let cursor: String?
    public let commit: String?

    public init(reference: PullRequestRef, cursor: String? = nil, commit: String? = nil) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.cursor = cursor
        self.commit = commit
    }
}

public struct PullRequestDiffResult: Codable, Equatable, Sendable {
    public let patch: String
    public let truncated: Bool
    public let nextCursor: String?
}

public struct PullRequestDiffFileContentsInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let commit: String?
    public let changeType: PullRequestDiffChangeType
    public let oldPath: String
    public let newPath: String

    public init(
        reference: PullRequestRef,
        commit: String? = nil,
        changeType: PullRequestDiffChangeType,
        oldPath: String,
        newPath: String
    ) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.commit = commit
        self.changeType = changeType
        self.oldPath = oldPath
        self.newPath = newPath
    }
}

public struct PullRequestDiffFileContentsResult: Codable, Equatable, Sendable {
    public let oldContents: String
    public let newContents: String
}

public struct PullRequestActionInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let action: PullRequestAction
    public let mergeMethod: PullRequestMergeMethod?

    public init(
        reference: PullRequestRef,
        action: PullRequestAction,
        mergeMethod: PullRequestMergeMethod? = nil
    ) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.action = action
        self.mergeMethod = mergeMethod
    }
}

public struct PullRequestCommentInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let body: String

    public init(reference: PullRequestRef, body: String) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.body = body
    }
}

public struct PullRequestReviewCommentDraft: Codable, Equatable, Sendable {
    public let path: String
    public let oldPath: String?
    public let line: Int
    public let side: PullRequestDiffSide
    public let body: String

    public init(path: String, oldPath: String? = nil, line: Int, side: PullRequestDiffSide, body: String) {
        self.path = path
        self.oldPath = oldPath
        self.line = line
        self.side = side
        self.body = body
    }
}

public struct PullRequestSubmitReviewInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let verdict: PullRequestReviewVerdict
    public let body: String
    public let comments: [PullRequestReviewCommentDraft]

    public init(
        reference: PullRequestRef,
        verdict: PullRequestReviewVerdict,
        body: String,
        comments: [PullRequestReviewCommentDraft]
    ) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.verdict = verdict
        self.body = body
        self.comments = comments
    }
}

public struct PullRequestThreadReplyInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let threadId: String
    public let body: String

    public init(reference: PullRequestRef, threadId: String, body: String) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.threadId = threadId
        self.body = body
    }
}

public struct PullRequestThreadResolutionInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let threadId: String
    public let resolved: Bool

    public init(reference: PullRequestRef, threadId: String, resolved: Bool) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.threadId = threadId
        self.resolved = resolved
    }
}

public struct PullRequestReviewerSelection: Codable, Equatable, Sendable {
    public let id: String
    public let kind: PullRequestReviewerKind

    public init(id: String, kind: PullRequestReviewerKind) {
        self.id = id
        self.kind = kind
    }
}

public struct PullRequestReviewerRequestInput: Codable, Equatable, Sendable {
    public let projectId: String
    public let repository: String
    public let number: Int
    public let reviewers: [PullRequestReviewerSelection]
    public let requested: Bool

    public init(
        reference: PullRequestRef,
        reviewers: [PullRequestReviewerSelection],
        requested: Bool
    ) {
        projectId = reference.projectId
        repository = reference.repository
        number = reference.number
        self.reviewers = reviewers
        self.requested = requested
    }
}

/// Stable feature-facing interpretation of Effect RPC and HTTP tagged errors.
public struct PullRequestServiceError: LocalizedError, Equatable, Sendable {
    public let tag: String?
    public let reason: PullRequestUnavailableReason?
    public let provider: SourceControlProviderKind?
    public let operation: String?
    public let detail: String
    public let payload: JSONValue?

    public var errorDescription: String? { detail }

    public init(error: any Error) {
        let message = error.localizedDescription
        let payload: JSONValue?
        if let rpc = error as? RPCError,
           case let .remotePayload(_, value) = rpc {
            payload = value
        } else if let http = error as? HTTPError,
                  case let .structuredStatus(_, _, _, value) = http {
            payload = value
        } else {
            payload = nil
        }
        self.payload = payload
        tag = payload?["_tag"]?.stringValue
        reason = payload?["reason"]?.stringValue.map {
            PullRequestUnavailableReason(rawValue: $0) ?? .unknown
        }
        provider = payload?["provider"]?.stringValue.map {
            SourceControlProviderKind(rawValue: $0) ?? .unknown
        }
        operation = payload?["operation"]?.stringValue
        detail = payload?["message"]?.stringValue
            ?? payload?["detail"]?.stringValue
            ?? Self.providerRequirement(provider: provider, reason: reason)
            ?? message
    }

    private static func providerRequirement(
        provider: SourceControlProviderKind?,
        reason: PullRequestUnavailableReason?
    ) -> String? {
        switch (provider, reason) {
        case (.github, .cliMissing):
            "GitHub CLI (`gh`) is required to browse change requests on this host. Install it from https://cli.github.com/ and reload."
        case (.github, .cliUnauthenticated):
            "GitHub CLI is not authenticated. Run `gh auth login` and retry."
        case (.gitlab, .cliMissing):
            "GitLab CLI (`glab`) is required to browse change requests on this host. Install it from https://gitlab.com/gitlab-org/cli and reload."
        case (.gitlab, .cliUnauthenticated):
            "GitLab CLI is not authenticated. Run `glab auth login` and retry."
        case (.azureDevOps, .cliMissing):
            "Azure CLI (`az`) with the Azure DevOps extension is required. Install `az`, then run `az extension add --name azure-devops`."
        case (.azureDevOps, .cliUnauthenticated):
            "Azure CLI is not signed in. Run `az login` and retry."
        case (.bitbucket, .cliMissing):
            "Bitbucket needs API credentials on the server. Set T3CODE_BITBUCKET_EMAIL and T3CODE_BITBUCKET_API_TOKEN, or T3CODE_BITBUCKET_ACCESS_TOKEN."
        case (.bitbucket, .cliUnauthenticated):
            "Bitbucket rejected the configured credentials. Check T3CODE_BITBUCKET_EMAIL and T3CODE_BITBUCKET_API_TOKEN."
        case (_, .cliMissing):
            "The tool this host is read through is not installed or set up."
        case (_, .cliUnauthenticated):
            "This host has no working credentials."
        case (_, .providerUnsupported):
            "Change requests cannot be browsed for this project's host yet."
        default:
            nil
        }
    }
}

public struct PullRequestCapabilityUnavailableError: LocalizedError, Equatable, Sendable {
    public init() {}
    public var errorDescription: String? {
        "This server does not advertise pull-request workspace support."
    }
}
