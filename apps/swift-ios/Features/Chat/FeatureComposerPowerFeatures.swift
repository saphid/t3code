import Foundation

/// Provider- and project-scoped data used by the composer command menu.
/// The feature layer supplies these values because the composer should not
/// know how a particular environment fetches provider or workspace data.
struct FeatureComposerPowerFeatures {
    typealias PathSearch = (_ query: String) async throws -> [FeatureComposerPathEntry]

    var slashCommands: [FeatureProviderSlashCommand]
    var skills: [FeatureProviderSkill]
    var pathSearchScopeID: String
    var searchPaths: PathSearch?

    init(
        slashCommands: [FeatureProviderSlashCommand] = [],
        skills: [FeatureProviderSkill] = [],
        pathSearchScopeID: String = "",
        searchPaths: PathSearch? = nil
    ) {
        self.slashCommands = slashCommands
        self.skills = skills
        self.pathSearchScopeID = pathSearchScopeID
        self.searchPaths = searchPaths
    }

    static var disabled: FeatureComposerPowerFeatures { FeatureComposerPowerFeatures() }
}

public struct FeatureProviderSlashCommand: Identifiable, Sendable, Equatable, Hashable, Codable {
    public var id: String { name }
    public let name: String
    public let description: String?
    public let inputHint: String?

    public init(
        name: String,
        description: String? = nil,
        inputHint: String? = nil
    ) {
        self.name = name
        self.description = description
        self.inputHint = inputHint
    }
}

public struct FeatureProviderSkill: Identifiable, Sendable, Equatable, Hashable, Codable {
    public var id: String { name }
    public let name: String
    public let displayName: String?
    public let description: String?
    public let shortDescription: String?
    public let path: String
    public let scope: String?
    public let isEnabled: Bool
    public let userInvocationOnly: Bool
    public let userInvocable: Bool

    public init(
        name: String,
        displayName: String? = nil,
        description: String? = nil,
        shortDescription: String? = nil,
        path: String = "",
        scope: String? = nil,
        isEnabled: Bool = true,
        userInvocationOnly: Bool = false,
        userInvocable: Bool = true
    ) {
        self.name = name
        self.displayName = displayName
        self.description = description
        self.shortDescription = shortDescription
        self.path = path
        self.scope = scope
        self.isEnabled = isEnabled
        self.userInvocationOnly = userInvocationOnly
        self.userInvocable = userInvocable
    }

    var source: FeatureProviderSkillSource {
        let normalizedPath = path.replacingOccurrences(of: "\\", with: "/")
        if normalizedPath.contains("/.codex/plugins/")
            || normalizedPath.contains("/.agents/plugins/") {
            return .app
        }
        switch scope?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "repo", "repository": return .repository
        case "project", "workspace", "local": return .project
        case "user", "personal": return .personal
        case "system": return .system
        default: return .other
        }
    }
}

enum FeatureProviderSkillSource: String, Sendable, Equatable {
    case app
    case repository
    case project
    case personal
    case system
    case other

    var systemImage: String {
        switch self {
        case .app: "square.grid.2x2"
        case .repository, .project: "folder"
        case .personal: "person.crop.circle"
        case .system: "gearshape"
        case .other: "shippingbox"
        }
    }
}

struct FeatureComposerPathEntry: Identifiable, Sendable, Equatable, Hashable {
    enum Kind: String, Sendable, Equatable, Hashable {
        case file
        case directory
    }

    var id: String { path }
    let path: String
    let kind: Kind

    init(path: String, kind: Kind) {
        self.path = path
        self.kind = kind
    }

    var name: String {
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        return normalized.split(separator: "/", omittingEmptySubsequences: true)
            .last
            .map(String.init) ?? path
    }

    var parentPath: String {
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        let parts = normalized.split(separator: "/", omittingEmptySubsequences: true)
        return parts.dropLast().joined(separator: "/")
    }
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

struct FeatureCodexFeedbackCommand: Sendable, Equatable {
    private static let expression = try? NSRegularExpression(
        pattern: #"^/feedback(?:\s+([\s\S]*))?$"#,
        options: [.caseInsensitive]
    )

    let reason: String?

