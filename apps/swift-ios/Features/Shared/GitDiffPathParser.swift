import Foundation

struct GitDiffPathHeader: Equatable {
    let displayPath: String
    let oldPath: String?
    let newPath: String?
    let oldPrefix: String?
    let newPrefix: String?
}

struct GitDiffParsedPath: Equatable {
    let displayPath: String
    let workspacePath: String?
}

enum GitDiffPathParser {
    static func header(_ line: String) -> GitDiffPathHeader {
        let raw =
            line.hasPrefix("diff --git ")
            ? String(line.dropFirst("diff --git ".count))
            : line
        guard let tokens = pathTokens(raw), tokens.count == 2 else {
            return GitDiffPathHeader(
                displayPath: fallbackDisplayPath(raw),
                oldPath: nil,
                newPath: nil,
                oldPrefix: nil,
                newPrefix: nil
            )
        }

        let oldRaw = normalizeSeparators(tokens[0])
        let newRaw = normalizeSeparators(tokens[1])
        let prefixes = inferredPrefixes(old: oldRaw, new: newRaw)
        let oldCandidate = removing(prefixes.old, from: oldRaw)
        let newCandidate = removing(prefixes.new, from: newRaw)
        return GitDiffPathHeader(
            displayPath: displayPath(newCandidate),
            oldPath: workspacePath(oldCandidate),
            newPath: workspacePath(newCandidate),
            oldPrefix: prefixes.old,
            newPrefix: prefixes.new
        )
    }

    static func marker(_ raw: String, expectedPrefix: String?) -> GitDiffParsedPath {
        let value = raw == "/dev/null" ? raw : markerValue(raw)
        guard value != "/dev/null", let decoded = singlePath(value, allowsSpaces: false) else {
            return GitDiffParsedPath(
                displayPath: value == "/dev/null" ? "Changed file" : fallbackDisplayPath(value),
                workspacePath: nil
            )
        }
        let normalized = normalizeSeparators(decoded)
        let candidate: String
        if let expectedPrefix {
            guard normalized.hasPrefix(expectedPrefix) else {
                return GitDiffParsedPath(
                    displayPath: displayPath(normalized),
                    workspacePath: nil
                )
            }
            candidate = String(normalized.dropFirst(expectedPrefix.count))
        } else {
            candidate = normalized
        }
        return GitDiffParsedPath(
            displayPath: displayPath(candidate),
            workspacePath: workspacePath(candidate)
        )
    }

    static func metadata(_ raw: String) -> GitDiffParsedPath {
        guard let decoded = singlePath(raw, allowsSpaces: true) else {
            return GitDiffParsedPath(
                displayPath: fallbackDisplayPath(raw),
                workspacePath: nil
            )
        }
        let normalized = normalizeSeparators(decoded)
        return GitDiffParsedPath(
            displayPath: displayPath(normalized),
            workspacePath: workspacePath(normalized)
        )
    }

    private static func pathTokens(_ raw: String) -> [String]? {
        let bytes = Array(raw.utf8)
        var tokens: [String] = []
        var index = 0

        while index < bytes.count {
            while index < bytes.count, bytes[index] == 0x20 || bytes[index] == 0x09 {
                index += 1
            }
            guard index < bytes.count else { break }

            if bytes[index] == 0x22 {
                guard let token = quotedToken(bytes, index: &index) else { return nil }
                tokens.append(token)
            } else {
                let start = index
                while index < bytes.count, bytes[index] != 0x20, bytes[index] != 0x09 {
                    index += 1
                }
                guard let token = String(bytes: bytes[start..<index], encoding: .utf8) else {
                    return nil
                }
                tokens.append(token)
            }
        }
        return tokens
    }

    private static func singlePath(_ raw: String, allowsSpaces: Bool) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return nil }
        if trimmed.hasPrefix("\"") {
            guard let tokens = pathTokens(trimmed), tokens.count == 1 else { return nil }
            return tokens[0]
        }
        if allowsSpaces {
            return trimmed
        }
        guard trimmed.contains(where: \Character.isWhitespace) == false else { return nil }
        return trimmed
    }

    private static func quotedToken(_ bytes: [UInt8], index: inout Int) -> String? {
        guard bytes[index] == 0x22 else { return nil }
        index += 1
        var decoded: [UInt8] = []

        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 0x22 {
                return String(bytes: decoded, encoding: .utf8)
            }
            guard byte == 0x5C else {
                decoded.append(byte)
                continue
            }
            guard index < bytes.count else { return nil }
            let escaped = bytes[index]
            index += 1
            switch escaped {
            case 0x61: decoded.append(0x07)
            case 0x62: decoded.append(0x08)
            case 0x66: decoded.append(0x0C)
            case 0x6E: decoded.append(0x0A)
            case 0x72: decoded.append(0x0D)
            case 0x74: decoded.append(0x09)
            case 0x76: decoded.append(0x0B)
            case 0x22, 0x5C: decoded.append(escaped)
            case 0x30...0x37:
                var value = Int(escaped - 0x30)
                var count = 1
                while count < 3, index < bytes.count, (0x30...0x37).contains(bytes[index]) {
                    value = value * 8 + Int(bytes[index] - 0x30)
                    index += 1
                    count += 1
                }
                guard value <= 0xFF else { return nil }
                decoded.append(UInt8(value))
            default:
                return nil
            }
        }
        return nil
    }

    private static func inferredPrefixes(old: String, new: String) -> (old: String?, new: String?) {
        guard let oldPrefix = prefixComponent(old),
            let newPrefix = prefixComponent(new),
            oldPrefix != newPrefix,
            knownPrefixes.contains(oldPrefix),
            knownPrefixes.contains(newPrefix)
        else {
            return (nil, nil)
        }
        return ("\(oldPrefix)/", "\(newPrefix)/")
    }

    private static let knownPrefixes: Set<String> = ["a", "b", "c", "i", "o", "w", "1", "2"]

    private static func prefixComponent(_ path: String) -> String? {
        guard let slash = path.firstIndex(of: "/") else { return nil }
        return String(path[..<slash])
    }

    private static func removing(_ prefix: String?, from path: String) -> String {
        guard let prefix, path.hasPrefix(prefix) else { return path }
        return String(path.dropFirst(prefix.count))
    }

    private static func markerValue(_ raw: String) -> String {
        if raw.hasPrefix("\"") { return raw }
        return raw.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
            .first
            .map(String.init)
            ?? raw
    }

    private static func normalizeSeparators(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "/")
    }

    private static func workspacePath(_ raw: String) -> String? {
        guard raw.isEmpty == false,
            raw.hasPrefix("/") == false,
            raw.hasSuffix("/") == false,
            raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) == false
        else {
            return nil
        }
        if raw.count >= 3 {
            let characters = Array(raw.prefix(3))
            if characters[0].isLetter, characters[1] == ":", characters[2] == "/" {
                return nil
            }
        }

        var components: [Substring] = []
        for component in raw.split(separator: "/", omittingEmptySubsequences: false) {
            if component == "." || component.isEmpty { continue }
            guard component != ".." else { return nil }
            components.append(component)
        }
        guard components.isEmpty == false else { return nil }
        return components.joined(separator: "/")
    }

    private static func displayPath(_ raw: String) -> String {
        let sanitized = raw.unicodeScalars.map {
            CharacterSet.controlCharacters.contains($0) ? "�" : String($0)
        }.joined()
        return sanitized.isEmpty ? "Changed file" : sanitized
    }

    private static func fallbackDisplayPath(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else { return "Changed file" }
        return displayPath(String(trimmed.prefix(240)))
    }
}
