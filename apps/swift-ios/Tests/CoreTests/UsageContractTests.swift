import Foundation
import XCTest
@testable import T3Code

final class UsageContractTests: XCTestCase {
    func testUsageSummaryDecodesCurrentWireContract() throws {
        let data = Data(
            #"""
            {
              "contractVersion": 5,
              "readAt": "2026-08-09T12:00:00.000Z",
              "timeZone": "America/Los_Angeles",
              "sinceDay": "2026-08-03",
              "untilDay": "2026-08-09",
              "buckets": [{
                "day": "2026-08-09",
                "hourStart": "2026-08-09T12:00:00.000Z",
                "provider": "grok",
                "model": "grok-code-fast-1",
                "totals": {
                  "uncachedInputTokens": 100,
                  "cachedInputTokens": 200,
                  "cacheCreationTokens": 30,
                  "outputTokens": 40,
                  "reasoningTokens": 10
                },
                "costUsd": 1.25,
                "cacheSavingsUsd": 2.5,
                "costSource": "modelPriced",
                "records": 2,
                "unpricedRecords": 0,
                "sessions": 1
              }],
              "sources": [{
                "fingerprint": {
                  "hostId": "mac-1",
                  "provider": "grok",
                  "resolvedHomePath": "/Users/theo/.grok",
                  "volumeId": "1:2",
                  "sourceIdentity": "windows-fs-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                },
                "status": "ok",
                "scannedFiles": 3,
                "skippedFiles": 0,
                "malformedRecords": 0,
                "distinctSessions": 1,
                "message": null
              }],
              "pricing": {
                "status": "fresh",
                "source": "LiteLLM",
                "fetchedAt": "2026-08-09T11:00:00.000Z",
                "knownModels": 200
              },
              "scanDurationMs": 14
            }
            """#.utf8
        )

        let summary = try JSONDecoder.t3.decode(UsageSummary.self, from: data)

        XCTAssertEqual(summary.contractVersion, usageContractVersion)
        XCTAssertEqual(summary.buckets.first?.provider, .grok)
        XCTAssertEqual(summary.sources.first?.fingerprint.provider, .grok)
        XCTAssertEqual(summary.buckets.first?.totals.cachedInputTokens, 200)
        XCTAssertEqual(summary.sources.first?.fingerprint.volumeId, "1:2")
        XCTAssertEqual(
            summary.sources.first?.fingerprint.sourceIdentity,
            "windows-fs-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        )
    }

    func testUsageSummaryStillDecodesLegacyFingerprintForRollingUpdates() throws {
        let data = Data(
            #"""
            {
              "contractVersion": 4,
              "readAt": "2026-08-09T12:00:00.000Z",
              "timeZone": "UTC",
              "sinceDay": "2026-08-09",
              "untilDay": "2026-08-09",
              "buckets": [],
              "sources": [{
                "fingerprint": {
                  "hostId": "legacy-host",
                  "provider": "claude",
                  "resolvedHomePath": "/home/alex/.claude/projects",
                  "volumeId": "1:2"
                },
                "status": "ok",
                "scannedFiles": 0,
                "skippedFiles": 0,
                "malformedRecords": 0,
                "distinctSessions": 0,
                "message": null
              }],
              "pricing": {
                "status": "cached",
                "source": "LiteLLM",
                "fetchedAt": null,
                "knownModels": 0
              },
              "scanDurationMs": 1
            }
            """#.utf8
        )

        let summary = try JSONDecoder.t3.decode(UsageSummary.self, from: data)

        XCTAssertEqual(summary.contractVersion, 4)
        XCTAssertNil(summary.sources.first?.fingerprint.sourceIdentity)
        XCTAssertFalse(isCompatibleUsageContractVersion(summary.contractVersion))
    }
}
