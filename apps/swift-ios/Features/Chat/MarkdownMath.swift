import Foundation
import SwiftMath

enum MarkdownMathStyle: Equatable, Sendable {
    case inline
    case display
}

struct MarkdownMathExpression: Equatable, Sendable {
    let source: String
    let latex: String
    let style: MarkdownMathStyle

    var accessibilityLabel: String {
        "Math expression: \(latex)"
    }
}

enum MarkdownMathSegment: Equatable, Sendable {
    case text(String)
    case math(MarkdownMathExpression)
}

/// Finds only explicit `\(...\)` and `\[...\]` pairs in Markdown prose.
/// Code spans, link destinations, autolinks, and escaped delimiter runs stay literal.
enum MarkdownMathParser {
    private enum ASCII {
        static let tab: UInt8 = 0x09
        static let space: UInt8 = 0x20
        static let exclamationMark: UInt8 = 0x21
        static let openingParenthesis: UInt8 = 0x28
        static let closingParenthesis: UInt8 = 0x29
        static let slash: UInt8 = 0x2F
        static let colon: UInt8 = 0x3A
        static let lessThan: UInt8 = 0x3C
        static let equals: UInt8 = 0x3D
        static let greaterThan: UInt8 = 0x3E
        static let questionMark: UInt8 = 0x3F
        static let atSign: UInt8 = 0x40
        static let backslash: UInt8 = 0x5C
        static let closingBracket: UInt8 = 0x5D
        static let caret: UInt8 = 0x5E
        static let underscore: UInt8 = 0x5F
        static let backtick: UInt8 = 0x60
        static let openingBrace: UInt8 = 0x7B
        static let closingBrace: UInt8 = 0x7D
    }

    static func segments(in source: String) -> [MarkdownMathSegment] {
        guard source.contains("\\(") || source.contains("\\[") else {
            return [.text(source)]
        }
        let bytes = Array(source.utf8)
        guard bytes.count >= 4 else { return [.text(source)] }

        let protectedRanges = protectedRanges(in: bytes)
        let delimiters = delimiters(in: bytes, excluding: protectedRanges)
        let matches = validMatches(
            in: bytes,
            delimiters: delimiters,
            protectedRanges: protectedRanges
        )
        guard !matches.isEmpty else { return [.text(source)] }

        var segments: [MarkdownMathSegment] = []
        var cursor = 0
        for match in matches {
            if cursor < match.range.lowerBound {
                appendText(bytes[cursor..<match.range.lowerBound], to: &segments)
            }
            segments.append(.math(match.expression))
            cursor = match.range.upperBound
        }
        if cursor < bytes.count {
            appendText(bytes[cursor..<bytes.count], to: &segments)
        }
        return segments
    }

    private struct Delimiter {
        enum Kind: UInt8 {
            case inlineOpen = 40
            case inlineClose = 41
            case displayOpen = 91
            case displayClose = 93

            var isOpening: Bool {
                self == .inlineOpen || self == .displayOpen
            }

            var style: MarkdownMathStyle {
                switch self {
                case .inlineOpen, .inlineClose: .inline
                case .displayOpen, .displayClose: .display
                }
            }

            func closes(_ opening: Self) -> Bool {
                switch (opening, self) {
                case (.inlineOpen, .inlineClose), (.displayOpen, .displayClose): true
                default: false
                }
            }
        }

        let backslashIndex: Int
        let kind: Kind
    }

    private struct Match {
        let range: Range<Int>
        let expression: MarkdownMathExpression
    }