    static func parse(_ text: String) -> Self? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasPrefix("/feedback"),
              let expression,
              let match = expression.firstMatch(
                  in: trimmed,
                  range: NSRange(trimmed.startIndex..., in: trimmed)
              ) else {
            return nil
        }
        guard match.range(at: 1).location != NSNotFound,
              let reasonRange = Range(match.range(at: 1), in: trimmed) else {
            return Self(reason: nil)
        }
        let reason = trimmed[reasonRange].trimmingCharacters(in: .whitespacesAndNewlines)
        return Self(reason: reason.isEmpty ? nil : reason)
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

enum FeatureComposerFileLinkSerializer {
    static func markdownLink(for path: String) -> String {
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        let basename = normalized.split(separator: "/", omittingEmptySubsequences: true)
            .last
            .map(String.init) ?? path
        let label = basename
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
        return "[\(label)](\(encodeDestination(path)))"
    }

    private static func encodeDestination(_ path: String) -> String {
        let unescaped = Set(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789;,/:@&=+$-_.!~*'"
        )
        return path.utf8.map { byte -> String in
            guard byte < 128,
                  let scalar = UnicodeScalar(Int(byte)),
                  unescaped.contains(Character(String(scalar))) else {
                return String(format: "%%%02X", byte)
            }
            return String(scalar)
        }.joined()
    }
}

enum FeatureComposerMenuItem: Identifiable, Sendable, Equatable {
    case modelCommand
    case model(selection: FeatureSelection, label: String, description: String)
    case providerCommand(FeatureProviderSlashCommand)
    case skill(FeatureProviderSkillInvocation)
    case unavailableSkill(FeatureProviderSkill, label: String, message: String)
    case path(FeatureComposerPathEntry)

    var id: String {
        switch self {
        case .modelCommand: "command:model"
        case let .model(selection, _, _): "model:\(selection.providerID):\(selection.modelID)"
        case let .providerCommand(command): "command:\(command.id)"
        case let .skill(invocation): "skill:\(invocation.skill.id)"
        case let .unavailableSkill(skill, _, _): "unavailable-skill:\(skill.id)"
        case let .path(entry): "path:\(entry.path)"
        }
    }

    var label: String {
        switch self {
        case .modelCommand: "/model"
        case let .model(_, label, _): label
        case let .providerCommand(command): "/\(command.name)"
        case let .skill(invocation): invocation.token
        case let .unavailableSkill(_, label, _): label
        case let .path(entry): entry.name
        }
    }

    var description: String {
        switch self {
        case .modelCommand: "Switch model"
        case let .model(_, _, description): description
        case let .providerCommand(command):
            command.description ?? command.inputHint ?? ""
        case let .skill(invocation):
            invocation.skill.shortDescription
                ?? invocation.skill.description
                ?? invocation.skill.scope
                ?? ""
        case let .unavailableSkill(_, _, message): message
        case let .path(entry): entry.parentPath
        }
    }
}

extension FeatureComposerMenuItem {
    var isSelectable: Bool {
        if case .unavailableSkill = self { return false }
        return true
    }
}

enum FeatureProviderSkillInvocationSyntax: String, Sendable, Equatable {
    case slash = "/"
    case dollar = "$"
}

struct FeatureProviderSkillInvocation: Sendable, Equatable {
    let skill: FeatureProviderSkill
    let syntax: FeatureProviderSkillInvocationSyntax

    var token: String { "\(syntax.rawValue)\(skill.name)" }
    var replacement: String { "\(token) " }
}

enum FeatureProviderSkillInvocationResolution: Sendable, Equatable {
    case available(FeatureProviderSkillInvocation)
    case unavailable(label: String, message: String)
}

enum FeatureProviderSkillInvocationPolicy {
    private static let invocationExpression = try? NSRegularExpression(
        pattern: "(?<!\\S)([/\\$])([^\\s/\\$]+)(?=$|\\s)",
        options: [.caseInsensitive]
    )

