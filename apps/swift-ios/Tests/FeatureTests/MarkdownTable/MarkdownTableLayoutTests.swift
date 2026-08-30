import CoreGraphics
import Testing
#if canImport(T3CodeMarkdownLayout)
@testable import T3CodeMarkdownLayout
#else
@testable import T3Code
#endif

@Suite("Markdown table layout")
struct MarkdownTableLayoutTests {
    @Test
    func wrappedProseColumnsFitWhenReadableWidthsFitTheLane() {
        let layout = MarkdownTableLayout(
            naturalColumnWidths: [140, 300, 300, 180],
            viewportWidth: 768
        )

        #expect(layout.overflows == false)
        #expect(abs(layout.contentWidth - 768) < 0.5)
        #expect(
            layout.columnWidths.allSatisfy {
                $0 >= MarkdownTableLayout.minimumReadableColumnWidth
            }
        )
    }

    @Test
    func narrowFourColumnTableKeepsReadableWidthsAndReportsOverflow() {
        let layout = MarkdownTableLayout(
            naturalColumnWidths: [140, 300, 300, 180],
            viewportWidth: 340
        )

        #expect(layout.overflows)
        #expect(layout.contentWidth > 340)
        #expect(
            layout.columnWidths.allSatisfy {
                $0 >= MarkdownTableLayout.minimumReadableColumnWidth
            }
        )
    }

    @Test
    func smallTableKeepsItsNaturalColumnWidths() {
        let layout = MarkdownTableLayout(
            naturalColumnWidths: [140, 140],
            viewportWidth: 360
        )

        #expect(layout.overflows == false)
        #expect(layout.columnWidths == [140, 140])
    }

    @Test
    func rotationReflowsWithoutClippingBelowTheReadableMinimum() {
        let portrait = MarkdownTableLayout(
            naturalColumnWidths: [140, 300, 300, 180],
            viewportWidth: 340
        )
        let landscape = MarkdownTableLayout(
            naturalColumnWidths: [140, 300, 300, 180],
            viewportWidth: 760
        )

        #expect(portrait.overflows)
        #expect(landscape.overflows == false)
        #expect(abs(landscape.contentWidth - 760) < 0.5)
    }

    @Test
    func streamingReplacementKeepsOrClampsTheSelectedColumnPredictably() {
        #expect(MarkdownTableLayout.reconciledColumn(2, columnCount: 4) == 2)
        #expect(MarkdownTableLayout.reconciledColumn(3, columnCount: 2) == 1)
        #expect(MarkdownTableLayout.reconciledColumn(3, columnCount: 0) == 0)
    }

    @Test
    func columnNavigationReachesEveryColumnAndStopsAtTheEdges() {
        var column = 0
        for _ in 0..<6 {
            column = MarkdownTableLayout.column(
                after: column,
                moving: .next,
                columnCount: 4
            )
        }
        #expect(column == 3)

        for _ in 0..<6 {
            column = MarkdownTableLayout.column(
                after: column,
                moving: .previous,
                columnCount: 4
            )
        }
        #expect(column == 0)
    }
}
