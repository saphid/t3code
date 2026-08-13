struct BuildTestingDecision: Equatable, Identifiable {
    enum Verdict: String, Codable, Equatable, Sendable {
        case ready
        case notReady
    }

    let manifest: BuildTestingManifest
    let entry: BuildTestingManifest.Entry
    let verdict: Verdict

    var id: String { "\(entry.id):\(verdict.rawValue)" }

    var confirmationTitle: String {
        return switch (manifest.channel, verdict) {
        case (.dev, .ready): "Send to Test?"
        case (.test, .ready): "Approve upstream?"
        case (_, .notReady): "Mark as not ready?"
        }
    }

    var prompt: String {
        let buildCommitList = entry.commits
            .filter { $0.role != .source }
            .map(\.sha)
            .joined(separator: ", ")
        let sourceCommitList = entry.commits
            .filter { $0.role == .source }
            .map(\.sha)
            .joined(separator: ", ")
        let threadList = entry.threads.map(\.id).joined(separator: ", ")
        let sourceEvidence =
            sourceCommitList.isEmpty
            ? ""
            : " Source attribution commits (not build provenance): \(sourceCommitList)."
        let evidence =
            "Feature: \(entry.name) (\(entry.id)). Stream state: \(entry.state). Exact \(manifest.channel.rawValue) build: \(manifest.build). Revision: \(manifest.revision). In-build commits: \(buildCommitList).\(sourceEvidence) Source threads: \(threadList)."

        return switch (manifest.channel, verdict) {
        case (.dev, .ready):
            "$swiftui-feature-fix\n\nI explicitly confirm that this exact Dev candidate is ready to enter SwiftUI Test. \(evidence) Re-audit the frozen evidence and promote only this receipt-matched candidate into Test."
        case (.test, .ready):
            "$approve-swiftui-feature \(entry.id)\n\nI want to approve this exact installed Test feature for upstream delivery. \(evidence) Recheck exact-build eligibility, show the frozen evidence, and ask for the workflow’s required final human confirmation."
        case (.dev, .notReady):
            "$swiftui-feature-fix\n\nThis exact Dev candidate is not ready for Test. \(evidence) Record the verdict durably, keep it out of Test, and report what must change before it can be reviewed again."
        case (.test, .notReady):
            "$swiftui-feature-fix\n\nThis exact Test feature is not ready for upstream delivery. \(evidence) Follow the runbook’s Failure and rollback path: record the rejection durably, remove only this feature from the next Test train, and preserve unrelated candidates."
        }
    }
}
