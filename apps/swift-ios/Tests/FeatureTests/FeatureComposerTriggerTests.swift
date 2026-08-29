import Testing
@testable import T3Code

@Suite("Composer trigger activation")
struct FeatureComposerTriggerTests {
    @Test(
        "Paste never activates at-sign source as a completion",
        .bug("https://github.com/saphid/t3code-personal/issues/218"),
        arguments: [
            "@foo(bar)",
            "@MainActor\nfunc load() {}",
            "@sealed\nclass Example {}",
            "@decorator(name=\"café\")\ndef run(): pass",
            "alex@example.com",
            "echo \"$PATH\" && printf '@foo(bar)\\n'",
            "@注釈(値: \"🧪\")\n次の行",
        ]
    )
    func pasteNeverActivatesCompletion(text: String) {
        let edit = FeatureComposerTextEdit(
            text: text,
            selectedUTF16Location: text.utf16.count,
            origin: .paste
        )

        #expect(FeatureComposerTriggerContext.activated(by: edit) == nil)
    }

    @Test("Interactive at-sign input activates the existing path completion")
    func interactiveAtSignInputActivatesCompletion() {
        let text = "🧪 @Sources/App trailing"
        let cursorLocation = "🧪 @Sources/App".utf16.count
        let edit = FeatureComposerTextEdit(
            text: text,
            selectedUTF16Location: cursorLocation,
            origin: .interactive
        )

        #expect(
            FeatureComposerTriggerContext.activated(by: edit)?.trigger
                == FeatureComposerTrigger(kind: .path, query: "Sources/App", range: 2..<14)
        )
    }

    @Test("Explicit replacement preserves Unicode text outside the trigger")
    func explicitReplacementPreservesUnicodeTextOutsideTrigger() {
        let text = "🧪 Review @Sources/App\n次"

        #expect(
            FeatureComposerTriggerParser.replacing(
                9..<21,
                in: text,
                with: "[App](Sources/App) "
            ) == "🧪 Review [App](Sources/App) \n次"
        )
    }
}
