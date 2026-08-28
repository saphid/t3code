import Foundation
import Testing
@testable import T3Code

@Suite("Home project group collapse")
struct HomeProjectGroupCollapseTests {
    @Test(.bug("https://github.com/saphid/t3code-personal/issues/148"))
    @MainActor
    func collapseHidesOnlyTheSelectedGroupWithoutChangingThreads() throws {
        let alpha = FeatureProject(
            id: "alpha",
            environmentID: "environment",
            name: "Alpha",
            path: "/work/alpha"
        )
        let beta = FeatureProject(
            id: "beta",
            environmentID: "environment",
            name: "Beta",
            path: "/work/beta"
        )
        let older = Date(timeIntervalSince1970: 50)
        let newer = Date(timeIntervalSince1970: 60)
        var pinned = FeatureThread(
            id: "alpha-pinned",
            projectID: alpha.id,
            title: "Pinned",
            createdAt: older,
            updatedAt: older
        )
        pinned.pinnedAt = Date(timeIntervalSince1970: 100)
        let alphaActive = FeatureThread(
            id: "alpha-active",
            projectID: alpha.id,
            title: "Alpha active",
            createdAt: newer,
            updatedAt: newer
        )
        let betaActive = FeatureThread(
            id: "beta-active",
            projectID: beta.id,
            title: "Beta active",
            createdAt: older,
            updatedAt: older
        )
        let presentation = HomePresentation(
            snapshot: FeatureSnapshot(
                projects: [alpha, beta],
                threads: [alphaActive, betaActive, pinned]
            ),
            query: "",
            projectID: nil,
            now: Date(timeIntervalSince1970: 200)
        )
        let alphaGroup = try #require(
            presentation.projectGroups.first { $0.title == "Alpha" }
        )

        let visibleThreadIDs = HomeThreadCollectionView.projectGroupItems(
            presentation: presentation,
            collapsedProjectGroupIDs: [alphaGroup.id],
            forceRichRows: false
        )
        .compactMap(\.id.threadID)

        #expect(visibleThreadIDs == [betaActive.id])
        #expect(presentation.pinned == [pinned])
        #expect(presentation.active == [alphaActive, betaActive])
        #expect(pinned.pinnedAt == Date(timeIntervalSince1970: 100))
        #expect(alphaActive.isSettled == false)
        #expect(betaActive.isArchived == false)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/148"))
    func collapsedChoicesPersistAndMissingGroupsArePruned() {
        let suiteName = "home-project-group-collapse-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = HomeProjectGroupCollapseStore(defaults: defaults)

        store.save(["alpha", "removed"])
        #expect(HomeProjectGroupCollapseStore(defaults: defaults).load() == ["alpha", "removed"])

        let reconciled = store.reconcile(
            validGroupIDs: ["alpha", "beta"],
            catalogIsComplete: true
        )

        #expect(reconciled == ["alpha"])
        #expect(HomeProjectGroupCollapseStore(defaults: defaults).load() == ["alpha"])
        #expect(store.toggle("alpha").isEmpty)
        #expect(HomeProjectGroupCollapseStore(defaults: defaults).load().isEmpty)
    }

    @Test(.bug("https://github.com/saphid/t3code-personal/issues/148"))
    func unavailableCatalogDoesNotErasePersistedChoices() {
        let suiteName = "home-project-group-unavailable-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = HomeProjectGroupCollapseStore(defaults: defaults)
        store.save(["alpha"])

        let presentation = HomePresentation(
            snapshot: FeatureSnapshot(
                environments: [
                    FeatureEnvironment(
                        id: "environment",
                        name: "Offline",
                        endpoint: "ws://offline",
                        connectionState: .disconnected
                    ),
                ]
            ),
            query: "",
            projectID: nil,
            now: Date(timeIntervalSince1970: 200)
        )

        let reconciled = store.reconcile(
            validGroupIDs: presentation.validProjectGroupIDs,
            catalogIsComplete: presentation.isProjectCatalogComplete
        )

        #expect(reconciled == ["alpha"])
        #expect(HomeProjectGroupCollapseStore(defaults: defaults).load() == ["alpha"])
    }
}