    static func resolution(
        for skill: FeatureProviderSkill,
        trigger: FeatureComposerTrigger,
        provider: FeatureProvider?
    ) -> FeatureProviderSkillInvocationResolution {
        let typedSyntax: FeatureProviderSkillInvocationSyntax = trigger.kind == .slashCommand
            ? .slash
            : .dollar
        guard let provider else {
            return .available(FeatureProviderSkillInvocation(skill: skill, syntax: .dollar))
        }

        let brand = ProviderBrand.resolve(
            driver: provider.driver,
            providerID: provider.id,
            providerName: provider.name
        )
        if brand == .claude {
            switch trigger.kind {
            case .slashCommand where trigger.range.lowerBound == 0 && !skill.userInvocable:
                return .unavailable(
                    label: "\(typedSyntax.rawValue)\(skill.name)",
                    message: "This Claude skill only accepts $\(skill.name)."
                )
            case .slashCommand where trigger.range.lowerBound == 0:
                return .available(FeatureProviderSkillInvocation(skill: skill, syntax: .slash))
            case .slashCommand where skill.userInvocationOnly:
                return .unavailable(
                    label: "\(typedSyntax.rawValue)\(skill.name)",
                    message: "Start a new message with /\(skill.name), or delete this trigger."
                )
            case .slashCommand:
                return .unavailable(
                    label: "\(typedSyntax.rawValue)\(skill.name)",
                    message: "Start the message with /\(skill.name), or use $\(skill.name) here."
                )
            case .skill where skill.userInvocationOnly:
                return .unavailable(
                    label: "\(typedSyntax.rawValue)\(skill.name)",
                    message: "This Claude skill only accepts /\(skill.name) at the start of a message."
                )
            case .skill:
                return .available(FeatureProviderSkillInvocation(skill: skill, syntax: .dollar))
            case .model, .path:
                return .unavailable(label: skill.name, message: "Choose this skill from / or $.")
            }
        }

        return .available(FeatureProviderSkillInvocation(skill: skill, syntax: .dollar))
    }

    static func validationMessage(
        in text: String,
        providers: [FeatureProvider],
        selection: FeatureSelection?,
        threadSelection: FeatureSelection?
    ) -> String? {
        guard let selectedProviderID = (selection ?? threadSelection)?.providerID,
              let provider = providers.first(where: { $0.id == selectedProviderID }) else {
            return nil
        }

        let allSkillNames = Set(
            providers.flatMap { $0.skills ?? [] }.map { $0.name.lowercased() }
        )
        var providerSkills: [String: FeatureProviderSkill] = [:]
        for skill in provider.skills ?? [] {
            providerSkills[skill.name.lowercased()] = skill
        }
        let providerCommands = Set((provider.slashCommands ?? []).map { $0.name.lowercased() })
        let brand = ProviderBrand.resolve(
            driver: provider.driver,
            providerID: provider.id,
            providerName: provider.name
        )

        for invocation in detectedInvocations(in: text, skillNames: allSkillNames) {
            let normalizedName = invocation.name.lowercased()
            if invocation.syntax == .slash, providerCommands.contains(normalizedName) {
                continue
            }
            guard let skill = providerSkills[normalizedName] else {
                return "\(provider.name) does not offer \(invocation.token). Switch providers or delete that token."
            }
            switch (brand, invocation.syntax) {
            case (.claude, .slash) where invocation.location == 0 && !skill.userInvocable:
                return "This Claude skill only accepts $\(skill.name). Replace or delete /\(skill.name)."
            case (.claude, .slash) where invocation.location == 0:
                continue
            case (.claude, .slash):
                return "Move /\(skill.name) to the start of the message, use $\(skill.name), or delete it."
            case (.claude, .dollar) where skill.userInvocationOnly:
                return "This Claude skill only accepts /\(skill.name) at the start of a message."
            case (_, .slash):
                return "\(provider.name) invokes \(skill.name) as $\(skill.name). Replace or delete /\(skill.name)."
            default:
                continue
            }
        }
        return nil
    }

    private struct DetectedInvocation {
        let name: String
        let syntax: FeatureProviderSkillInvocationSyntax
        let location: Int

        var token: String { "\(syntax.rawValue)\(name)" }
    }

