import Testing
@testable import T3Code

@Suite(
    "Terminal scrollback",
    .bug("https://github.com/saphid/t3code-personal/issues/250")
)
struct TerminalScrollbackTests {
    @Test("A 10,000-row stream retains every configured row")
    func configuredRowLimitIsTruthful() {
        let stream = rows(1...10_000)

        let retained = TerminalScrollback.capped(stream)

        #expect(retained == stream)
        #expect(retained.hasPrefix(TerminalScrollback.truncationMarker) == false)
    }

    @Test("Oldest complete rows are replaced by a visible truncation boundary")
    func truncationKeepsNewestCompleteRows() {
        let retained = TerminalScrollback.capped(rows(1...10_002))
        let retainedRows = retained.dropFirst(TerminalScrollback.truncationMarker.count)

        #expect(retained.hasPrefix(TerminalScrollback.truncationMarker))
        #expect(retainedRows.contains("row-4\n"))
        #expect(retainedRows.contains("row-3\n") == false)
        #expect(retainedRows.hasSuffix("row-10002\n"))
        #expect(retainedRows.split(separator: "\n").count == TerminalScrollback.rowLimit - 1)
    }

    @Test("Byte-heavy Unicode rows remain intact below the independent memory ceiling")
    func unicodeRowsAreNotTreatedAsBytes() {
        let row = "界🙂e\u{301}" + String(repeating: "x", count: 1_000) + "\n"
        let stream = String(repeating: row, count: 2_000)

        let retained = TerminalScrollback.capped(stream)

        #expect(retained == stream)
        #expect(retained.utf8.count > 512 * 1_024)
    }

    @Test(
        "Resize-width rows retain their configured count",
        arguments: [40, 80, 240]
    )
    func resizeDoesNotChangeTheRowLimit(columns: Int) {
        let row = String(repeating: "界", count: columns) + "\n"
        let stream = String(repeating: row, count: 1_000)

        let retained = TerminalScrollback.capped(
            stream,
            rowLimit: 1_000,
            byteLimit: TerminalScrollback.byteLimit
        )

        #expect(retained == stream)
    }

    @Test("ANSI strings containing newlines do not create false row boundaries")
    func controlStringsStayWhole() {
        let command = "\u{1B}]0;first\nsecond\u{7}visible\n"
        let stream = String(repeating: command, count: 6)

        let retained = TerminalScrollback.capped(stream, rowLimit: 4, byteLimit: 4_096)

        #expect(retained.contains("\u{1B}]0;first\nsecond\u{7}visible\n"))
        #expect(retained.contains("second\u{7}visible\n"))
        #expect(retained.utf8.count <= 4_096)
    }

    @Test("Alternate-screen control sequences are never cut in half")
    func alternateScreenSequencesStayWhole() {
        let enterAlternateScreen = "\u{1B}[?1049h"
        let exitAlternateScreen = "\u{1B}[?1049l"
        let stream = enterAlternateScreen + rows(1...20) + exitAlternateScreen

        let retained = TerminalScrollback.capped(stream, rowLimit: 10, byteLimit: 4_096)

        #expect(retained.contains(exitAlternateScreen))
        #expect(retained.contains("[?1049l"))
        #expect(retained.hasSuffix(exitAlternateScreen))
    }

    @Test("A pathological long row cannot exceed the memory ceiling")
    func longRowIsMemoryBounded() {
        let stream = "prefix\u{1B}[38;5;221m" + String(repeating: "界", count: 8_000) + "\u{1B}[0m"

        let retained = TerminalScrollback.capped(stream, rowLimit: 10, byteLimit: 4_096)

        #expect(retained.utf8.count <= 4_096)
        #expect(retained.contains("\u{FFFD}") == false)
        #expect(retained.hasPrefix(TerminalScrollback.truncationMarker))
    }

    @Test("Repeated reconnect snapshots keep one stable truncation boundary")
    func reconnectDoesNotDuplicateMarker() {
        let first = TerminalScrollback.capped(rows(1...20), rowLimit: 10, byteLimit: 4_096)
        let restored = TerminalScrollback.capped(first, rowLimit: 10, byteLimit: 4_096)

        #expect(restored == first)
        #expect(
            restored.dropFirst(TerminalScrollback.truncationMarker.count)
                .contains(TerminalScrollback.truncationMarker) == false
        )
    }

    @Test("Chunked output preserves arrival order while enforcing the row limit")
    func chunkedOutputStaysOrdered() {
        var scrollback = TerminalScrollback.Accumulator()

        for row in 1...10_010 {
            scrollback.append("row-\(row)\n")
        }

        let retainedRows = scrollback.text.dropFirst(TerminalScrollback.truncationMarker.count)
        #expect(scrollback.text.hasPrefix(TerminalScrollback.truncationMarker))
        #expect(retainedRows.hasPrefix("row-12\n"))
        #expect(retainedRows.hasSuffix("row-10010\n"))
    }

    private func rows(_ range: ClosedRange<Int>) -> String {
        range.map { "row-\($0)\n" }.joined()
    }
}
