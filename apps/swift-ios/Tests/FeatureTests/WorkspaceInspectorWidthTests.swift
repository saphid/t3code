import Foundation
import Testing
@testable import T3Code

@Suite("Workspace inspector sizing")
struct WorkspaceInspectorWidthTests {
    @Test(arguments: [280.0, 340.0, 400.0, 440.0])
    func readableSavedWidthsArePreserved(_ width: Double) {
        #expect(WorkspaceInspectorWidth.clamped(width) == width)
    }

    @Test
    func draggingBeyondTheWindowCannotCollapseOrCoverTheWorkspace() {
        #expect(WorkspaceInspectorWidth.clamped(-200) == 280)
        #expect(WorkspaceInspectorWidth.clamped(2_000) == 440)
    }

    @Test(arguments: [Double.nan, Double.infinity, -Double.infinity])
    func invalidSavedValuesRestoreTheDefault(_ width: Double) {
        #expect(WorkspaceInspectorWidth.clamped(width) == WorkspaceInspectorWidth.standard)
    }
}

@Suite("Workspace appearance defaults")
struct WorkspaceAppearanceDefaultTests {
    @Test
    func newAndMissingPreferencesStartDark() throws {
        #expect(FeatureSettings().appearance == .dark)
        #expect(try JSONDecoder().decode(FeatureSettings.self, from: Data("{}".utf8)).appearance == .dark)
    }

    @Test(arguments: [FeatureAppearance.system, .light, .dark])
    func savedAppearanceStillWins(_ appearance: FeatureAppearance) throws {
        let data = try JSONEncoder().encode(FeatureSettings(appearance: appearance))
        #expect(try JSONDecoder().decode(FeatureSettings.self, from: data).appearance == appearance)
    }
}