    private static func detectedInvocations(
        in text: String,
        skillNames: Set<String>
    ) -> [DetectedInvocation] {
        guard let invocationExpression else { return [] }
        let fullRange = NSRange(text.startIndex..., in: text)
        return invocationExpression.matches(in: text, range: fullRange).compactMap { match in
            guard let sigilRange = Range(match.range(at: 1), in: text),
                  let nameRange = Range(match.range(at: 2), in: text),
                  let matchRange = Range(match.range, in: text),
                  let syntax = FeatureProviderSkillInvocationSyntax(
                      rawValue: String(text[sigilRange])
                  ) else { return nil }
            let name = String(text[nameRange])
            guard skillNames.contains(name.lowercased()) else { return nil }
            return DetectedInvocation(
                name: name,
                syntax: syntax,
                location: text.distance(from: text.startIndex, to: matchRange.lowerBound)
            )
        }
    }
}

enum FeatureComposerMenuBuilder {
    static func items(
        trigger: FeatureComposerTrigger,
        providers: [FeatureProvider],
        currentSelection: FeatureSelection?,
        threadSelection: FeatureSelection?,
        powerFeatures: FeatureComposerPowerFeatures,
        pathEntries: [FeatureComposerPathEntry]
    ) -> [FeatureComposerMenuItem] {
        let selectedProviderID = (currentSelection ?? threadSelection)?.providerID
        let provider = providers.first { $0.id == selectedProviderID }
        switch trigger.kind {
        case .slashCommand:
            let query = trigger.query.lowercased()
            let normalizedSkillQuery = query.hasPrefix("skill:")
                ? String(query.dropFirst("skill:".count))
                : query
            var items: [FeatureComposerMenuItem] = []
            if query.isEmpty || "model".contains(query) {
                items.append(.modelCommand)
            }
            let skills = powerFeatures.skills
                .filter(\.isEnabled)
                .filter { skill in
                    guard !normalizedSkillQuery.isEmpty else { return true }
                    return [skill.name, skill.displayName, skill.shortDescription, skill.description]
                        .compactMap { $0 }
                        .contains { $0.localizedCaseInsensitiveContains(normalizedSkillQuery) }
                }
                .sorted {
                    ($0.displayName ?? $0.name).localizedStandardCompare($1.displayName ?? $1.name)
                        == .orderedAscending
                }
            let visibleSkillNames = Set(skills.map { $0.name.lowercased() })
            let commands = powerFeatures.slashCommands
                .filter { !["model", "plan", "default"].contains($0.name.lowercased()) }
                .filter { !visibleSkillNames.contains($0.name.lowercased()) }
                .filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            items.append(contentsOf: commands.map(FeatureComposerMenuItem.providerCommand))
            items.append(contentsOf: skills.map { menuItem(for: $0, trigger: trigger, provider: provider) })
            return Array(items.prefix(20))

        case .model:
            let query = trigger.query.trimmingCharacters(in: .whitespacesAndNewlines)
            let lockedProviderID = threadSelection.flatMap { selection in
                providers.first { $0.id == selection.providerID }?
                    .requiresNewThreadForModelChange == true
                    ? selection.providerID
                    : nil
            }
            return providers
                .filter(\.isAvailable)
                .filter { lockedProviderID == nil || $0.id == lockedProviderID }
                .flatMap { provider in
                    provider.models
                        .filter { model in
                            guard lockedProviderID != nil, let threadSelection else { return true }
                            return model.id == threadSelection.modelID
                        }
                        .map { model in
                            (
                                item: FeatureComposerMenuItem.model(
                                    selection: FeatureSelection(
                                        providerID: provider.id,
                                        modelID: model.id,
                                        options: currentSelection?.providerID == provider.id
                                            && currentSelection?.modelID == model.id
                                            ? currentSelection?.options ?? []
                                            : DailyUXModelOptions.defaults(for: model)
                                    ),
                                    label: model.name,
                                    description: provider.name
                                ),
                                searchText: "\(provider.name) \(model.name) \(model.id)"
                            )
                        }
                }
                .filter { query.isEmpty || $0.searchText.localizedCaseInsensitiveContains(query) }
                .prefix(20)
                .map(\.item)

        case .skill:
            let query = trigger.query.trimmingCharacters(in: .whitespacesAndNewlines)
            return powerFeatures.skills
                .filter(\.isEnabled)
                .filter { skill in
                    guard !query.isEmpty else { return true }
                    return [skill.name, skill.displayName, skill.shortDescription, skill.description]
                        .compactMap { $0 }
                        .contains { $0.localizedCaseInsensitiveContains(query) }
                }
                .sorted {
                    ($0.displayName ?? $0.name).localizedStandardCompare($1.displayName ?? $1.name)
                        == .orderedAscending
                }
                .prefix(20)
                .map { menuItem(for: $0, trigger: trigger, provider: provider) }

        case .path:
            return pathEntries
                .uniquedByPath()
                .prefix(20)
                .map(FeatureComposerMenuItem.path)
        }
    }

    private static func menuItem(
        for skill: FeatureProviderSkill,
        trigger: FeatureComposerTrigger,
        provider: FeatureProvider?
    ) -> FeatureComposerMenuItem {
        switch FeatureProviderSkillInvocationPolicy.resolution(
            for: skill,
            trigger: trigger,
            provider: provider
        ) {
        case let .available(invocation):
            return .skill(invocation)
        case let .unavailable(label, message):
            return .unavailableSkill(skill, label: label, message: message)
        }
    }
}

private extension Array where Element == FeatureComposerPathEntry {
    func uniquedByPath() -> [Element] {
        var seen = Set<String>()
        return filter { seen.insert($0.path).inserted }
    }
}
