import Foundation
import Testing

@testable import T3Code

@MainActor
struct ThemeRuntimeTests {
    @Test func installedThemesPersistAndRemainSelectableOffline() throws {
        let suite = "ThemeRuntimeTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(suite).json")
        defer { try? FileManager.default.removeItem(at: url) }

        let builtIn = artifact(id: "t3-code", label: "T3 Code")
        let imported = artifact(id: "night-owl", label: "Night Owl")
        let runtime = T3ThemeRuntime(
            artifact: builtIn,
            defaults: defaults,
            installedThemesURL: url
        )

        try runtime.install(imported)
        runtime.selectBoth(themeID: "night-owl")

        let reloaded = T3ThemeRuntime(
            artifact: builtIn,
            defaults: defaults,
            installedThemesURL: url
        )
        #expect(reloaded.isInstalled(themeID: "night-owl"))
        #expect(reloaded.selection.lightThemeId == "night-owl")
        #expect(reloaded.selection.darkThemeId == "night-owl")
    }

    @Test func builtInIdentifiersCannotBeOverwritten() throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let runtime = T3ThemeRuntime(
            artifact: artifact(id: "t3-code", label: "T3 Code"),
            defaults: defaults,
            installedThemesURL: nil
        )

        #expect(throws: (any Error).self) {
            try runtime.install(artifact(id: "t3-code", label: "Replacement"))
        }
    }

    private func artifact(id: String, label: String) -> T3ResolvedThemeArtifact {
        let value = T3ThemeColorValue(
            css: "#112233",
            colorSpace: "srgb",
            red: 0.067,
            green: 0.133,
            blue: 0.2,
            alpha: 1
        )
        return T3ResolvedThemeArtifact(
            artifactVersion: 1,
            engineVersion: "test",
            roleManifest: ["canvas"],
            roleSchema: "test-schema",
            themes: [
                T3ResolvedThemeDefinition(
                    id: id,
                    label: label,
                    modes: [
                        T3ResolvedThemePalette(
                            appearance: "light",
                            colors: ["canvas": value]
                        ),
                        T3ResolvedThemePalette(
                            appearance: "dark",
                            colors: ["canvas": value]
                        ),
                    ]
                )
            ]
        )
    }
}
