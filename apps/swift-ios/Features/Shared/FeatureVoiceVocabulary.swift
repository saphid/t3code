import Foundation

/// Builds the contextual-vocabulary list fed to the on-device recognizer so
/// dictation gets project jargon right ("worktree", "pnpm", branch names,
/// identifiers from the current session). Mirrors the TypeScript
/// implementation in packages/shared/src/voiceVocabulary.ts; the two must
/// stay behaviorally aligned.
///
/// Apple's speech APIs accept at most 100 contextual phrases and recommend
/// short ones, so extraction filters aggressively and the result is capped.
enum FeatureVoiceVocabulary {
    static let limit = 100

    struct Source {
        let text: String
        var weight: Double = 1

        init(text: String, weight: Double = 1) {
            self.text = text
            self.weight = weight
        }
    }

    /// Terms every T3 Code session is likely to use regardless of history.
    static let staticTerms: [String] = [
        "T3 Code", "worktree", "pnpm", "Fable", "Opus", "Codex", "Claude",
        "rebase", "changeset", "Vite", "SwiftUI", "Xcode", "TestFlight",
        "subagent", "monorepo", "typecheck", "TypeScript", "Tailscale",
    ]

    private static let minTermLength = 3
    private static let maxTermLength = 32
    private static let minPlainWordLength = 4
    private static let minPlainWordCount = 2

    private static let genericTechTerms: Set<String> = [
        "async", "await", "boolean", "class", "const", "constructor", "default",
        "double", "error", "export", "false", "float", "function", "github",
        "import", "index", "input", "interface", "javascript", "module", "null",
        "number", "object", "output", "private", "public", "python", "return",
        "static", "string", "test", "tests", "true", "type", "typescript",
        "undefined", "value", "void",
    ]

    private static let commonEnglishWords: Set<String> = Set(
        """
        about above actually after again against almost along already also although always among another answer \
        anything around asked away back because become been before began behind being below better between both \
        bring called came cannot change check children close come could country course days did different does \
        doing done down during each early enough even ever every everything example fact family far feel few find \
        first follow found four from get give goes going good got great group hand hard has have head hear help \
        her here high him his home house how however idea important into its just keep kind knew know large last \
        later learn leave left let life light like line little live long look made make many may mean men might \
        more most move much must name near need never new next night not now number of off often old once one \
        only open other our out over own part people place point put question quite rather read really right room \
        said same saw say school second see seem seen set she should show side since small some something \
        sometimes soon start state still story such sure take tell than that the their them then there these they \
        thing think this those though thought three through time today together told too took toward turn under \
        until upon use used very want was water way well went were what when where which while white who whole \
        why will with within without word work world would year yes yet you young your
        """.split(separator: " ").map(String.init)
    )

    private static let tokenRegex = #/[A-Za-z][A-Za-z0-9]*(?:[-_./+][A-Za-z0-9]+)*/#
    private static let innerUppercaseRegex = #/[a-z0-9][A-Z]/#
    private static let separatorRegex = #/[A-Za-z0-9][-_.][A-Za-z0-9]/#
    private static let letterDigitMixRegex = #/(?:[A-Za-z][0-9]|[0-9][A-Za-z])/#
    private static let allCapsAcronymRegex = #/^[A-Z][A-Z0-9]{1,7}$/#
    private static let plainLowercaseRegex = #/^[a-z]+$/#
    private static let hexLikeRegex = #/^[0-9a-fA-F]{7,}$/#
    private static let uuidSegmentRegex = #/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4,12})+$/#
    private static let inlineCodeRegex = #/`([^`\n]+)`/#

    private struct TermStats {
        var score: Double = 0
        var count: Int = 0
        var casings: [String: Int] = [:]

        mutating func record(_ token: String, score added: Double) {
            score += added
            count += 1
            casings[token, default: 0] += 1
        }

        var dominantCasing: String {
            casings.max { lhs, rhs in
                lhs.value == rhs.value ? lhs.key > rhs.key : lhs.value < rhs.value
            }?.key ?? ""
        }
    }

