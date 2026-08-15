import CoreGraphics
import Foundation
import Testing
@testable import T3Code

@Suite("Command palette")
struct FeatureCommandPaletteTests {
    @Test
    func rootContainsElectronParityActionsAndRecentThreads() {
        let project = FeatureProject(
            id: "project-1",
            environmentID: "studio",
            name: "T3 Code",
            path: "/projects/t3-code"
        )
        let thread = FeatureThread(
            id: "thread-1",
            projectID: project.id,
            environmentID: project.environmentID,
            title: "Fix the command palette",
            updatedAt: Date(timeIntervalSince1970: 10)
        )
        let snapshot = FeatureSnapshot(
            environments: [
                .init(
                    id: project.environmentID,
                    name: "Studio",
                    endpoint: "https://studio.example",
                    isActive: true,
                    connectionState: .connected
                ),
            ],
            projects: [project],
            threads: [thread]
        )

        let groups = FeatureCommandPaletteCatalog.groups(
            snapshot: snapshot,
            projects: [project],
            activeProjectID: project.id,
            query: ""
        )

        #expect(groups.map(\.id) == ["actions", "recent-threads"])
        #expect(groups[0].items.map(\.title) == [
            "New task in T3 Code",
            "New task in…",
            "Add project",
            "Open settings",
        ])
        #expect(groups[1].items.map(\.title) == ["Fix the command palette"])
    }

    @Test
    func normalSearchAddsProjectAndThreadResultsWhileActionFilterHidesThem() {
        let project = FeatureProject(
            id: "project-1",
            environmentID: "studio",
            name: "T3 Code",
            path: "/projects/t3-code"
        )
        let thread = FeatureThread(
            id: "thread-1",
            projectID: project.id,
            environmentID: project.environmentID,
            title: "Release checklist",
            preview: "Check the repository status",
            updatedAt: Date(timeIntervalSince1970: 10)
        )
        let snapshot = FeatureSnapshot(projects: [project], threads: [thread])

        let searchGroups = FeatureCommandPaletteCatalog.groups(
            snapshot: snapshot,
            projects: [project],
            activeProjectID: nil,
            query: "t3"
        )
        #expect(searchGroups.map(\.id) == ["actions", "projects-search", "threads-search"])
        #expect(searchGroups[1].items.first?.action == .openProject(id: project.id))
        #expect(searchGroups[2].items.first?.action == .openThread(id: thread.id))

        let actionGroups = FeatureCommandPaletteCatalog.groups(
            snapshot: snapshot,
            projects: [project],
            activeProjectID: nil,
            query: "> repository"
        )
        #expect(actionGroups.map(\.id) == ["actions"])
        #expect(actionGroups[0].items.map(\.title) == ["Add project"])
    }

    @Test
    func recentThreadsAreNewestFirstCappedAndExcludeArchivedThreads() {
        let project = FeatureProject(
            id: "project-1",
            environmentID: "studio",
            name: "T3 Code",
            path: "/projects/t3-code"
        )
        let threads = (0..<14).map { index in
            FeatureThread(
                id: "thread-\(index)",
                projectID: project.id,
                title: "Thread \(index)",
                updatedAt: Date(timeIntervalSince1970: TimeInterval(index))
            )
        } + [
            FeatureThread(
                id: "archived",
                projectID: project.id,
                title: "Archived",
                updatedAt: Date(timeIntervalSince1970: 100),
                isArchived: true
            ),
        ]

        let groups = FeatureCommandPaletteCatalog.groups(
            snapshot: FeatureSnapshot(projects: [project], threads: threads),
            projects: [project],
            activeProjectID: nil,
            query: ""
        )
        let recent = groups.first { $0.id == "recent-threads" }?.items ?? []

        #expect(recent.count == FeatureCommandPaletteCatalog.recentThreadLimit)
        #expect(recent.first?.title == "Thread 13")
        #expect(recent.last?.title == "Thread 2")
        #expect(recent.contains { $0.title == "Archived" } == false)
    }

    @Test
    func projectPickerUsesProjectSearchAndNewTaskActions() {
        let projects = [
            FeatureProject(
                id: "z",
                environmentID: "studio",
                name: "Zebra",
                path: "/z"
            ),
            FeatureProject(
                id: "a",
                environmentID: "studio",
                name: "Alpha",
                path: "/alpha"
            ),
        ]

        let groups = FeatureCommandPaletteCatalog.newTaskProjectGroups(
            snapshot: FeatureSnapshot(projects: projects),
            projects: projects,
            query: ""
        )

        #expect(groups[0].items.map(\.title) == ["Alpha", "Zebra"])
        #expect(groups[0].items.map(\.action) == [
            .newTask(projectID: "a"),
            .newTask(projectID: "z"),
        ])
    }

    @Test
    func downwardDragTracksTheFingerAndRejectsSidewaysMotion() {
        #expect(
            FeatureCommandPaletteGesture.dragDistance(
                translation: CGSize(width: 8, height: 54)
            ) == 54
        )
        #expect(
            FeatureCommandPaletteGesture.dragDistance(
                translation: CGSize(width: 80, height: 20)
            ) == 0
        )
        #expect(
            FeatureCommandPaletteGesture.dragDistance(
                translation: CGSize(width: 0, height: -30)
            ) == 0
        )
    }

    @Test
    func dragSettlesOpenAfterDistanceOrDeliberateFlick() {
        #expect(
            FeatureCommandPaletteGesture.shouldPresent(
                translation: CGSize(width: 2, height: 96),
                velocity: CGPoint(x: 0, y: 200)
            )
        )
        #expect(
            FeatureCommandPaletteGesture.shouldPresent(
                translation: CGSize(width: 2, height: 30),
                velocity: CGPoint(x: 20, y: 1_000)
            )
        )
        #expect(
            FeatureCommandPaletteGesture.shouldPresent(
                translation: CGSize(width: 2, height: 23),
                velocity: CGPoint(x: 0, y: 1_200)
            ) == false
        )
        #expect(
            FeatureCommandPaletteGesture.shouldPresent(
                translation: CGSize(width: 90, height: 96),
                velocity: CGPoint(x: 1_000, y: 100)
            ) == false
        )
    }

    @Test
    func panReceivesTouchesOnlyFromTheTopBarWithoutAnotherPresentation() {
        let header = CGRect(x: 0, y: 59, width: 393, height: 49)

        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 180, y: 80),
            surfaceFrame: header,
            hasPresentedViewController: false
        ))
        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 180, y: 20),
            surfaceFrame: header,
            hasPresentedViewController: false
        ))
        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 180, y: 180),
            surfaceFrame: header,
            hasPresentedViewController: false
        ) == false)
        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 180, y: 80),
            surfaceFrame: header,
            hasPresentedViewController: true
        ) == false)
    }

    @Test
    func compactThreadTitleExpandsItsGestureSurfaceAcrossTheTopBar() {
        let title = CGRect(x: 92, y: 58, width: 210, height: 46)
        let compactTopBar = FeatureCommandPaletteGesture.captureSurfaceFrame(
            surfaceFrame: title,
            hostWidth: 393,
            capturesFullWidth: true
        )

        #expect(compactTopBar == CGRect(x: 0, y: 58, width: 393, height: 46))
        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 24, y: 82),
            surfaceFrame: compactTopBar,
            hasPresentedViewController: false
        ))
        #expect(FeatureCommandPaletteGesture.shouldReceive(
            point: CGPoint(x: 24, y: 180),
            surfaceFrame: compactTopBar,
            hasPresentedViewController: false
        ) == false)
        #expect(FeatureCommandPaletteGesture.captureSurfaceFrame(
            surfaceFrame: title,
            hostWidth: 393,
            capturesFullWidth: false
        ) == title)
    }

    @Test
    func paletteAndWorkspaceRemainAttachedAcrossTheDrag() {
        let panelHeight = FeatureCommandPaletteGesture.panelHeight(
            availableHeight: 741,
            topInset: 59
        )
        #expect(panelHeight == 800)
        #expect(FeatureCommandPaletteGesture.travel(
            isPresented: false,
            dragDistance: 132,
            panelHeight: panelHeight
        ) == 132)
        #expect(FeatureCommandPaletteGesture.travel(
            isPresented: true,
            dragDistance: 0,
            panelHeight: panelHeight
        ) == panelHeight)
        #expect(FeatureCommandPaletteGesture.revealProgress(
            travel: 200,
            panelHeight: panelHeight
        ) == 0.25)
    }
}
