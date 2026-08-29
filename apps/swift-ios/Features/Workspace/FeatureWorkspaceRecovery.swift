import Foundation

public struct FeatureWorkspaceRecovery: Identifiable, Sendable, Equatable, Codable {
    public struct Candidate: Identifiable, Sendable, Equatable, Codable {
        public var id: String { path }
        public let path: String
        public let isProjectRoot: Bool
        public let dirty: Bool

        public var displayName: String {
            if isProjectRoot { return "Main project" }
            let name = path
                .replacingOccurrences(of: "\\", with: "/")
                .split(separator: "/")
                .last
                .map(String.init)
            return name ?? path
        }
    }

    public enum Selection: Sendable, Equatable {
        case mainProject
        case matchingWorktree(path: String)
        case recreateWorktree
    }

    public let id: String
    public let messageID: String
    public let branch: String?
    public let missingWorktreePath: String
    public let reason: String
    public let candidates: [Candidate]
    public let canRecreate: Bool
    public let detail: String

    private struct RequiredPayload: Decodable, Sendable {
        let recoveryId: String
        let messageId: String
        let branch: String?
        let missingWorktreePath: String
        let reason: String
        let candidates: [Candidate]
        let canRecreate: Bool
        let detail: String
    }

    private struct CompletedPayload: Decodable, Sendable {
        let messageId: String
    }

    public static func latest(in activities: [OrchestrationActivity]) -> Self? {
        var active: Self?
        for activity in activities {
            switch activity.kind {
            case "thread.workspace.recovery.required":
                guard let payload = try? activity.payload.decode(RequiredPayload.self) else {
                    continue
                }
                active = Self(
                    id: payload.recoveryId,
                    messageID: payload.messageId,
                    branch: payload.branch,
                    missingWorktreePath: payload.missingWorktreePath,
                    reason: payload.reason,
                    candidates: payload.candidates,
                    canRecreate: payload.canRecreate,
                    detail: payload.detail
                )
            case "thread.workspace.recovery.completed":
                guard let payload = try? activity.payload.decode(CompletedPayload.self),
                      active?.messageID == payload.messageId else {
                    continue
                }
                active = nil
            default:
                continue
            }
        }
        return active
    }
}
