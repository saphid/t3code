import Foundation

enum HomeSortOrder: String, CaseIterable, Identifiable {
    case `default`
    case lastUserMessage
    case createdAt

    var id: Self { self }

    var label: String {
        switch self {
        case .default: "Default"
        case .lastUserMessage: "Last user message"
        case .createdAt: "Created at"
        }
    }
}

enum HomeSortPreferences {
    static let projectKey = "t3.swiftui.home.projectSortOrder"
    static let threadKey = "t3.swiftui.home.threadSortOrder"

    static func order(from rawValue: String?) -> HomeSortOrder {
        rawValue.flatMap(HomeSortOrder.init(rawValue:)) ?? .default
    }
}

struct HomeOrdering {
    let projects: [FeatureProject]

    private let projectOrder: HomeSortOrder
    private let threadOrder: HomeSortOrder
    private let projectRanks: [String: Int]

    init(
        snapshot: FeatureSnapshot,
        projectOrder: HomeSortOrder,
        threadOrder: HomeSortOrder
    ) {
        self.projectOrder = projectOrder
        self.threadOrder = threadOrder
        projects = Self.projects(in: snapshot, order: projectOrder)
        projectRanks = projectOrder == .default
            ? [:]
            : Dictionary(
                uniqueKeysWithValues: projects.enumerated().map { ($0.element.id, $0.offset) }
            )
    }

    static func projects(
        in snapshot: FeatureSnapshot,
        order: HomeSortOrder
    ) -> [FeatureProject] {
        guard order != .default else { return snapshot.projects }
        let timestamps = projectTimestamps(in: snapshot, order: order)

        return snapshot.projects.sorted { lhs, rhs in
            let lhsTimestamp = timestamps[lhs.id] ?? .distantPast
            let rhsTimestamp = timestamps[rhs.id] ?? .distantPast
            if lhsTimestamp != rhsTimestamp { return lhsTimestamp > rhsTimestamp }
            let nameOrder = lhs.name.localizedStandardCompare(rhs.name)
            if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
            return lhs.id < rhs.id
        }
    }

    static func threads(
        _ canonical: [FeatureThread],
        snapshot: FeatureSnapshot,
        projectOrder: HomeSortOrder,
        threadOrder: HomeSortOrder
    ) -> [FeatureThread] {
        HomeOrdering(
            snapshot: snapshot,
            projectOrder: projectOrder,
            threadOrder: threadOrder
        ).threads(canonical)
    }

    func threads(_ canonical: [FeatureThread]) -> [FeatureThread] {
        guard projectOrder != .default || threadOrder != .default else {
            return canonical
        }

        return canonical.enumerated().sorted { lhs, rhs in
            if projectOrder != .default {
                let lhsRank = projectRanks[lhs.element.projectID] ?? Int.max
                let rhsRank = projectRanks[rhs.element.projectID] ?? Int.max
                if lhsRank != rhsRank { return lhsRank < rhsRank }
            }

            if threadOrder != .default {
                let lhsTimestamp = Self.timestamp(for: lhs.element, order: threadOrder)
                let rhsTimestamp = Self.timestamp(for: rhs.element, order: threadOrder)
                if lhsTimestamp != rhsTimestamp { return lhsTimestamp > rhsTimestamp }
                if lhs.element.id != rhs.element.id { return lhs.element.id > rhs.element.id }
            }

            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    private static func projectTimestamps(
        in snapshot: FeatureSnapshot,
        order: HomeSortOrder
    ) -> [String: Date] {
        var timestamps: [String: Date] = [:]

        for thread in snapshot.threads where !thread.isArchived {
            let threadTimestamp = timestamp(for: thread, order: order)
            timestamps[thread.projectID] = max(
                timestamps[thread.projectID] ?? .distantPast,
                threadTimestamp
            )
        }

        for project in snapshot.projects where timestamps[project.id] == nil {
            let candidates = order == .createdAt
                ? [project.createdAt, project.updatedAt]
                : [project.updatedAt, project.createdAt]
            timestamps[project.id] = candidates
                .compactMap { $0.flatMap(parseDate) }
                .first ?? .distantPast
        }

        return timestamps
    }

    private static func timestamp(
        for thread: FeatureThread,
        order: HomeSortOrder
    ) -> Date {
        switch order {
        case .default:
            return .distantPast
        case .lastUserMessage:
            return thread.latestUserMessageAt ?? thread.updatedAt
        case .createdAt:
            return thread.createdAt
        }
    }

    private static func parseDate(_ value: String) -> Date? {
        (try? Date(value, strategy: .iso8601))
            ?? (try? Date(
                value,
                strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            ))
    }
}
