import Foundation

enum FeatureComposerTextEditOrigin: Sendable, Equatable {
    case interactive
    case paste
}

struct FeatureComposerTextEdit: Sendable, Equatable {
    let text: String
    let selectedUTF16Location: Int
    let origin: FeatureComposerTextEditOrigin
}

enum FeatureComposerTriggerKind: Sendable, Equatable {
    case slashCommand
    case model
    case skill
    case path
}

struct FeatureComposerTrigger: Sendable, Equatable {
    let kind: FeatureComposerTriggerKind
    let query: String
    let range: Range<Int>
}

/// Completion is activated by an interactive edit only. A paste or an
/// external binding update can change the draft, but cannot opt that text into
/// mention, path, skill, model, or command replacement.
struct FeatureComposerTriggerContext: Sendable, Equatable {
    let text: String
    let trigger: FeatureComposerTrigger

    static func activated(by edit: FeatureComposerTextEdit) -> Self? {
        guard edit.origin == .interactive else { return nil }
        let utf16 = edit.text.utf16
        let location = min(max(edit.selectedUTF16Location, 0), utf16.count)
        let utf16Index = utf16.index(utf16.startIndex, offsetBy: location)
        guard let cursorIndex = String.Index(utf16Index, within: edit.text) else { return nil }
        let cursorOffset = edit.text.distance(from: edit.text.startIndex, to: cursorIndex)
        guard let trigger = FeatureComposerTriggerParser.detect(
            in: edit.text,
            cursorOffset: cursorOffset
        ) else { return nil }
        return Self(text: edit.text, trigger: trigger)
    }
}

/// Mirrors the shared web/mobile trigger grammar while keeping this target
/// independent of the TypeScript runtime.
enum FeatureComposerTriggerParser {
    static func detect(in text: String, cursorOffset: Int? = nil) -> FeatureComposerTrigger? {
        let cursor = min(max(cursorOffset ?? text.count, 0), text.count)
        let cursorIndex = text.index(text.startIndex, offsetBy: cursor)
        let prefix = text[..<cursorIndex]
        let lineStartIndex = prefix.lastIndex(of: "\n").map { text.index(after: $0) }
            ?? text.startIndex
        let lineStart = text.distance(from: text.startIndex, to: lineStartIndex)
        let linePrefix = String(text[lineStartIndex..<cursorIndex])
        let lowercasedLine = linePrefix.lowercased()

        if lowercasedLine == "/model" {
            return FeatureComposerTrigger(kind: .model, query: "", range: lineStart..<cursor)
        }
        if lowercasedLine.hasPrefix("/model ") {
            let query = String(linePrefix.dropFirst("/model ".count))
                .trimmingCharacters(in: .whitespaces)
            return FeatureComposerTrigger(kind: .model, query: query, range: lineStart..<cursor)
        }
        if linePrefix.first == "/", !linePrefix.dropFirst().contains(where: { $0.isWhitespace }) {
            return FeatureComposerTrigger(
                kind: .slashCommand,
                query: String(linePrefix.dropFirst()),
                range: lineStart..<cursor
            )
        }

        var tokenStartIndex = cursorIndex
        while tokenStartIndex > text.startIndex {
            let previous = text.index(before: tokenStartIndex)
            if text[previous].isWhitespace { break }
            tokenStartIndex = previous
        }
        let token = String(text[tokenStartIndex..<cursorIndex])
        let tokenStart = text.distance(from: text.startIndex, to: tokenStartIndex)

        if token.first == "$" {
            return FeatureComposerTrigger(
                kind: .skill,
                query: String(token.dropFirst()),
                range: tokenStart..<cursor
            )
        }
        if token.first == "@" {
            return FeatureComposerTrigger(
                kind: .path,
                query: String(token.dropFirst()),
                range: tokenStart..<cursor
            )
        }
        return nil
    }

    static func replacing(
        _ range: Range<Int>,
        in text: String,
        with replacement: String
    ) -> String {
        let lower = min(max(range.lowerBound, 0), text.count)
        let upper = min(max(range.upperBound, lower), text.count)
        let start = text.index(text.startIndex, offsetBy: lower)
        let end = text.index(text.startIndex, offsetBy: upper)
        return String(text[..<start]) + replacement + String(text[end...])
    }
}
