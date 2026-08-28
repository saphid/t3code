public struct FeatureDiffSyntaxSpan: Sendable, Equatable, Hashable {
    public var text: String
    public var syntax: FeatureSourceTokenKind
    public var emphasis: FeatureDiffTextSpanKind

    public init(
        text: String,
        syntax: FeatureSourceTokenKind,
        emphasis: FeatureDiffTextSpanKind
    ) {
        self.text = text
        self.syntax = syntax
        self.emphasis = emphasis
    }
}

public struct FeatureDiffSyntaxLine: Identifiable, Sendable, Equatable, Hashable {
    public var line: FeatureDiffLine
    public var spans: [FeatureDiffSyntaxSpan]

    public init(line: FeatureDiffLine, spans: [FeatureDiffSyntaxSpan]) {
        self.line = line
        self.spans = spans
    }

    public var id: String { line.id }
    public var text: String { spans.map(\.text).joined() }
}

/// Builds bounded, immutable syntax plans before SwiftUI renders diff rows.
public enum FeatureDiffSyntaxHighlighter {
    public static func language(for path: String) -> String? {
        guard let fileName = path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last,
              let dot = fileName.lastIndex(of: "."),
              dot != fileName.startIndex else {
            return nil
        }
        let extensionStart = fileName.index(after: dot)
        guard extensionStart != fileName.endIndex else { return nil }
        switch fileName[extensionStart...].lowercased() {
        case "swift": return "swift"
        case "ts", "tsx": return "typescript"
        case "js", "jsx", "mjs", "cjs": return "javascript"
        case "json": return "json"
        case "md", "mdx": return "markdown"
        case "css", "scss": return "css"
        case "html", "htm": return "html"
        case "xml", "svg": return "xml"
        case "sh", "zsh", "bash": return "shell"
        case "py": return "python"
        case "rs": return "rust"
        case "go": return "go"
        case "rb": return "ruby"
        case "sql": return "sql"
        case "toml": return "toml"
        case "yml", "yaml": return "yaml"
        default: return nil
        }
    }

    public static func lines(
        for file: FeatureReviewFile,
        lines: [FeatureDiffLine]? = nil
    ) -> [FeatureDiffSyntaxLine] {
        let source = lines ?? file.lines
        let plain = source.map { line in
            FeatureDiffSyntaxLine(line: line, spans: plainSpans(for: line))
        }
        guard file.change != .binary,
              let language = language(for: file.path),
              fitsContentLimit(source) else {
            return plain
        }

        var syntaxByIndex = highlightedSpans(
            in: source,
            language: language,
            includes: { $0 == .context || $0 == .deletion }
        )
        syntaxByIndex.merge(
            highlightedSpans(
                in: source,
                language: language,
                includes: { $0 == .context || $0 == .addition }
            ),
            uniquingKeysWith: { _, new in new }
        )

        return source.enumerated().map { index, line in
            guard line.kind != .hunk, let syntax = syntaxByIndex[index] else {
                return plain[index]
            }
            return FeatureDiffSyntaxLine(
                line: line,
                spans: composedSpans(
                    text: line.text,
                    syntax: syntax,
                    emphasis: line.spans
                )
            )
        }
    }

    private static func fitsContentLimit(_ lines: [FeatureDiffLine]) -> Bool {
        var byteCount = 0
        for (index, line) in lines.enumerated() {
            if index > 0 {
                guard byteCount < FeatureSourceHighlighter.maximumContentBytes else {
                    return false
                }
                byteCount += 1
            }
            let lineBytes = line.text.utf8.count
            guard lineBytes <= FeatureSourceHighlighter.maximumContentBytes - byteCount else {
                return false
            }
            byteCount += lineBytes
        }
        return true
    }

    private static func highlightedSpans(
        in lines: [FeatureDiffLine],
        language: String,
        includes: (FeatureDiffLineKind) -> Bool
    ) -> [Int: [FeatureSourceSpan]] {
        let selected = lines.enumerated().filter { includes($0.element.kind) }
        guard !selected.isEmpty else { return [:] }
        let highlighted = FeatureSourceHighlighter.lines(
            text: selected.map(\.element.text).joined(separator: "\n"),
            language: language
        )
        guard highlighted.count == selected.count else { return [:] }
        return Dictionary(uniqueKeysWithValues: zip(selected, highlighted).map { pair in
            (pair.0.offset, pair.1.spans)
        })
    }

