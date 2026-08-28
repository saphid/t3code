struct HomeProjectThreadGroup: Equatable, Identifiable {
    let id: String
    let title: String
    let pinned: [FeatureThread]
    let active: [FeatureThread]

    var threads: [FeatureThread] { pinned + active }

    static func make(
        pinned: [FeatureThread],
        active: [FeatureThread],
        logicalGroups: [DailyUXProjectGroup],
        rowContexts: [String: HomeThreadRowContext]
    ) -> [Self] {
        let logicalGroupByProjectID = logicalGroups.reduce(
            into: [String: DailyUXProjectGroup]()
        ) { result, group in
            for projectID in group.memberProjectIDs {
                result[projectID] = group
            }
        }
        let allThreads = pinned + active
        var orderedGroupIDs: [String] = []
        var seenGroupIDs = Set<String>()
        var titleByGroupID: [String: String] = [:]
        var groupIDByThreadID: [String: String] = [:]
        var pinnedByGroupID: [String: [FeatureThread]] = [:]
        var activeByGroupID: [String: [FeatureThread]] = [:]

        for thread in allThreads {
            let logicalGroup = logicalGroupByProjectID[thread.projectID]
            let groupID = logicalGroup?.id ?? "project:\(thread.projectID)"
            groupIDByThreadID[thread.id] = groupID
            titleByGroupID[groupID] = logicalGroup?.name
                ?? rowContexts[thread.id]?.projectName
                ?? "Project"
            if seenGroupIDs.insert(groupID).inserted {
                orderedGroupIDs.append(groupID)
            }
        }
        for thread in pinned {
            guard let groupID = groupIDByThreadID[thread.id] else { continue }
            pinnedByGroupID[groupID, default: []].append(thread)
        }
        for thread in active {
            guard let groupID = groupIDByThreadID[thread.id] else { continue }
            activeByGroupID[groupID, default: []].append(thread)
        }

        return orderedGroupIDs.map { groupID in
            Self(
                id: groupID,
                title: titleByGroupID[groupID] ?? "Project",
                pinned: pinnedByGroupID[groupID] ?? [],
                active: activeByGroupID[groupID] ?? []
            )
        }
    }
}
