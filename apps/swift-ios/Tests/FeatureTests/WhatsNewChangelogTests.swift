import Foundation
import Testing
@testable import T3Code

@Suite("What's New changelog")
struct WhatsNewChangelogTests {
    private let runningBundle: [String: Any] = [
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "90",
    ]

    private func embedded(_ json: String) -> String {
        Data(json.utf8).base64EncodedString()
    }

    private func payload(_ json: String) -> [String: Any] {
        var info = runningBundle
        info[WhatsNewChangelog.infoDictionaryKey] = embedded(json)
        return info
    }

    private let history = """
        {"builds":[
          {"version":"0.1.0","build":"88","entries":[{"title":"Command drawer"}]},
          {"version":"0.1.0","build":"90","entries":[
            {"title":"What's New history","summary":"Every build's entries ride along."},
            {"title":"Done for a duration"}
          ]},
          {"version":"0.1.0","build":"89","entries":[{"title":"Inline workspace images"}]}
        ]}
        """

    @Test
    func decodesEveryRecordedBuildNewestFirst() {
        let changelog = WhatsNewChangelog.decode(embedded(history))

        #expect(changelog?.builds.map(\.build) == ["90", "89", "88"])
        #expect(changelog?.builds.first?.entries.count == 2)
        #expect(changelog?.builds.first?.entries.first?.title == "What's New history")
        #expect(
            changelog?.builds.first?.entries.first?.summary == "Every build's entries ride along."
        )
        #expect(changelog?.builds.last?.entries.map(\.title) == ["Command drawer"])
    }

    @Test
    func leadsWithTheRunningBuildAndKeepsTheRestAsHistory() {
        let presentation = WhatsNewChangelog.load(info: payload(history))?
            .presentation(info: runningBundle)

        #expect(presentation?.current?.build == "90")
        #expect(presentation?.current?.label == "0.1.0 (90)")
        #expect(presentation?.current?.entries.count == 2)
        #expect(presentation?.earlier.map(\.build) == ["89", "88"])
        #expect(presentation?.earlier.map(\.label) == ["0.1.0 (89)", "0.1.0 (88)"])
    }

    @Test
    func readsEverythingAsHistoryWhenThePayloadDoesNotNameTheRunningBuild() {
        let json = """
            {"builds":[
              {"version":"0.1.0","build":"89","entries":[{"title":"Inline workspace images"}]},
              {"version":"0.1.0","build":"88","entries":[{"title":"Command drawer"}]}
            ]}
            """

        let presentation = WhatsNewChangelog.decode(embedded(json))?
            .presentation(info: runningBundle)

        #expect(presentation?.current == nil)
        #expect(presentation?.earlier.map(\.build) == ["89", "88"])
    }

    @Test
    func readsTheSingleBuildPayloadAsTheRunningBuild() {
        let json = #"{"entries":[{"title":"What's New screen","summary":"Opens from About."}]}"#

        let presentation = WhatsNewChangelog.load(info: payload(json))?
            .presentation(info: runningBundle)

        #expect(presentation?.current?.build == "90")
        #expect(presentation?.current?.label == "0.1.0 (90)")
        #expect(presentation?.current?.entries.map(\.title) == ["What's New screen"])
        #expect(presentation?.earlier.isEmpty == true)
    }

    @Test
    func keepsUnnumberedBuildsAfterTheNumberedHistoryInPayloadOrder() {
        let json = """
            {"builds":[
              {"version":"0.1.0","entries":[{"title":"Unnumbered first"}]},
              {"build":"5","entries":[{"title":"Numbered"}]},
              {"entries":[{"title":"Unnumbered second"}]}
            ]}
            """

        let changelog = WhatsNewChangelog.decode(embedded(json))

        #expect(
            changelog?.builds.flatMap({ $0.entries.map(\.title) })
                == ["Numbered", "Unnumbered first", "Unnumbered second"]
        )
        #expect(changelog?.builds.map(\.label) == ["Build 5", "0.1.0", nil])
    }

    @Test
    func readsOptionalDetailAndSymbolWhenAPublisherRecordsThem() {
        let json = """
            {"builds":[{"version":"0.1.0","build":"90","entries":[
              {
                "title":"What's New history",
                "summary":"Every build's entries ride along.",
                "detail":"  Each publisher appends its build to the history it inherited.  ",
                "symbol":"clock.arrow.circlepath"
              }
            ]}]}
            """

        let entry = WhatsNewChangelog.decode(embedded(json))?.builds.first?.entries.first

        #expect(entry?.hasDetail == true)
        #expect(entry?.detail == "Each publisher appends its build to the history it inherited.")
        #expect(entry?.symbolName == "clock.arrow.circlepath")
    }

    @Test
    func leavesEntriesInertWhenTheyRecordNoDetailAndFallsBackToTheDefaultSymbol() {
        let json = """
            {"builds":[{"version":"0.1.0","build":"90","entries":[
              {"title":"No detail recorded"},
              {"title":"Blank detail","detail":"   ","symbol":"   "},
              {"title":"Unknown symbol","symbol":"not.a.real.sf.symbol.name"}
            ]}]}
            """

        let entries = WhatsNewChangelog.decode(embedded(json))?.builds.first?.entries

        #expect(entries?.count == 3)
        #expect(entries?.allSatisfy { !$0.hasDetail } == true)
        #expect(entries?.allSatisfy { $0.detail == nil } == true)
        #expect(entries?.map(\.symbolName) == ["sparkles", "sparkles", "sparkles"])
    }

    @Test
    func rendersPayloadsWrittenBeforeDetailAndSymbolExistedExactlyAsBefore() {
        let entry = WhatsNewChangelog.load(info: payload(history))?
            .presentation(info: runningBundle)
            .current?
            .entries
            .first

        #expect(entry?.title == "What's New history")
        #expect(entry?.summary == "Every build's entries ride along.")
        #expect(entry?.detail == nil)
        #expect(entry?.hasDetail == false)
        #expect(entry?.symbolName == "sparkles")
    }

    @Test
    func treatsAnythingABuildMightLeaveBehindAsNoChangelog() {
        let payloads: [String] = [
            "$(T3_BUILD_CHANGELOG)",
            "",
            "   ",
            "not base64 at all!!",
            embedded("this is not json"),
            embedded(#"{"builds":[]}"#),
            embedded(#"{"entries":[]}"#),
            embedded(#"{"builds":[{"build":"90","entries":[{"title":"   "}]}]}"#),
            embedded(#"{"releases":[]}"#),
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
        #expect(WhatsNewChangelog.load(info: payload(history))?.builds.count == 3)
        #expect(WhatsNewChangelog.load(info: runningBundle) == nil)
        #expect(WhatsNewChangelog.load(info: nil) == nil)
        #expect(
            WhatsNewChangelog.load(info: [WhatsNewChangelog.infoDictionaryKey: 42]) == nil
        )
    }

    @Test
    func trimsEntryTextAndDropsTitlelessEntriesAndEmptyBuilds() {
        let json = """
            {"builds":[
              {"build":"  90  ","version":"  0.1.0  ","entries":[
                {"title":"  Recent projects  ","summary":"  Picker remembers what you opened.  "},
                {"title":"","summary":"orphan summary"},
                {"title":"Timestamps","summary":"   "}
              ]},
              {"build":"89","entries":[{"title":"  "}]}
            ]}
            """

        let changelog = WhatsNewChangelog.decode(embedded(json))

        #expect(changelog?.builds.count == 1)
        #expect(changelog?.builds.first?.build == "90")
        #expect(changelog?.builds.first?.version == "0.1.0")
        #expect(changelog?.builds.first?.entries.count == 2)
        #expect(changelog?.builds.first?.entries.first?.title == "Recent projects")
        #expect(
            changelog?.builds.first?.entries.first?.summary == "Picker remembers what you opened."
        )
        #expect(changelog?.builds.first?.entries.last?.summary == nil)
    }

    @Test
    func buildLabelCombinesVersionAndBuildOnlyWhenBothAreRecorded() {
        #expect(WhatsNewChangelog.buildLabel(info: runningBundle) == "0.1.0 (90)")
        #expect(
            WhatsNewChangelog.buildLabel(
                info: [
                    "CFBundleShortVersionString": "$(MARKETING_VERSION)",
                    "CFBundleVersion": "90",
                ]
            ) == nil
        )
        #expect(
            WhatsNewChangelog.buildLabel(info: ["CFBundleShortVersionString": "0.1.0"]) == nil
        )
        #expect(WhatsNewChangelog.buildLabel(info: nil) == nil)
    }
}
