import Testing
@testable import T3Code

@Suite("Active pull request resolution")
struct ActivePullRequestResolutionTests {
    @Test
    func resolvesTheExactOpenPullRequestForTheCurrentRepositoryAndBranch() throws {
        let resolution = try #require(resolve())

        #expect(resolution.repository == "pingdotgg/t3code")
        #expect(resolution.number == 211)
        #expect(resolution.title == "Recognize active pull requests")
        #expect(resolution.headBranch == "feature/active-pr")
        #expect(resolution.baseBranch == "release/test-83")
    }

    @Test(arguments: ["closed", "merged", "draft"])
    func rejectsNonOpenStates(_ state: String) {
        #expect(resolve(state: state) == nil)
    }

    @Test
    func rejectsBranchHeadAndIncompleteMetadataMismatches() {
        #expect(resolve(statusBranch: "feature/other") == nil)
        #expect(resolve(headBranch: "feature/other") == nil)
        #expect(resolve(headBranch: nil) == nil)
        #expect(resolve(baseBranch: nil) == nil)
        #expect(resolve(repositoryIdentity: nil) == nil)
        #expect(resolve(includePullRequest: false) == nil)
    }

    @Test
    func derivesProviderNativeRepositoryNamesWithoutCrossingProjects() {
        let gitLab = ActivePullRequestResolution.RepositoryIdentity(
            canonicalKey: "gitlab.com/group/platform/app",
            displayName: "group/platform/app",
            name: "app"
        )
        let azure = ActivePullRequestResolution.RepositoryIdentity(
            canonicalKey: "dev.azure.com/acme/platform/_git/app",
            displayName: "acme/platform/_git/app",
            name: "app"
        )
        let legacy = ActivePullRequestResolution.RepositoryIdentity(
            canonicalKey: "github.example.com/team/app",
            displayName: nil,
            name: nil
        )

        #expect(ActivePullRequestResolution.repositoryName(for: gitLab) == "group/platform/app")
        #expect(ActivePullRequestResolution.repositoryName(for: azure) == "app")
        #expect(ActivePullRequestResolution.repositoryName(for: legacy) == "team/app")
    }

    private func resolve(
        state: String = "open",
        statusBranch: String? = "feature/active-pr",
        headBranch: String? = "feature/active-pr",
        baseBranch: String? = "release/test-83",
        repositoryIdentity: ActivePullRequestResolution.RepositoryIdentity? = .init(
            canonicalKey: "github.com/pingdotgg/t3code",
            displayName: "pingdotgg/t3code",
            name: "t3code"
        ),
        includePullRequest: Bool = true
    ) -> ActivePullRequestResolution? {
        ActivePullRequestResolution.resolve(
            threadBranch: "feature/active-pr",
            statusBranch: statusBranch,
            repositoryIdentity: repositoryIdentity,
            pullRequest: includePullRequest
                ? ActivePullRequestResolution.PullRequest(
                    number: 211,
                    title: "Recognize active pull requests",
                    state: state,
                    headBranch: headBranch,
                    baseBranch: baseBranch
                )
                : nil
        )
    }
}
