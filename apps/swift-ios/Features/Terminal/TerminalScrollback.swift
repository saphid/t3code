enum TerminalScrollback {
    static let rowLimit = 10_000
    static let byteLimit = 10 * 1_024 * 1_024
    static let truncationMarker = "\u{1B}[0m[T3: earlier terminal output truncated]\r\n"

    struct Accumulator {
        private(set) var text: String
        private var parserState: ParserState
        private var completedRows: Int
        private var hasUnterminatedRow: Bool

        init(_ buffer: String = "") {
            text = TerminalScrollback.capped(buffer)
            let body = TerminalScrollback.body(from: text)
            let metrics = TerminalScrollback.metrics(for: body)
            parserState = metrics.parserState
            completedRows = metrics.completedRows
            hasUnterminatedRow = metrics.hasUnterminatedRow
        }

        mutating func append(_ output: String) {
            guard output.isEmpty == false else { return }

            text.append(output)
            let metrics = TerminalScrollback.metrics(
                for: output,
                from: parserState,
                hasUnterminatedRow: hasUnterminatedRow
            )
            parserState = metrics.parserState
            completedRows += metrics.completedRows
            hasUnterminatedRow = metrics.hasUnterminatedRow

            let markerRows = text.hasPrefix(TerminalScrollback.truncationMarker) ? 1 : 0
            let rowCount = completedRows + (hasUnterminatedRow ? 1 : 0) + markerRows
            guard rowCount > TerminalScrollback.rowLimit
                    || text.utf8.count > TerminalScrollback.byteLimit else {
                return
            }

            self = Accumulator(text)
        }
    }

    static func capped(
        _ buffer: String,
        rowLimit: Int = rowLimit,
        byteLimit: Int = byteLimit
    ) -> String {
        guard rowLimit > 0, byteLimit >= truncationMarker.utf8.count else {
            return ""
        }

        let hadMarker = buffer.hasPrefix(truncationMarker)
        var retained = hadMarker ? String(buffer.dropFirst(truncationMarker.count)) : buffer
        var didTruncate = hadMarker
        if hadMarker == false,
           retained.utf8.count <= min(rowLimit, byteLimit) {
            return retained
        }
        var scanned = scan(retained)

        if scanned.rowCount > rowLimit {
            didTruncate = true
        }
        let retainedRowLimit = max(rowLimit - (didTruncate ? 1 : 0), 0)
        if scanned.rowCount > retainedRowLimit,
           let start = scanned.startIndexForLastRows(retainedRowLimit) {
            retained = String(retained[start...])
            didTruncate = true
            scanned = scan(retained)
        }

        if retained.utf8.count > byteLimit {
            didTruncate = true
        }
        let availableBytes = byteLimit - (didTruncate ? truncationMarker.utf8.count : 0)
        if retained.utf8.count > availableBytes,
           let start = scanned.startIndexForLastBytes(availableBytes) {
            retained = String(retained[start...])
            didTruncate = true
        }

        return didTruncate ? truncationMarker + retained : retained
    }

    private enum ParserState {
        case ground
        case escape
        case controlSequence
        case operatingSystemCommand
        case operatingSystemCommandEscape
        case stringControl
        case stringControlEscape
    }

    private struct CutPoint {
        let index: String.Index
        let byteOffset: Int
    }

    private struct Scan {
        let text: String
        let rowEnds: [CutPoint]
        let rowCount: Int

        func startIndexForLastRows(_ count: Int) -> String.Index? {
            guard rowCount > count else { return nil }
            let rowsToDrop = rowCount - count
            guard rowsToDrop > 0, rowsToDrop <= rowEnds.count else {
                return text.endIndex
            }
            return rowEnds[rowsToDrop - 1].index
        }

        func startIndexForLastBytes(_ count: Int) -> String.Index? {
            let minimumOffset = text.utf8.count - count
            let completeRowCut = rowEnds.first {
                $0.byteOffset >= minimumOffset
            }
            if let completeRowCut { return completeRowCut.index }
            return TerminalScrollback.firstSafeCut(in: text, atOrAfter: minimumOffset)
        }
    }

    private struct Metrics {
        let parserState: ParserState
        let completedRows: Int
        let hasUnterminatedRow: Bool
    }

    private static func body(from text: String) -> String {
        text.hasPrefix(truncationMarker)
            ? String(text.dropFirst(truncationMarker.count))
            : text
    }

    private static func metrics(
        for text: String,
        from initialState: ParserState = .ground,
        hasUnterminatedRow initialHasUnterminatedRow: Bool = false
    ) -> Metrics {
        var state = initialState
        var completedRows = 0
        var hasUnterminatedRow = initialHasUnterminatedRow

        for scalar in text.unicodeScalars {
            let wasGround = state == .ground
            state = nextState(after: scalar, from: state)
            if wasGround, scalar == "\n" {
                completedRows += 1
                hasUnterminatedRow = false
            } else {
                hasUnterminatedRow = true
            }
        }
        return Metrics(
            parserState: state,
            completedRows: completedRows,
            hasUnterminatedRow: hasUnterminatedRow
        )
    }

    private static func scan(_ text: String) -> Scan {
        var state = ParserState.ground
        var byteOffset = 0
        var rowEnds = [CutPoint]()
        let scalars = text.unicodeScalars

        for scalarIndex in scalars.indices {
            let scalar = scalars[scalarIndex]
            let wasGround = state == .ground
            state = nextState(after: scalar, from: state)
            byteOffset += scalar.utf8.count

            guard state == .ground else { continue }
            let nextScalarIndex = scalars.index(after: scalarIndex)
            guard let stringIndex = nextScalarIndex.samePosition(in: text) else { continue }
            let endsRow = wasGround && scalar == "\n"
            if endsRow {
                rowEnds.append(
                    CutPoint(index: stringIndex, byteOffset: byteOffset)
                )
            }
        }

        let hasUnterminatedRow = rowEnds.last?.index != text.endIndex && text.isEmpty == false
        return Scan(
            text: text,
            rowEnds: rowEnds,
            rowCount: rowEnds.count + (hasUnterminatedRow ? 1 : 0)
        )
    }

    private static func firstSafeCut(in text: String, atOrAfter minimumOffset: Int) -> String.Index {
        var state = ParserState.ground
        var byteOffset = 0
        let scalars = text.unicodeScalars

        for scalarIndex in scalars.indices {
            let scalar = scalars[scalarIndex]
            state = nextState(after: scalar, from: state)
            byteOffset += scalar.utf8.count
            guard state == .ground, byteOffset >= minimumOffset else { continue }
            let nextScalarIndex = scalars.index(after: scalarIndex)
            if let stringIndex = nextScalarIndex.samePosition(in: text) {
                return stringIndex
            }
        }
        return text.endIndex
    }

    private static func nextState(after scalar: Unicode.Scalar, from state: ParserState) -> ParserState {
        let value = scalar.value
        switch state {
        case .ground:
            return value == 0x1B ? .escape : .ground
        case .escape:
            switch value {
            case 0x5B:
                return .controlSequence
            case 0x5D:
                return .operatingSystemCommand
            case 0x50, 0x58, 0x5E, 0x5F:
                return .stringControl
            default:
                return .ground
            }
        case .controlSequence:
            if value == 0x1B { return .escape }
            return (0x40...0x7E).contains(value) ? .ground : .controlSequence
        case .operatingSystemCommand:
            if value == 0x07 { return .ground }
            return value == 0x1B ? .operatingSystemCommandEscape : .operatingSystemCommand
        case .operatingSystemCommandEscape:
            if value == 0x5C { return .ground }
            return value == 0x1B ? .operatingSystemCommandEscape : .operatingSystemCommand
        case .stringControl:
            return value == 0x1B ? .stringControlEscape : .stringControl
        case .stringControlEscape:
            if value == 0x5C { return .ground }
            return value == 0x1B ? .stringControlEscape : .stringControl
        }
    }
}
