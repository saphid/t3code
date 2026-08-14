import Foundation
import Testing

@testable import T3Code

@Suite("Theme card accessibility")
struct ThemeCardAccessibilityTests {
    @Test("Names the selected theme and appearance", .bug("https://github.com/saphid/t3code-personal/issues/51"))
    func namesThemeAndAppearance() throws {
        #expect(
            ThemeCardAccessibility.label(theme: "Tokyo Night", mode: "dark")
                == "Tokyo Night, dark"
        )
        let testFile = URL(fileURLWithPath: #filePath)
        let sourceFile = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Features/Settings/ThemeSettingsView.swift")
        let source = try String(contentsOf: sourceFile, encoding: .utf8)
        #expect(
            source.contains(
                #".accessibilityLabel(ThemeCardAccessibility.label(theme: theme.label, mode: mode.rawValue))"#
            )
        )
        #expect(!source.contains(#".accessibilityLabel("(theme.label), (mode.rawValue)")"#))
    }
}
