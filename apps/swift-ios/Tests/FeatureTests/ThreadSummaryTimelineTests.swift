import Testing
@testable import T3Code

@Suite("Thread summary timeline")
struct ThreadSummaryTimelineTests {
    @Test
    func chronologicalEntryShowsTurnAndDateRangeForServerFractionalTimestamps() {
        let entry = ThreadSummaryTimelineEntry(
            id: "entry",
            fromTurn: 1,
            toTurn: 8,
            fromCompletedAt: "2026-08-20T01:00:00.000Z",
            toCompletedAt: "2026-08-23T01:00:00.125Z",
            summary: "Summary",
            promptVersion: "ASDSTE100",
            model: "gpt-5.6-luna"
        )

        #expect(entry.rangeLabel.contains("Turns 1–8"))
        #expect(entry.rangeLabel.contains(" · "))
        #expect(entry.rangeLabel != "Turns 1–8")
    }

    @Test
    func chronologicalEntryAlsoAcceptsWholeSecondTimestamps() {
        let entry = ThreadSummaryTimelineEntry(
            id: "entry",
            fromTurn: 9,
            toTurn: 16,
            fromCompletedAt: "2026-08-24T01:00:00Z",
            toCompletedAt: "2026-08-24T02:00:00Z",
            summary: "Summary",
            promptVersion: "ASDSTE100",
            model: "gpt-5.6-luna"
        )

        #expect(entry.rangeLabel.contains("Turns 9–16 · "))
    }
}
