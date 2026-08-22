import Testing
@testable import T3Code

@Suite("Voice dictation vocabulary")
struct FeatureVoiceVocabularyTests {
    @Test("Identifier-shaped tokens qualify on first sight")
    func identifiersQualifyImmediately() {
        let terms = FeatureVoiceVocabulary.extract(from: [
            .init(text: "Wire useVoiceTranscription into ChatComposer and check gpt-5.6 output")
        ])

        #expect(terms.contains("useVoiceTranscription"))
        #expect(terms.contains("ChatComposer"))
        #expect(terms.contains("gpt-5.6"))
    }

    @Test("Repeated unusual plain words survive, ordinary prose does not")
    func plainWordFiltering() {
        let terms = FeatureVoiceVocabulary.extract(from: [
            .init(text: "create the worktree first, then prune the worktree after review"),
            .init(text: "people should always check the answer before they follow along"),
        ])

        #expect(terms.contains("worktree"))
        #expect(!terms.contains("people"))
        #expect(!terms.contains("answer"))
    }

    @Test("Single-occurrence plain words are dropped")
    func singlePlainWordDropped() {
        let terms = FeatureVoiceVocabulary.extract(from: [.init(text: "the zustand store")])

        #expect(!terms.contains("zustand"))
    }

    @Test("Path-like tokens contribute their basename")
    func pathBasenames() {
        let terms = FeatureVoiceVocabulary.extract(from: [
            .init(text: "edit apps/web/src/components/chat/ChatComposer.tsx today")
        ])

        #expect(terms.contains("ChatComposer.tsx"))
    }

    @Test("Hashes, uuids, and generic tech terms are filtered")
    func noiseFiltering() {
        let terms = FeatureVoiceVocabulary.extract(from: [
            .init(text: "commit 23b550221 in 63052183-77da-4946-8df8-79daa38d20f8 broke the function export"),
            .init(text: "commit 23b550221 in 63052183-77da-4946-8df8-79daa38d20f8 broke the function export"),
        ])

        #expect(!terms.contains("23b550221"))
        #expect(!terms.contains("function"))
        #expect(!terms.contains("export"))
    }

    @Test("Merge preserves priority order, dedupes case-insensitively, and caps")
    func mergeBehavior() {
        let merged = FeatureVoiceVocabulary.merge([
            ["Worktree", "pnpm"],
            ["worktree", "Fable", "pnpm"],
        ])

        #expect(merged == ["Worktree", "pnpm", "Fable"])

        let capped = FeatureVoiceVocabulary.merge([["a1", "a2", "a3"], ["b1", "b2"]], limit: 4)
        #expect(capped == ["a1", "a2", "a3", "b1"])
    }

    @Test("Corrections rewrite split compounds back to the term")
    func correctionSplitCompound() {
        let corrected = FeatureVoiceVocabulary.applyCorrections(
            to: "Add the word tree to the workspace",
            vocabulary: ["worktree"]
        )

        #expect(corrected == "Add the worktree to the workspace")
    }

    @Test("Corrections repair truncated short terms")
    func correctionShortTerm() {
        let corrected = FeatureVoiceVocabulary.applyCorrections(
            to: "run PNP install",
            vocabulary: ["pnpm"]
        )

        #expect(corrected == "run pnpm install")
    }

    @Test("Corrections adopt vocabulary casing on exact matches")
    func correctionCasing() {
        let corrected = FeatureVoiceVocabulary.applyCorrections(
            to: "ask fable about the chat composer",
            vocabulary: ["Fable", "ChatComposer"]
        )

        #expect(corrected == "ask Fable about the ChatComposer")
    }

    @Test("Corrections leave unrelated words alone")
    func correctionNoFalsePositives() {
        let text = "the table is stable and the bass is loud"
        #expect(FeatureVoiceVocabulary.applyCorrections(to: text, vocabulary: ["Fable", "rebase"]) == text)

        let firstLetterGate = "take a walk tree"
        #expect(
            FeatureVoiceVocabulary.applyCorrections(to: firstLetterGate, vocabulary: ["worktree"])
                == firstLetterGate
        )
    }
}
