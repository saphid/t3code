import Foundation

struct FeatureComposerPromptHistory: Equatable {
    struct Prompt: Equatable {
        let id: String
        let text: String
        let isUser: Bool
        let isQueued: Bool
    }

    enum Direction: Equatable {
        case older
        case newer
    }

    private var threadID: String?
    private var prompts: [Prompt] = []
    private var promptID: String?
    private var draftBeforeRecall = ""
    private var presentedPrompt: String?

    var isRecalling: Bool { promptID != nil }

    mutating func synchronize(threadID: String, prompts incoming: [Prompt]) {
        if self.threadID != threadID {
            self.threadID = threadID
            endRecall()
        }

        var seenIDs: Set<String> = []
        prompts = incoming.filter { prompt in
            guard prompt.isUser,
                  !prompt.isQueued,
                  !prompt.text.isEmpty,
                  seenIDs.insert(prompt.id).inserted else { return false }
            return true
        }

        if let promptID, !prompts.contains(where: { $0.id == promptID }) {
            endRecall()
        }
    }

    mutating func navigate(_ direction: Direction, currentDraft: String) -> String? {
        if let presentedPrompt, presentedPrompt != currentDraft {
            endRecall()
        }

        switch direction {
        case .older:
            guard isRecalling || currentDraft.isEmpty, !prompts.isEmpty else { return nil }
            let position: Int
            if let promptID,
               let currentPosition = prompts.firstIndex(where: { $0.id == promptID }) {
                position = max(currentPosition - 1, prompts.startIndex)
            } else {
                draftBeforeRecall = currentDraft
                position = prompts.index(before: prompts.endIndex)
            }
            let prompt = prompts[position]
            promptID = prompt.id
            presentedPrompt = prompt.text
            return prompt.text

        case .newer:
            guard let promptID,
                  let position = prompts.firstIndex(where: { $0.id == promptID }) else {
                return nil
            }
            let next = prompts.index(after: position)
            guard next < prompts.endIndex else {
                let draft = draftBeforeRecall
                endRecall()
                return draft
            }
            let prompt = prompts[next]
            self.promptID = prompt.id
            presentedPrompt = prompt.text
            return prompt.text
        }
    }

    mutating func draftDidChange(_ draft: String) {
        guard let presentedPrompt, draft != presentedPrompt else { return }
        endRecall()
    }

    private mutating func endRecall() {
        promptID = nil
        draftBeforeRecall = ""
        presentedPrompt = nil
    }
}

enum FeatureComposerPromptHistoryInputPolicy {
    static func handler(
        _ handler: ((FeatureComposerPromptHistory.Direction) -> Bool)?,
        suggestionsArePresented: Bool
    ) -> ((FeatureComposerPromptHistory.Direction) -> Bool)? {
        suggestionsArePresented ? nil : handler
    }
}
