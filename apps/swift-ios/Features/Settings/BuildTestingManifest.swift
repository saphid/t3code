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

    struct Entry: Codable, Equatable, Identifiable, Sendable {
        let id: String
        let name: String
        let state: String
        let commits: [Commit]
        let threads: [Thread]
        let issueURL: URL?

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
