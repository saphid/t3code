import Foundation
import Testing
@testable import T3Code

struct VCSStatusContractTests {
    @Test(.bug("https://github.com/saphid/t3code-personal/issues/228"))
    func snapshotDecodesCurrentBranchPullRequestIdentity() throws {
        let data = Data(
            """
            {
              "_tag": "snapshot",
              "local": {
                "isRepo": true,
                "sourceControlProvider": null,
                "hasPrimaryRemote": true,
                "isDefaultRef": false,
                "refName": "feature/from-dev",
                "hasWorkingTreeChanges": false,
                "workingTree": {"files":[],"insertions":0,"deletions":0}
              },
              "remote": {
                "hasUpstream": true,
                "aheadCount": 1,
                "behindCount": 0,
                "aheadOfDefaultCount": 1,
                "pr": {
                  "number": 55,
                  "title": "Feature pull request",
                  "url": "https://github.com/pingdotgg/t3code/pull/55",
                  "baseRef": "dev",
                  "headRef": "feature/from-dev",
                  "state": "open",
                  "updatedAt": "2026-08-29T04:00:00.000Z"
                }
              }
            }
            """.utf8
        )

        let event = try JSONDecoder.t3.decode(VCSStatusEvent.self, from: data)
        guard case let .snapshot(local, remote) = event else {
            Issue.record("Expected snapshot")
            return
        }
        let pullRequest = try #require(remote?.pr)

        #expect(local.refName == "feature/from-dev")
        #expect(pullRequest.number == 55)
        #expect(pullRequest.baseRef == "dev")
        #expect(pullRequest.headRef == "feature/from-dev")
        #expect(pullRequest.state == "open")
    }
}