    private static func isIdentifierLike(_ token: String) -> Bool {
        token.contains(innerUppercaseRegex)
            || token.contains(separatorRegex)
            || token.contains(letterDigitMixRegex)
            || token.wholeMatch(of: allCapsAcronymRegex) != nil
    }

    private static func isNoise(_ token: String) -> Bool {
        if token.count < minTermLength || token.count > maxTermLength { return true }
        if token.wholeMatch(of: hexLikeRegex) != nil { return true }
        if token.wholeMatch(of: uuidSegmentRegex) != nil { return true }
        // Numeric-leading UUIDs tokenize from their first letter, leaving
        // fragments like "da-4946-8df8"; strip separators before hex-testing.
        let stripped = token.filter { !"-_./".contains($0) }
        if stripped.count >= 7, stripped.allSatisfy(\.isHexDigit) { return true }
        return genericTechTerms.contains(token.lowercased())
    }

    /// Extracts a ranked, capped vocabulary from free text. Identifier-shaped
    /// tokens qualify on first sight; plain lowercase words only when they are
    /// unusual and repeat across the sources.
    static func extract(from sources: [Source], limit: Int = limit) -> [String] {
        var identifierTerms: [String: TermStats] = [:]
        var plainTerms: [String: TermStats] = [:]

        for source in sources {
            guard source.weight > 0, !source.text.isEmpty else { continue }

            var inlineCodeTokens: Set<String> = []
            for match in source.text.matches(of: inlineCodeRegex) {
                for token in String(match.1).matches(of: tokenRegex) {
                    inlineCodeTokens.insert(String(token.0))
                }
            }

            for match in source.text.matches(of: tokenRegex) {
                let rawToken = String(match.0)
                // Speaking a full path is unrealistic; the basename is the
                // valuable part.
                let token = rawToken.contains("/")
                    ? (rawToken.split(separator: "/").last.map(String.init) ?? rawToken)
                    : rawToken
                if isNoise(token) { continue }

                let codeBoost: Double = inlineCodeTokens.contains(rawToken) ? 2 : 1
                if isIdentifierLike(token) {
                    identifierTerms[token.lowercased(), default: TermStats()]
                        .record(token, score: source.weight * codeBoost * 2)
                } else if token.wholeMatch(of: plainLowercaseRegex) != nil,
                          token.count >= minPlainWordLength,
                          !commonEnglishWords.contains(token) {
                    plainTerms[token.lowercased(), default: TermStats()]
                        .record(token, score: source.weight * codeBoost)
                }
            }
        }

        var ranked: [(term: String, score: Double)] = identifierTerms.values.map {
            ($0.dominantCasing, $0.score)
        }
        ranked += plainTerms.values.compactMap { stats in
            stats.count >= minPlainWordCount ? (stats.dominantCasing, stats.score) : nil
        }

        ranked.sort { lhs, rhs in
            lhs.score == rhs.score ? lhs.term < rhs.term : lhs.score > rhs.score
        }
        return ranked.prefix(limit).map(\.term)
    }

    /// Merges vocabulary lists in priority order (earlier lists win),
    /// removing case-insensitive duplicates and enforcing the cap.
    static func merge(_ lists: [[String]], limit: Int = limit) -> [String] {
        var seen: Set<String> = []
        var merged: [String] = []
        for list in lists {
            for term in list {
                let key = term.lowercased()
                if seen.contains(key) { continue }
                seen.insert(key)
                merged.append(term)
                if merged.count >= limit { return merged }
            }
        }
        return merged
    }

    // MARK: - Post-recognition correction

    private static let transcriptWordRegex = #/[A-Za-z0-9][A-Za-z0-9'-]*/#

    private static func canonicalize(_ value: String) -> String {
        value.lowercased().filter { !"-_./ \t\n".contains($0) }
    }

    private static func distanceBudget(for canonical: String) -> Int {
        canonical.count >= 10 ? 2 : canonical.count >= 4 ? 1 : 0
    }

    private static func levenshtein(_ a: [Character], _ b: [Character]) -> Int {
        if a == b { return 0 }
        var previous = Array(0...b.count)
        for row in 1...a.count {
            var current = [row]
            current.reserveCapacity(b.count + 1)
            for col in 1...b.count {
                current.append(
                    min(
                        previous[col] + 1,
                        current[col - 1] + 1,
                        previous[col - 1] + (a[row - 1] == b[col - 1] ? 0 : 1)
                    )
                )
            }
            previous = current
        }
        return previous[b.count]
    }