    private static func delimiters(
        in bytes: [UInt8],
        excluding protectedRanges: [Range<Int>]
    ) -> [Delimiter] {
        var delimiters: [Delimiter] = []
        var protectedIndex = 0
        var index = 0

        while index < bytes.count - 1 {
            while protectedIndex < protectedRanges.count,
                  index >= protectedRanges[protectedIndex].upperBound {
                protectedIndex += 1
            }
            if protectedIndex < protectedRanges.count,
               protectedRanges[protectedIndex].contains(index) {
                index = protectedRanges[protectedIndex].upperBound
                continue
            }
            guard bytes[index] == ASCII.backslash else {
                index += 1
                continue
            }

            let runStart = index
            while index < bytes.count, bytes[index] == ASCII.backslash {
                index += 1
            }
            guard (index - runStart).isMultiple(of: 2) == false,
                  index < bytes.count,
                  let kind = Delimiter.Kind(rawValue: bytes[index]) else {
                continue
            }
            delimiters.append(Delimiter(backslashIndex: index - 1, kind: kind))
            index += 1
        }
        return delimiters
    }

    private static func validMatches(
        in bytes: [UInt8],
        delimiters: [Delimiter],
        protectedRanges: [Range<Int>]
    ) -> [Match] {
        var matches: [Match] = []
        var pendingOpening: Delimiter?

        for delimiter in delimiters {
            if delimiter.kind.isOpening {
                // A newer opener lets parsing recover after malformed prose.
                pendingOpening = delimiter
                continue
            }
            guard let opening = pendingOpening,
                  delimiter.kind.closes(opening.kind) else { continue }

            let latexRange = (opening.backslashIndex + 2)..<delimiter.backslashIndex
            let latex = String(decoding: bytes[latexRange], as: UTF8.self)
            let sourceRange = opening.backslashIndex..<(delimiter.backslashIndex + 2)
            if containsProtectedContent(latexRange, protectedRanges: protectedRanges) == false,
               isValid(latex) {
                matches.append(Match(
                    range: sourceRange,
                    expression: MarkdownMathExpression(
                        source: String(decoding: bytes[sourceRange], as: UTF8.self),
                        latex: latex,
                        style: opening.kind.style
                    )
                ))
            }
            pendingOpening = nil
        }
        return matches
    }

    private static func containsProtectedContent(
        _ range: Range<Int>,
        protectedRanges: [Range<Int>]
    ) -> Bool {
        protectedRanges.contains {
            $0.lowerBound < range.upperBound && $0.upperBound > range.lowerBound
        }
    }

