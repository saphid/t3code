import Foundation

enum ArchivedThreadSortOrder: String, CaseIterable, Identifiable {
    case newest
    case oldest

    var id: Self { self }

    var label: String {
        switch self {
        case .newest: "Newest first"
        case .oldest: "Oldest first"
        }
    }
}

enum ArchivedThreadPreferences {
    static let searchQueryKey = "t3.swiftui.archive.searchQuery"
    static let sortOrderKey = "t3.swiftui.archive.sortOrder"

    static func sortOrder(from rawValue: String?) -> ArchivedThreadSortOrder {
        rawValue.flatMap(ArchivedThreadSortOrder.init(rawValue:)) ?? .newest
    }
}

struct ArchivedThreadGroup: Identifiable, Equatable {
    let project: FeatureProject
    let threads: [FeatureThread]

    var id: String { project.id }
}

struct ArchivedThreadList {
    let groups: [ArchivedThreadGroup]
    let totalArchivedCount: Int

    init(
        snapshot: FeatureSnapshot,
        query: String,
        sortOrder: ArchivedThreadSortOrder
    ) {
        let archived = snapshot.threads.filter(\.isArchived)
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matching = normalizedQuery.isEmpty
            ? archived
            : archived.filter { $0.title.localizedStandardContains(normalizedQuery) }
        let threadsByProjectID = Dictionary(grouping: matching, by: \.projectID)

        totalArchivedCount = archived.count
        groups = snapshot.projects.compactMap { project in
            guard let threads = threadsByProjectID[project.id], !threads.isEmpty else {
                return nil
            }
            return ArchivedThreadGroup(
                project: project,
                threads: threads.sorted { lhs, rhs in
                    Self.precedes(lhs, rhs, order: sortOrder)
                }
            )
        }.sorted { lhs, rhs in
            guard let lhsThread = lhs.threads.first,
                  let rhsThread = rhs.threads.first else {
                return lhs.id < rhs.id
            }
            let lhsDate = Self.archiveDate(lhsThread)
            let rhsDate = Self.archiveDate(rhsThread)
            if lhsDate != rhsDate {
                return sortOrder == .newest ? lhsDate > rhsDate : lhsDate < rhsDate
            }
            let nameOrder = lhs.project.name.localizedStandardCompare(rhs.project.name)
            if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
            return lhs.id < rhs.id
        }
    }

    static func archiveDate(_ thread: FeatureThread) -> Date {
        thread.archivedAt ?? thread.updatedAt
    }

    private static func precedes(
        _ lhs: FeatureThread,
        _ rhs: FeatureThread,
        order: ArchivedThreadSortOrder
    ) -> Bool {
        let lhsDate = archiveDate(lhs)
        let rhsDate = archiveDate(rhs)
        if lhsDate != rhsDate {
            return order == .newest ? lhsDate > rhsDate : lhsDate < rhsDate
        }
        let titleOrder = lhs.title.localizedStandardCompare(rhs.title)
        if titleOrder != .orderedSame { return titleOrder == .orderedAscending }
        return lhs.id < rhs.id
    }
}