    private static func composedSpans(
        text: String,
        syntax: [FeatureSourceSpan],
        emphasis: [FeatureDiffTextSpan]?
    ) -> [FeatureDiffSyntaxSpan] {
        guard syntax.map(\.text).joined() == text else {
            return plainSpans(text: text, emphasis: emphasis)
        }
        let emphasisSpans = validEmphasis(text: text, emphasis: emphasis)
        guard text.isEmpty == false else { return [] }

        let syntaxCharacters = syntax.filter { $0.text.isEmpty == false }.map { Array($0.text) }
        let emphasisCharacters = emphasisSpans.filter { $0.text.isEmpty == false }.map {
            Array($0.text)
        }
        let syntaxKinds = syntax.filter { $0.text.isEmpty == false }.map(\.kind)
        let emphasisKinds = emphasisSpans.filter { $0.text.isEmpty == false }.map(\.kind)
        guard syntaxCharacters.isEmpty == false, emphasisCharacters.isEmpty == false else {
            return plainSpans(text: text, emphasis: emphasis)
        }

        var output: [FeatureDiffSyntaxSpan] = []
        var syntaxIndex = 0
        var syntaxOffset = 0
        var emphasisIndex = 0
        var emphasisOffset = 0
        while syntaxIndex < syntaxCharacters.count, emphasisIndex < emphasisCharacters.count {
            let syntaxRemaining = syntaxCharacters[syntaxIndex].count - syntaxOffset
            let emphasisRemaining = emphasisCharacters[emphasisIndex].count - emphasisOffset
            let length = min(syntaxRemaining, emphasisRemaining)
            let characters = syntaxCharacters[syntaxIndex][syntaxOffset ..< syntaxOffset + length]
            append(
                String(characters),
                syntax: syntaxKinds[syntaxIndex],
                emphasis: emphasisKinds[emphasisIndex],
                to: &output
            )

            syntaxOffset += length
            if syntaxOffset == syntaxCharacters[syntaxIndex].count {
                syntaxIndex += 1
                syntaxOffset = 0
            }
            emphasisOffset += length
            if emphasisOffset == emphasisCharacters[emphasisIndex].count {
                emphasisIndex += 1
                emphasisOffset = 0
            }
        }

        guard output.map(\.text).joined() == text else {
            return plainSpans(text: text, emphasis: emphasis)
        }
        return output
    }

    private static func plainSpans(for line: FeatureDiffLine) -> [FeatureDiffSyntaxSpan] {
        plainSpans(text: line.text, emphasis: line.spans)
    }

    private static func plainSpans(
        text: String,
        emphasis: [FeatureDiffTextSpan]?
    ) -> [FeatureDiffSyntaxSpan] {
        validEmphasis(text: text, emphasis: emphasis).map {
            FeatureDiffSyntaxSpan(text: $0.text, syntax: .plain, emphasis: $0.kind)
        }
    }

    private static func validEmphasis(
        text: String,
        emphasis: [FeatureDiffTextSpan]?
    ) -> [FeatureDiffTextSpan] {
        if let emphasis, emphasis.map(\.text).joined() == text {
            return emphasis
        }
        guard text.isEmpty == false else { return [] }
        return [FeatureDiffTextSpan(text: text, kind: .unchanged)]
    }

    private static func append(
        _ text: String,
        syntax: FeatureSourceTokenKind,
        emphasis: FeatureDiffTextSpanKind,
        to output: inout [FeatureDiffSyntaxSpan]
    ) {
        guard text.isEmpty == false else { return }
        if output.last?.syntax == syntax, output.last?.emphasis == emphasis {
            output[output.count - 1].text += text
        } else {
            output.append(
                FeatureDiffSyntaxSpan(text: text, syntax: syntax, emphasis: emphasis)
            )
        }
    }
}