    private static func isValid(_ latex: String) -> Bool {
        guard latex.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return false
        }
        guard hasBalancedGroupsAndScripts(latex) else { return false }
        var error: NSError?
        return MTMathListBuilder.build(fromString: latex, error: &error) != nil && error == nil
    }

    private static func hasBalancedGroupsAndScripts(_ latex: String) -> Bool {
        let bytes = Array(latex.utf8)
        var groupDepth = 0
        var index = 0
        while index < bytes.count {
            if bytes[index] == ASCII.backslash, index + 1 < bytes.count,
               isBrace(bytes[index + 1]) {
                index += 2
                continue
            }
            if bytes[index] == ASCII.openingBrace { groupDepth += 1 }
            if bytes[index] == ASCII.closingBrace {
                guard groupDepth > 0 else { return false }
                groupDepth -= 1
            }
            if bytes[index] == ASCII.caret || bytes[index] == ASCII.underscore {
                var argument = index + 1
                while argument < bytes.count,
                      isHorizontalWhitespace(bytes[argument]) {
                    argument += 1
                }
                guard argument < bytes.count,
                      bytes[argument] != ASCII.closingBrace,
                      bytes[argument] != ASCII.caret,
                      bytes[argument] != ASCII.underscore else {
                    return false
                }
            }
            index += 1
        }
        return groupDepth == 0
    }

    private static func isBrace(_ byte: UInt8) -> Bool {
        byte == ASCII.openingBrace || byte == ASCII.closingBrace
    }

    private static func isHorizontalWhitespace(_ byte: UInt8) -> Bool {
        byte == ASCII.space || byte == ASCII.tab
    }

    private static func protectedRanges(in bytes: [UInt8]) -> [Range<Int>] {
        var ranges = codeSpanRanges(in: bytes)
        ranges.append(contentsOf: linkDestinationRanges(in: bytes))
        ranges.append(contentsOf: angleBracketRanges(in: bytes))
        ranges.sort { $0.lowerBound < $1.lowerBound }

        var merged: [Range<Int>] = []
        for range in ranges {
            guard let last = merged.last, range.lowerBound <= last.upperBound else {
                merged.append(range)
                continue
            }
            merged[merged.count - 1] = last.lowerBound..<max(last.upperBound, range.upperBound)
        }
        return merged
    }

    private static func codeSpanRanges(in bytes: [UInt8]) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        var index = 0
        while index < bytes.count {
            guard bytes[index] == ASCII.backtick else {
                index += 1
                continue
            }
            let opening = index
            while index < bytes.count, bytes[index] == ASCII.backtick { index += 1 }
            let runLength = index - opening
            var search = index
            var closing: Int?
            while search < bytes.count {
                guard bytes[search] == ASCII.backtick else {
                    search += 1
                    continue
                }
                let candidate = search
                while search < bytes.count, bytes[search] == ASCII.backtick { search += 1 }
                if search - candidate == runLength {
                    closing = search
                    break
                }
            }
            if let closing {
                ranges.append(opening..<closing)
                index = closing
            } else {
                index = opening + runLength
            }
        }
        return ranges
    }

    private static func linkDestinationRanges(in bytes: [UInt8]) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        var index = 0
        while index < bytes.count - 1 {
            guard bytes[index] == ASCII.closingBracket,
                  bytes[index + 1] == ASCII.openingParenthesis,
                  isEscaped(index, in: bytes) == false else {
                index += 1
                continue
            }
            let start = index + 2
            var cursor = start
            var depth = 1
            while cursor < bytes.count {
                if bytes[cursor] == ASCII.backslash {
                    cursor = min(bytes.count, cursor + 2)
                    continue
                }
                if bytes[cursor] == ASCII.openingParenthesis { depth += 1 }
                if bytes[cursor] == ASCII.closingParenthesis {
                    depth -= 1
                    if depth == 0 { break }
                }
                cursor += 1
            }
            if cursor < bytes.count, depth == 0 {
                ranges.append(start..<cursor)
                index = cursor + 1
            } else {
                index = start
            }
        }
        return ranges
    }

    private static func angleBracketRanges(in bytes: [UInt8]) -> [Range<Int>] {
        var ranges: [Range<Int>] = []
        var index = 0
        while index < bytes.count {
            guard bytes[index] == ASCII.lessThan, isEscaped(index, in: bytes) == false,
                  let closing = bytes[(index + 1)...].firstIndex(of: ASCII.greaterThan) else {
                index += 1
                continue
            }
            let content = bytes[(index + 1)..<closing]
            if isProtectedAngleContent(content) {
                ranges.append(index..<(closing + 1))
            }
            index = closing + 1
        }
        return ranges
    }

    private static func isProtectedAngleContent(_ content: ArraySlice<UInt8>) -> Bool {
        guard let first = content.first,
              isHorizontalWhitespace(first) == false else { return false }
        if first == ASCII.slash || first == ASCII.exclamationMark
            || first == ASCII.questionMark {
            return true
        }
        return content.contains(ASCII.colon)
            || content.contains(ASCII.equals)
            || content.contains(ASCII.atSign)
    }

    private static func isEscaped(_ index: Int, in bytes: [UInt8]) -> Bool {
        var slashCount = 0
        var cursor = index
        while cursor > 0, bytes[cursor - 1] == ASCII.backslash {
            slashCount += 1
            cursor -= 1
        }
        return slashCount.isMultiple(of: 2) == false
    }

    private static func appendText(
        _ bytes: ArraySlice<UInt8>,
        to segments: inout [MarkdownMathSegment]
    ) {
        guard !bytes.isEmpty else { return }
        let text = String(decoding: bytes, as: UTF8.self)
        if case .text(let previous)? = segments.last {
            segments[segments.count - 1] = .text(previous + text)
        } else {
            segments.append(.text(text))
        }
    }
}
