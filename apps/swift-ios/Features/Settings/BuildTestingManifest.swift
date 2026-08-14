import Foundation

struct BuildTestingManifest: Codable, Equatable, Sendable {
    enum Channel: String, Codable, Equatable, Sendable {
        case dev
        case test
    }

    struct Commit: Codable, Equatable, Identifiable, Sendable {
        enum Role: String, Codable, Equatable, Sendable {
            case candidate
            case integrated
            case source

            var label: String {
                switch self {
                case .candidate: "Candidate"
                case .integrated: "Integrated"
                case .source: "Source attribution"
                }
            }
        }

        let sha: String
        let title: String
        let role: Role

        var id: String { sha }
        var shortSHA: String { String(sha.prefix(7)) }
    }

    struct Thread: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let title: String

    }

    struct VisualEvidence: Codable, Equatable, Identifiable, Sendable {
        enum Kind: String, Codable, Equatable, Sendable {
            case image
            case video
        }

        let kind: Kind
        let title: String
        let caption: String
        let appearance: String
        let cleanURL: URL
        let annotatedURL: URL

        var id: String { "\(kind.rawValue):\(annotatedURL.absoluteString)" }
        var isDarkMode: Bool { appearance == "dark" }
    }

    struct Entry: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let name: String
        let problem: String
        let reproductionSteps: [String]
        let summary: String
        let whatToCheck: String
        let successLooksLike: String
        let validationSummary: String
        let knownLimitations: String
        let reviewPriority: Int
        let reviewGroup: String
        let state: String
        let commits: [Commit]
        let threads: [Thread]
        let issueURL: URL?
        let proofPending: Bool?
        let visualEvidence: [VisualEvidence]?

        init(
            id: String,
            name: String,
            problem: String,
            reproductionSteps: [String],
            summary: String,
            whatToCheck: String,
            successLooksLike: String,
            validationSummary: String,
            knownLimitations: String,
            reviewPriority: Int,
            reviewGroup: String,
            state: String,
            commits: [Commit],
            threads: [Thread],
            issueURL: URL?,
            proofPending: Bool? = nil,
            visualEvidence: [VisualEvidence]? = nil
        ) {
            self.id = id
            self.name = name
            self.problem = problem
            self.reproductionSteps = reproductionSteps
            self.summary = summary
            self.whatToCheck = whatToCheck
            self.successLooksLike = successLooksLike
            self.validationSummary = validationSummary
            self.knownLimitations = knownLimitations
            self.reviewPriority = reviewPriority
            self.reviewGroup = reviewGroup
            self.state = state
            self.commits = commits
            self.threads = threads
            self.issueURL = issueURL
            self.proofPending = proofPending
            self.visualEvidence = visualEvidence
        }

        var evidence: [VisualEvidence] { visualEvidence ?? [] }
        var isProofPending: Bool { proofPending == true }

        var stateLabel: String {
            state.replacingOccurrences(of: "-", with: " ").capitalized
        }
    }

    let schemaVersion: Int
    let channel: Channel
    let build: Int
    let revision: String
    let repositoryURL: URL?
    let entries: [Entry]

    static let current = load(info: Bundle.main.infoDictionary)

    static func load(info: [String: Any]?) -> BuildTestingManifest? {
        guard let encoded = info?["T3BuildTesting"] as? String,
            !encoded.isEmpty,
            !encoded.hasPrefix("$("),
            let data = Data(base64Encoded: encoded),
            let manifest = try? JSONDecoder().decode(Self.self, from: data),
            manifest.schemaVersion == 1,
            manifest.build > 0,
            !manifest.revision.isEmpty
        else { return nil }
        return manifest
    }
}

#if DEBUG
extension BuildTestingManifest {
    static let appFlowApprovalFixture = BuildTestingManifest(
        schemaVersion: 1,
        channel: .dev,
        build: 5601,
        revision: "56f17e0000000000000000000000000000000001",
        repositoryURL: URL(string: "https://github.com/saphid/t3code-personal"),
        entries: [
            Entry(
                id: "in-app-stream-approval-control",
                name: "In-app stream approval control",
                problem: "A reviewer cannot approve or reject an exact personal build from the app.",
                reproductionSteps: [
                    "Open Settings in a personal Dev build.",
                    "Open Review Dev candidates and select this feature.",
                    "Record a Ready for Test or Not ready verdict.",
                ],
                summary: "The Dev review screen now binds one feature, build, revision, commit, and T3 thread to an auditable verdict.",
                whatToCheck: "Confirm the exact build identity and review guide, then inspect both verdict confirmations.",
                successLooksLike: "Ready for Test and Not ready each require confirmation for this feature and exact build before a verdict is sent.",
                validationSummary: "Deterministic unit and XCUITest coverage exercise the frozen fixture metadata and production Settings hierarchy.",
                knownLimitations: "The fixture does not contact GitHub or a live T3 backend.",
                reviewPriority: 1,
                reviewGroup: "Release control",
                state: "proved",
                commits: [
                    Commit(
                        sha: "5600000000000000000000000000000000000001",
                        title: "Add in-app stream approval control",
                        role: .candidate
                    ),
                ],
                threads: [
                    Thread(id: "fixture-main", title: "App flow regression audit"),
                ],
                issueURL: URL(string: "https://github.com/saphid/t3code-personal/issues/56")
            ),
            Entry(
                id: "fixture-pending-proof",
                name: "Pending visual proof fixture",
                problem: "A reviewer must not approve an item before its fresh proof packet exists.",
                reproductionSteps: [
                    "Open Review Dev candidates.",
                    "Expand this pending-proof item.",
                    "Inspect the verdict controls while proof is being recorded.",
                ],
                summary: "The review card names the pending proof state and blocks only the approval action.",
                whatToCheck: "Confirm the pending-proof notice is readable and Ready for Test is disabled.",
                successLooksLike: "The item cannot move forward until fresh proof exists, while Not ready remains available.",
                validationSummary: "A deterministic XCUITest inspects the production pending-proof gate.",
                knownLimitations: "This fixture does not create or publish a proof packet.",
                reviewPriority: 2,
                reviewGroup: "Proof integrity",
                state: "proved",
                commits: [],
                threads: [
                    Thread(id: "fixture-main", title: "App flow regression audit"),
                ],
                issueURL: URL(string: "https://github.com/saphid/t3code-personal/issues/56"),
                proofPending: true
            ),
        ]
    )
}
#endif
