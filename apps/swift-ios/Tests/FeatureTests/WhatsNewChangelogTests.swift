import Foundation
import Testing
@testable import T3Code

@Suite("What's New changelog")
struct WhatsNewChangelogTests {
    private func embedded(_ json: String) -> String {
        Data(json.utf8).base64EncodedString()
    }

    @Test
    func decodesEmbeddedEntriesInBuildOrder() {
        let payload = embedded(
            """
            {"entries":[
              {"title":"Inline workspace images","summary":"Generated images render in the transcript."},
              {"title":"Tool error recovery"}
            ]}
            """
        )

        let changelog = WhatsNewChangelog.decode(payload)

        #expect(changelog?.entries.count == 2)
        #expect(changelog?.entries.first?.title == "Inline workspace images")
        #expect(
            changelog?.entries.first?.summary
                == "Generated images render in the transcript."
        )
        #expect(changelog?.entries.last?.title == "Tool error recovery")
        #expect(changelog?.entries.last?.summary == nil)
    }

    @Test
    func treatsAnythingABuildMightLeaveBehindAsNoChangelog() {
        let payloads: [String] = [
            "$(T3_BUILD_CHANGELOG)",
            "",
            "   ",
            "not base64 at all!!",
            embedded("this is not json"),
            embedded(#"{"entries":[]}"#),
            embedded(#"{"entries":[{"title":"   "}]}"#),
            embedded(#"{"builds":[]}"#),
        ]

        for payload in payloads {
            #expect(
                WhatsNewChangelog.decode(payload) == nil,
                "expected no changelog for \(payload)"
            )
        }
    }

    @Test
    func readsThePayloadFromTheBundleKeyAndHidesWhenItIsAbsent() {
        let payload = embedded(#"{"entries":[{"title":"What's New"}]}"#)

        #expect(
            WhatsNewChangelog.load(info: [WhatsNewChangelog.infoDictionaryKey: payload])?
                .entries.count == 1
        )
        #expect(WhatsNewChangelog.load(info: ["SomethingElse": payload]) == nil)
        #expect(WhatsNewChangelog.load(info: nil) == nil)
        #expect(WhatsNewChangelog.load(info: [WhatsNewChangelog.infoDictionaryKey: 42]) == nil)
    }

    @Test
    func trimsEntryTextAndDropsTitlelessEntries() {
        let payload = embedded(
            """
            {"entries":[
              {"title":"  Recent projects  ","summary":"  Picker remembers what you opened.  "},
              {"title":"","summary":"orphan summary"},
              {"title":"Timestamps","summary":"   "}
            ]}
            """
        )

        let changelog = WhatsNewChangelog.decode(payload)

        #expect(changelog?.entries.count == 2)
        #expect(changelog?.entries.first?.title == "Recent projects")
        #expect(changelog?.entries.first?.summary == "Picker remembers what you opened.")
        #expect(changelog?.entries.last?.title == "Timestamps")
        #expect(changelog?.entries.last?.summary == nil)
    }

    @Test
    func buildLabelCombinesVersionAndBuildOnlyWhenBothAreRecorded() {
        #expect(
            WhatsNewChangelog.buildLabel(
                info: ["CFBundleShortVersionString": "0.1.0", "CFBundleVersion": "29"]
            ) == "0.1.0 (29)"
        )
        #expect(
            WhatsNewChangelog.buildLabel(
                info: [
                    "CFBundleShortVersionString": "$(MARKETING_VERSION)",
                    "CFBundleVersion": "29",
                ]
            ) == nil
        )
        #expect(
            WhatsNewChangelog.buildLabel(info: ["CFBundleShortVersionString": "0.1.0"]) == nil
        )
        #expect(WhatsNewChangelog.buildLabel(info: nil) == nil)
    }
}
