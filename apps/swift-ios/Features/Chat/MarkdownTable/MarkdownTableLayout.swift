import CoreGraphics

struct MarkdownTableLayout: Equatable, Sendable {
    enum Direction: Sendable {
        case previous
        case next
    }

    static let cellHorizontalPadding: CGFloat = 22
    static let minimumReadableColumnWidth: CGFloat = 104

    let columnWidths: [CGFloat]
    let contentWidth: CGFloat
    let overflows: Bool

    init(naturalColumnWidths: [CGFloat], viewportWidth: CGFloat) {
        let naturalWidths = naturalColumnWidths.map {
            guard $0.isFinite else { return Self.minimumReadableColumnWidth }
            return max(Self.minimumReadableColumnWidth, $0)
        }
        let paddingWidth = Self.cellHorizontalPadding * CGFloat(naturalWidths.count)
        let availableColumnWidth = max(0, viewportWidth - paddingWidth)
        let minimumContentWidth = Self.minimumReadableColumnWidth
            * CGFloat(naturalWidths.count)
        let naturalContentWidth = naturalWidths.reduce(0, +)

        if viewportWidth > 0,
           naturalContentWidth > availableColumnWidth,
           availableColumnWidth >= minimumContentWidth {
            let flexibleWidths = naturalWidths.map {
                $0 - Self.minimumReadableColumnWidth
            }
            let totalFlexibility = flexibleWidths.reduce(0, +)
            let requiredReduction = naturalContentWidth - availableColumnWidth
            let reductionFraction = totalFlexibility > 0
                ? min(1, requiredReduction / totalFlexibility)
                : 0
            columnWidths = zip(naturalWidths, flexibleWidths).map { width, flexibility in
                width - flexibility * reductionFraction
            }
        } else {
            columnWidths = naturalWidths
        }

        contentWidth = columnWidths.reduce(0, +) + paddingWidth
        overflows = viewportWidth > 0 && contentWidth > viewportWidth + 0.5
    }

    static func column(
        after currentColumn: Int,
        moving direction: Direction,
        columnCount: Int
    ) -> Int {
        guard columnCount > 0 else { return 0 }
        let currentColumn = min(max(0, currentColumn), columnCount - 1)
        switch direction {
        case .previous:
            return max(0, currentColumn - 1)
        case .next:
            return min(columnCount - 1, currentColumn + 1)
        }
    }

    static func reconciledColumn(_ column: Int, columnCount: Int) -> Int {
        guard columnCount > 0 else { return 0 }
        return min(max(0, column), columnCount - 1)
    }
}
