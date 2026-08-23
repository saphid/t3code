import Foundation
import Testing
@testable import T3Code

@Suite("Thread summary wire contract")
struct ThreadSummaryContractTests {
    @Test
    func capabilityAndAuditFieldsDecode() throws {
        let descriptor = try JSONDecoder.t3.decode(
            EnvironmentDescriptor.self,
            from: Data(
                #"{"environmentId":"env","label":"Local","platform":{"os":"darwin","arch":"arm64"},"serverVersion":"1.0.0","capabilities":{"repositoryIdentity":true,"threadSummaryTimeline":true}}"#.utf8
            )
        )
        #expect(descriptor.capabilities.threadSummaryTimeline == true)

        let timeline = try JSONDecoder.t3.decode(
            ThreadSummaryTimeline.self,
            from: Data(
                #"{"entries":[{"id":"entry","fromTurn":1,"toTurn":8,"fromCompletedAt":"2026-08-20T01:00:00Z","toCompletedAt":"2026-08-23T01:00:00Z","summary":"Summary","promptVersion":"ASDSTE100","model":"gpt-5.6-luna"}]}"#.utf8
            )
        )
        #expect(timeline.entries.first?.promptVersion == "ASDSTE100")
        #expect(timeline.entries.first?.model == "gpt-5.6-luna")
    }
}
