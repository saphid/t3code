import Testing
@testable import T3Code

@Suite("OpenCode option mapping")
struct OpenCodeOptionMappingTests {
    @Test
    func preservesSanitizedUnicodeIdentifiers() {
        let mapped = NativeFeatureClient.mapOptionSelections([
            ModelSelection.OptionSelection(id: "agent", value: .string("编译-β")),
            ModelSelection.OptionSelection(id: "variant", value: .string("xhigh/v2")),
            ModelSelection.OptionSelection(id: "fastMode", value: .bool(true)),
        ])

        #expect(mapped == [
            FeatureModelOptionSelection(id: "agent", value: .string("编译-β")),
            FeatureModelOptionSelection(id: "variant", value: .string("xhigh/v2")),
            FeatureModelOptionSelection(id: "fastMode", value: .boolean(true)),
        ])
    }
}
