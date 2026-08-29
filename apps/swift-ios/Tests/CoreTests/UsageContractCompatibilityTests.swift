import Foundation
import Testing
@testable import T3Code

struct UsageContractCompatibilityTests {
    @Test(
        arguments: [
            (2, UsageContractCompatibility.incompatible(.serverBehind)),
            (3, UsageContractCompatibility.compatible),
            (4, UsageContractCompatibility.compatible),
            (5, UsageContractCompatibility.incompatible(.clientBehind)),
        ]
    )
    func classifiesVersionSkew(
        version: Int,
        expected: UsageContractCompatibility
    ) {
        #expect(usageContractCompatibility(version) == expected)
    }

    @Test
    func newerAdditiveWireSummaryDecodesBeforeCompatibilityIsEvaluated() throws {
        let data = Data(
            #"""
            {
              "contractVersion": 5,
              "readAt": "2026-08-29T00:00:00.000Z",
              "timeZone": "Australia/Sydney",
              "sinceDay": "2026-08-29",
              "untilDay": "2026-08-29",
              "buckets": [],
              "sources": [],
              "pricing": {
                "status": "fresh",
                "source": "test",
                "fetchedAt": null,
                "knownModels": 0
              },
              "scanDurationMs": 1,
              "addedByNewerServer": {"ignored": true}
            }
            """#.utf8
        )

        let summary = try JSONDecoder.t3.decode(UsageSummary.self, from: data)

        #expect(summary.contractVersion == 5)
        #expect(
            usageContractCompatibility(summary.contractVersion)
                == .incompatible(.clientBehind)
        )
    }
}