    /// Rewrites near-miss recognitions back to vocabulary terms: "word tree"
    /// becomes "worktree", "PNP" becomes "pnpm", exact matches adopt the
    /// term's casing.
    ///
    /// Ranking at each position: an exact canonical match always wins
    /// (longest span first; a same-surface exact match consumes its span so
    /// a fuzzy term can never rewrite already-correct text). Only when no
    /// exact match exists does the fuzzy pass run, smallest edit distance
    /// first with shorter spans preferred, so a two-word exact is never
    /// absorbed into a three-word fuzzy. Fuzzy on a single word requires an
    /// uppercase letter or digit in the surface ("PNP" qualifies) so ordinary
    /// dictated words ("provide") are never rewritten to similar vocabulary
    /// ("provider"). Replaced ranges never overlap.
    static func applyCorrections(to text: String, vocabulary: [String]) -> String {
        guard !text.isEmpty, !vocabulary.isEmpty else { return text }

        struct Term {
            let term: String
            let canonical: String
            let canonicalChars: [Character]
        }
        let terms: [Term] = vocabulary
            .map { Term(term: $0, canonical: canonicalize($0), canonicalChars: Array(canonicalize($0))) }
            .filter { $0.canonical.count >= 3 }
        guard !terms.isEmpty else { return text }

        struct Word {
            let range: Range<String.Index>
            let text: String
        }
        let words = text.matches(of: transcriptWordRegex).map {
            Word(range: $0.range, text: String($0.0))
        }

        struct Replacement {
            let range: Range<String.Index>
            let term: String
            let span: Int
        }
        var replacements: [Replacement] = []

        var index = 0
        while index < words.count {
            var exact: Replacement?
            var exactIsSameSurface = false
            for span in stride(from: 3, through: 1, by: -1) {
                guard index + span <= words.count else { continue }
                let run = words[index..<(index + span)]
                guard let first = run.first, let last = run.last else { continue }
                let candidate = canonicalize(run.map(\.text).joined())
                for term in terms where candidate == term.canonical {
                    let surface = String(text[first.range.lowerBound..<last.range.upperBound])
                    exact = Replacement(
                        range: first.range.lowerBound..<last.range.upperBound,
                        term: term.term,
                        span: span
                    )
                    exactIsSameSurface = surface == term.term
                    break
                }
                if exact != nil { break }
            }
            if let exact {
                if !exactIsSameSurface { replacements.append(exact) }
                index += exact.span
                continue
            }

            var best: Replacement?
            var bestDistance = Int.max
            for span in 1...3 {
                guard index + span <= words.count else { continue }
                let run = words[index..<(index + span)]
                guard let first = run.first, let last = run.last else { continue }
                let fuzzyAllowed = span >= 2
                    || run.contains { word in
                        word.text.contains { $0.isUppercase || $0.isNumber }
                    }
                guard fuzzyAllowed else { continue }
                let candidate = canonicalize(run.map(\.text).joined())
                let candidateChars = Array(candidate)
                for term in terms {
                    guard candidate.first == term.canonical.first else { continue }
                    guard abs(candidate.count - term.canonical.count) <= 2 else { continue }
                    let budget = distanceBudget(for: term.canonical)
                    guard budget > 0 else { continue }
                    let distance = levenshtein(candidateChars, term.canonicalChars)
                    guard distance > 0, distance <= budget, distance < bestDistance else { continue }
                    bestDistance = distance
                    best = Replacement(
                        range: first.range.lowerBound..<last.range.upperBound,
                        term: term.term,
                        span: span
                    )
                }
            }
            if let best {
                replacements.append(best)
                index += best.span
            } else {
                index += 1
            }
        }

        var result = ""
        var cursor = text.startIndex
        for replacement in replacements {
            result += text[cursor..<replacement.range.lowerBound]
            result += replacement.term
            cursor = replacement.range.upperBound
        }
        result += text[cursor...]
        return result
    }
}
