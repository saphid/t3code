import Foundation

struct ActivePullRequestResolution: Equatable, Sendable {
    struct RepositoryIdentity: Equatable, Sendable {
        let canonicalKey: String
        let displayName: String?
        let name: String?
    }

    struct PullRequest: Equatable, Sendable {
        let number: Int
        let title: String
        let state: String
        let headBranch: String?
        let baseBranch: String?
    }

    let repository: String
    let number: Int
    let title: String
    let headBranch: String
    let baseBranch: String

    static func resolve(
        threadBranch: String?,
        statusBranch: String?,
        repositoryIdentity: RepositoryIdentity?,
        pullRequest: PullRequest?
    ) -> Self? {
        guard let threadBranch = nonEmpty(threadBranch),
              nonEmpty(statusBranch) == threadBranch,
              let repository = repositoryName(for: repositoryIdentity),
              let pullRequest,
              pullRequest.number > 0,
              pullRequest.state.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased() == "open",
              let title = nonEmpty(pullRequest.title),
              let headBranch = nonEmpty(pullRequest.headBranch),
              headBranch == threadBranch,
              let baseBranch = nonEmpty(pullRequest.baseBranch) else {
            return nil
        }

        return Self(
            repository: repository,
            number: pullRequest.number,
            title: title,
            headBranch: headBranch,
            baseBranch: baseBranch
        )
    }

    static func repositoryName(for identity: RepositoryIdentity?) -> String? {
        guard let identity else { return nil }

        let canonicalKey = nonEmpty(identity.canonicalKey)
        let displayName = nonEmpty(identity.displayName)
        let name = nonEmpty(identity.name)
        if displayName?.split(separator: "/").contains("_git") == true {
            return name ?? displayName?.split(separator: "/").last.map(String.init)
        }
        if let displayName { return displayName }
        guard let canonicalKey else { return name }

        let path = canonicalKey.split(separator: "/", omittingEmptySubsequences: true).dropFirst()
        return path.isEmpty ? name : path.map(String.init).joined(separator: "/")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
