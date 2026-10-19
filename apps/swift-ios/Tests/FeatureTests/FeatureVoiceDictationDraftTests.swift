import Testing
@testable import T3Code

@Suite("Voice dictation draft")
struct FeatureVoiceDictationDraftTests {
    @Test("Typing before the first hypothesis is retained")
    func editBeforeFirstHypothesis() {
        var draft = FeatureVoiceDictationDraft(text: "hello")
        #expect(
            draft.renderVolatile("dictated", currentText: "hello typed")
                == "hello typed dictated"
        )
    }

    @Test("Typing before the first final segment is retained")
    func editBeforeFirstFinalSegment() {
        var draft = FeatureVoiceDictationDraft(text: "hello")
        #expect(
            draft.commitSegment("dictated", currentText: "hello typed")
                == "hello typed dictated"
        )
    }

    @Test("Hypotheses refine in place and the final segment replaces them")
    func finalReplacesHypothesis() {
        var draft = FeatureVoiceDictationDraft(text: "hello")
        let first = draft.renderVolatile("interim", currentText: "hello")
        let second = draft.renderVolatile("refined", currentText: first)
        #expect(second == "hello refined")
        let final = draft.commitSegment("final", currentText: second)
        #expect(final == "hello final")
        #expect(draft.commitSegment("next", currentText: final) == "hello final next")
    }

    @Test("Clearing the draft before recognition does not restore old text")
    func clearBeforeFirstHypothesis() {
        var draft = FeatureVoiceDictationDraft(text: "discard this")
        #expect(draft.renderVolatile("new", currentText: "") == "new")
    }
}
