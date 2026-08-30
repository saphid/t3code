import CoreGraphics
import Testing
@testable import T3Code

struct EnvironmentBadgePresentationTests {
    @Test(
        "Build channels use the matching compact identity",
        .bug("https://github.com/saphid/t3code-personal/issues/251"),
        arguments: [
            ("com.example.app.dev", "Example Dev", "Dev"),
            ("com.example.app.test", "Example Test", "Test"),
            ("com.example.app", "Example", nil),
        ]
    )
    func buildChannel(
        bundleIdentifier: String,
        displayName: String,
        expectedLabel: String?
    ) {
        let channel = EnvironmentBadgePresentation.Channel(
            bundleIdentifier: bundleIdentifier,
            displayName: displayName
        )

        #expect(channel.badgeLabel == expectedLabel)
    }

    @Test(
        "Environment state and live renames produce fresh labels",
        .bug("https://github.com/saphid/t3code-personal/issues/251")
    )
    func stateAndRenameUpdates() {
        let connecting = EnvironmentBadgePresentation.environment(
            name: "Office Mac",
            status: .connecting,
            channel: .test
        )
        let renamed = EnvironmentBadgePresentation.environment(
            name: "Studio Mac",
            status: .disconnected,
            channel: .test
        )

        #expect(connecting.fullLabel == "Office Mac connecting")
        #expect(renamed.fullLabel == "Studio Mac offline")
        #expect(renamed.compactLabel == "Studio Mac")
        #expect(renamed.accessibilityLabel == "Studio Mac offline, Test build")
    }

    @Test(
        "Long localized identity remains complete for VoiceOver",
        .bug("https://github.com/saphid/t3code-personal/issues/251")
    )
    func localizedAccessibilityLabel() {
        let presentation = EnvironmentBadgePresentation.environment(
            name: "Entwicklungsumgebung mit einem außergewöhnlich langen Namen",
            status: .reconnecting,
            statusLabel: "Verbindung wird wiederhergestellt",
            channel: .development
        )

        #expect(presentation.compactLabel == "Entwicklungsumgebung mit einem außergewöhnlich langen Namen")
        #expect(
            presentation.accessibilityLabel
                == "Entwicklungsumgebung mit einem außergewöhnlich langen Namen Verbindung wird wiederhergestellt, Dev build"
        )
    }

    @Test(
        "Accessibility text starts with the compact measured variant",
        .bug("https://github.com/saphid/t3code-personal/issues/251"),
        arguments: [(false, true), (true, false)]
    )
    func dynamicTypeVariant(
        isAccessibilitySize: Bool,
        expectedFullLabel: Bool
    ) {
        #expect(
            EnvironmentBadgeLayout.includesFullLabel(
                isAccessibilitySize: isAccessibilitySize
            ) == expectedFullLabel
        )
    }

    @Test(
        "Supported compact and split widths reserve both primary controls",
        .bug("https://github.com/saphid/t3code-personal/issues/251"),
        arguments: [
            ("iPhone compact", CGFloat(320)),
            ("iPhone standard", CGFloat(390)),
            ("iPhone wide", CGFloat(430)),
            ("iPad narrow split", CGFloat(375)),
            ("iPad half split", CGFloat(507)),
            ("iPad wide split", CGFloat(744)),
        ]
    )
    func supportedWidths(name _: String, width: CGFloat) {
        let badgeWidth = EnvironmentBadgeLayout.maximumBadgeWidth(
            containerWidth: width,
            trailingActionCount: 2
        )
        let occupiedWidth = EnvironmentBadgeLayout.headerLeadingInset
            + badgeWidth
            + EnvironmentBadgeLayout.headerSpacing * 2
            + EnvironmentBadgeLayout.trailingActionWidth * 2
            + EnvironmentBadgeLayout.headerTrailingInset

        #expect(badgeWidth >= 0)
        #expect(occupiedWidth <= width)
        #expect(T3Metrics.minimumTapTarget >= 44)
    }
}
