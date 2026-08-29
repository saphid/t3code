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

    public init(
        name: String,
        displayName: String? = nil,
        description: String? = nil,
        shortDescription: String? = nil,
        path: String = "",
        scope: String? = nil,
        isEnabled: Bool = true
    ) {
        self.name = name
        self.displayName = displayName
        self.description = description
        self.shortDescription = shortDescription
        self.path = path
        self.scope = scope
        self.isEnabled = isEnabled
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
    case skill(FeatureProviderSkill)
    case path(FeatureComposerPathEntry)

    var id: String {
        switch self {
        case .modelCommand: "command:model"
        case let .model(selection, _, _): "model:\(selection.providerID):\(selection.modelID)"
        case let .providerCommand(command): "command:\(command.id)"
        case let .skill(skill): "skill:\(skill.id)"
        case let .path(entry): "path:\(entry.path)"
        }
    }

    var label: String {
        switch self {
        case .modelCommand: "/model"
        case let .model(_, label, _): label
        case let .providerCommand(command): "/\(command.name)"
        case let .skill(skill): skill.displayName ?? skill.name
        case let .path(entry): entry.name
        }
    }

    var description: String {
        switch self {
        case .modelCommand: "Switch model"
        case let .model(_, _, description): description
        case let .providerCommand(command):
            command.description ?? command.inputHint ?? ""
        case let .skill(skill):
            skill.shortDescription ?? skill.description ?? skill.scope ?? ""
        case let .path(entry): entry.parentPath
        }
    }

    var composerReplacement: String {
        switch self {
        case .modelCommand: "/model "
        case .model: ""
        case let .providerCommand(command): "/\(command.name) "
        case let .skill(skill): "$\(skill.name) "
        case let .path(entry): FeatureComposerFileLinkSerializer.markdownLink(for: entry.path) + " "
        }
    }

    var modelSelection: FeatureSelection? {
        guard case let .model(selection, _, _) = self else { return nil }
        return selection
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
            items.append(contentsOf: skills.map(FeatureComposerMenuItem.skill))
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
                .map(FeatureComposerMenuItem.skill)

        case .path:
            return pathEntries
                .uniquedByPath()
                .prefix(20)
                .map(FeatureComposerMenuItem.path)
        }
    }
}

private extension Array where Element == FeatureComposerPathEntry {
    func uniquedByPath() -> [Element] {
        var seen = Set<String>()
        return filter { seen.insert($0.path).inserted }
    }
}
