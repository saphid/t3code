import Foundation

struct T3TaskWidgetSnapshot: Codable, Hashable, Sendable {
    static let empty = T3TaskWidgetSnapshot(updatedAt: "", tasks: [])
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    var updatedAt: String
    var tasks: [T3RelayAgentActivityAggregateRow]

    init(updatedAt: String, tasks: [T3RelayAgentActivityAggregateRow]) {
        schemaVersion = Self.currentSchemaVersion
        self.updatedAt = updatedAt
        self.tasks = tasks
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard schemaVersion == Self.currentSchemaVersion else {
            throw T3TaskWidgetSnapshotDecodingError.incompatibleSchema
        }
        self.schemaVersion = schemaVersion
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        tasks = try container.decode([T3RelayAgentActivityAggregateRow].self, forKey: .tasks)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(tasks, forKey: .tasks)
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case updatedAt
        case tasks
    }
}

enum T3TaskWidgetRecoveryReason: Hashable, Sendable {
    case missing
    case unavailable
    case unreadable
    case corrupt
    case incompatible
}

enum T3TaskWidgetState: Hashable, Sendable {
    case tasks(T3TaskWidgetSnapshot)
    case empty(updatedAt: String)
    case recovery(T3TaskWidgetRecoveryReason)

    var snapshot: T3TaskWidgetSnapshot? {
        switch self {
        case let .tasks(snapshot): snapshot
        case let .empty(updatedAt): T3TaskWidgetSnapshot(updatedAt: updatedAt, tasks: [])
        case .recovery: nil
        }
    }

    func fallback(for family: T3TaskWidgetFamily) -> T3TaskWidgetFallback {
        let destination = URL(string: "\(T3SharedContainer.urlScheme)://new-task")!
        switch self {
        case .tasks:
            return T3TaskWidgetFallback(
                title: "Open T3 Code",
                detail: nil,
                systemImage: "arrow.up.forward.app",
                destination: destination
            )
        case .empty:
            return T3TaskWidgetFallback(
                title: family == .accessory ? "No recent tasks" : "Ready for a task",
                detail: family == .accessory ? nil : "Tap to start in T3 Code",
                systemImage: "square.and.pencil",
                destination: destination
            )
        case let .recovery(reason):
            let title = family == .accessory ? "Open T3 Code" : "Widget needs a refresh"
            let detail: String? = family == .accessory ? nil : reason.detail
            return T3TaskWidgetFallback(
                title: title,
                detail: detail,
                systemImage: "arrow.clockwise",
                destination: destination
            )
        }
    }
}

enum T3TaskWidgetFamily: String, CaseIterable, Hashable, Sendable {
    case small
    case medium
    case accessory
}

struct T3TaskWidgetFallback: Hashable, Sendable {
    var title: String
    var detail: String?
    var systemImage: String
    var destination: URL
}

private extension T3TaskWidgetRecoveryReason {
    var detail: String {
        switch self {
        case .missing:
            "Open T3 Code to create widget data"
        case .unavailable, .unreadable:
            "Open T3 Code to reconnect shared data"
        case .corrupt, .incompatible:
            "Open T3 Code to replace widget data"
        }
    }
}

private enum T3TaskWidgetSnapshotDecodingError: Error {
    case incompatibleSchema
}

/// The host writes one small snapshot after task-state changes; the widget only
/// performs a bounded file read when WidgetKit requests a timeline.
enum T3TaskWidgetSnapshotStore {
    static let fileName = "task-widget-snapshot.json"

    static func load() -> T3TaskWidgetState {
        load(from: fileURL())
    }

    static func load(from url: URL?) -> T3TaskWidgetState {
        guard let url else { return .recovery(.unavailable) }
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .recovery(.missing)
        }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            return .recovery(.unreadable)
        }
        do {
            let snapshot = try JSONDecoder().decode(T3TaskWidgetSnapshot.self, from: data)
            return snapshot.tasks.isEmpty
                ? .empty(updatedAt: snapshot.updatedAt)
                : .tasks(snapshot)
        } catch T3TaskWidgetSnapshotDecodingError.incompatibleSchema {
            return .recovery(.incompatible)
        } catch {
            return .recovery(.corrupt)
        }
    }

    static func save(_ snapshot: T3TaskWidgetSnapshot) throws {
        try save(snapshot, to: fileURL())
    }

    static func save(_ snapshot: T3TaskWidgetSnapshot, to url: URL?) throws {
        guard let url else {
            throw CocoaError(.fileNoSuchFile)
        }
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encoder.encode(snapshot).write(to: url, options: .atomic)
    }

    private static func fileURL() -> URL? {
        T3SharedContainer.rootURL?
            .appending(path: "Library/Application Support/T3Code", directoryHint: .isDirectory)
            .appending(path: fileName, directoryHint: .notDirectory)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()
}
