struct BuildTestingPipelineStage: Equatable, Identifiable {
    enum Gate: Equatable {
        case agentAndAutomation
        case automation
        case human
        case maintainer
    }

    let id: String
    let number: Int
    let title: String
    let detail: String
    let gate: Gate

    static let stages = [
        BuildTestingPipelineStage(
            id: "candidate",
            number: 1,
            title: "Candidate PR into Test",
            detail: "The agent would finish one feature or fix. Review, required checks, and dark-mode visual proof when applicable would have to pass before it could auto-merge into SwiftUI Test.",
            gate: .agentAndAutomation
        ),
        BuildTestingPipelineStage(
            id: "test-build",
            number: 2,
            title: "SwiftUI Test build",
            detail: "The exact combined Test tip would run its tests, build, and install in the purple Test app on your phone.",
            gate: .automation
        ),
        BuildTestingPipelineStage(
            id: "test-approval",
            number: 3,
            title: "You approve the feature",
            detail: "You would check the feature in that exact phone build. Approval would permit its held PR to merge into SwiftUI Dev.",
            gate: .human
        ),
        BuildTestingPipelineStage(
            id: "dev-build",
            number: 4,
            title: "SwiftUI Dev build",
            detail: "The new Dev tip would run tests and Simulator validation, then install in the orange Dev app on your phone.",
            gate: .automation
        ),
        BuildTestingPipelineStage(
            id: "dev-approval",
            number: 5,
            title: "You approve upstream delivery",
            detail: "You would confirm the feature still succeeds in the approved Dev build before its isolated upstream candidate proceeds.",
            gate: .human
        ),
        BuildTestingPipelineStage(
            id: "upstream-pr",
            number: 6,
            title: "Upstream PR",
            detail: "Only the feature’s attributed commits would be validated against current upstream, then a PR with the same dark-mode proof would open for maintainer review and merge.",
            gate: .maintainer
        ),
    ]
}
