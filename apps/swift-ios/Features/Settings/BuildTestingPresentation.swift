struct BuildTestingPresentation: Equatable {
    let channel: BuildTestingManifest.Channel

    init?(channel: PersonalBuildChannel) {
        switch channel {
        case .dev:
            self.channel = .dev
        case .test:
            self.channel = .test
        case .upstream, .debug:
            return nil
        }
    }

    var sectionTitle: String {
        switch channel {
        case .dev: "What’s ready for testing"
        case .test: "What’s testing"
        }
    }

    var navigationTitle: String {
        switch channel {
        case .dev: "Ready for testing"
        case .test: "What’s testing"
        }
    }

    var rowTitle: String {
        switch channel {
        case .dev: "Review Dev candidates"
        case .test: "Review Test features"
        }
    }

    var emptyTitle: String {
        switch channel {
        case .dev: "No Dev candidates"
        case .test: "Nothing is testing"
        }
    }

    var emptyDescription: String {
        switch channel {
        case .dev: "This build has no proved features waiting to enter Test."
        case .test: "This build has no features waiting for an upstream verdict."
        }
    }

    var readyLabel: String {
        switch channel {
        case .dev: "Ready for Test"
        case .test: "Ready upstream"
        }
    }

    func verdictLabel(_ verdict: BuildTestingDecision.Verdict) -> String {
        verdict == .ready ? readyLabel : "Not ready"
    }
}
