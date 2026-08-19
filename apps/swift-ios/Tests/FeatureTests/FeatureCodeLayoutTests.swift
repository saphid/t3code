import CoreGraphics
import Testing
@testable import T3Code

@Suite("Code surface horizontal layout")
struct FeatureCodeLayoutTests {
    private func line(_ text: String, id: Int = 0) -> FeatureSourceLine {
        FeatureSourceLine(id: id, spans: [FeatureSourceSpan(text: text, kind: .plain)])
    }

    @Test
    func longLineMakesTheSurfaceWiderThanTheViewport() {
        let width = FeatureCodeLayout.contentWidth(
            widestLineWidth: 1_800,
            leadingInset: 54,
            trailingInset: 14,
            viewportWidth: 390
        )

        #expect(width == 1_868)
        #expect(width > 390)
    }

    @Test
    func shortFileStillFillsTheViewport() {
        let width = FeatureCodeLayout.contentWidth(
            widestLineWidth: 120,
            leadingInset: 54,
            trailingInset: 14,
            viewportWidth: 390
        )

        #expect(width == 390)
    }

    @Test
    func unmeasuredFileFallsBackToTheViewport() {
        #expect(
            FeatureCodeLayout.contentWidth(
                widestLineWidth: 0,
                leadingInset: 54,
                trailingInset: 14,
                viewportWidth: 390
            ) == 390
        )
        #expect(
            FeatureCodeLayout.contentWidth(
                widestLineWidth: .infinity,
                leadingInset: 54,
                trailingInset: 14,
                viewportWidth: 390
            ) == 390
        )
    }

    @Test
    func absurdLineWidthIsCapped() {
        let width = FeatureCodeLayout.contentWidth(
            widestLineWidth: 5_000_000,
            leadingInset: 54,
            trailingInset: 14,
            viewportWidth: 390
        )

        #expect(width == FeatureCodeLayout.maximumContentWidth)
    }

    @Test
    func measurementPrefersTheLongestLines() {
        let lines = [
            line("short", id: 0),
            line(String(repeating: "x", count: 400), id: 1),
            line("", id: 2),
            line(String(repeating: "y", count: 200), id: 3),
        ]

        #expect(FeatureCodeLayout.measurementCandidates(for: lines, limit: 2) == [1, 3])
    }

    @Test
    func measurementSkipsBlankLinesAndHonoursTheLimit() {
        let lines = (0 ..< 500).map { index in
            line(index.isMultiple(of: 2) ? "" : String(repeating: "z", count: index), id: index)
        }

        let candidates = FeatureCodeLayout.measurementCandidates(for: lines, limit: 48)

        #expect(candidates.count == 48)
        #expect(candidates.allSatisfy { !lines[$0].text.isEmpty })
        #expect(candidates == candidates.sorted())
        #expect(candidates.contains(499))
    }

    @Test
    func tabsAndWideGlyphsOutweighTheirCharacterCount() {
        #expect(FeatureCodeLayout.displayWeight(of: "abcd") == 4)
        #expect(FeatureCodeLayout.displayWeight(of: "\t") == 4)
        #expect(FeatureCodeLayout.displayWeight(of: "日本語") == 6)

        let indented = line("\t\t\tlet value = 1", id: 0)
        let plain = line("let value = 1234567", id: 1)
        #expect(
            FeatureCodeLayout.displayWeight(of: indented.text)
                > FeatureCodeLayout.displayWeight(of: plain.text)
        )
    }

    @Test
    func emptyFileHasNothingToMeasure() {
        #expect(FeatureCodeLayout.measurementCandidates(for: []).isEmpty)
        #expect(FeatureCodeLayout.measurementCandidates(for: [line("x")], limit: 0).isEmpty)
    }
}
