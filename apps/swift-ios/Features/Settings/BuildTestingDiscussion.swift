import Foundation

struct BuildTestingDiscussion: Equatable {
    let manifest: BuildTestingManifest
    let entry: BuildTestingManifest.Entry

    var prompt: String {
        let steps = entry.reproductionSteps.enumerated()
            .map { "\($0.offset + 1). \($0.element)" }
            .joined(separator: "\n")
        let commits = entry.commits
            .map { "- \($0.role.label): \($0.sha) — \($0.title)" }
            .joined(separator: "\n")
        let threads = entry.threads
            .map { "- \($0.title): \($0.id)" }
            .joined(separator: "\n")
        let issue = entry.issueURL?.absoluteString ?? "No owning issue is recorded."

        return """
        I want to review, discuss, or address this exact SwiftUI review item. Do not approve or reject it unless I explicitly ask.

        Feature: \(entry.name)
        Feature ID: \(entry.id)
        Owning issue: \(issue)
        Installed candidate: \(manifest.channel.rawValue) build \(manifest.build)
        Revision: \(manifest.revision)
        Stream state: \(entry.state)
        Review priority: \(entry.reviewPriority) — \(entry.reviewGroup)

        Original problem:
        \(entry.problem)

        Steps to reproduce:
        \(steps)

        What changed:
        \(entry.summary)

        What to check:
        \(entry.whatToCheck)

        Success looks like:
        \(entry.successLooksLike)

        Automated validation:
        \(entry.validationSummary)

        Known limits:
        \(entry.knownLimitations)

        Attributed commits:
        \(commits.isEmpty ? "- None recorded." : commits)

        Existing source threads:
        \(threads.isEmpty ? "- None recorded." : threads)

        Help me review the evidence, answer questions, or make a focused fix for this item. Keep all work attributed to the feature ID and owning issue above.
        """
    }
}
