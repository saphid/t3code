import Testing

@testable import T3Code

@Suite("Theme card accessibility")
struct ThemeCardAccessibilityTests {
    @Test(
        "Names the selected theme and appearance",
        .bug("https://github.com/saphid/t3code-personal/issues/51")
    )
    func namesThemeAndAppearance() {
        #expect(
            ThemeCardAccessibility.label(theme: "Tokyo Night", mode: "dark")
                == "Tokyo Night, dark"
        )
    }
}
