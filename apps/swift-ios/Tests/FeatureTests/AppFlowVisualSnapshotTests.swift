import SnapshotTesting
import SwiftUI
import XCTest
@testable import T3Code

@MainActor
final class AppFlowVisualSnapshotTests: XCTestCase {
    func testOnboardingWelcomeAtStandardType() {
        assertSnapshot(
            of: onboardingController(sizeCategory: .large, colorScheme: .light),
            as: .image(
                on: snapshotDevice,
                precision: 0.99,
                perceptualPrecision: 0.98
            ),
            named: "welcome-light-standard"
        )
    }

    func testOnboardingWelcomeAtAccessibilityTypeInDarkMode() {
        assertSnapshot(
            of: onboardingController(
                sizeCategory: .accessibilityExtraExtraLarge,
                colorScheme: .dark
            ),
            as: .image(
                on: snapshotDevice,
                precision: 0.99,
                perceptualPrecision: 0.98
            ),
            named: "welcome-dark-accessibility-xxl"
        )
    }

    func testOnboardingWelcomeRightToLeft() {
        assertSnapshot(
            of: onboardingController(
                sizeCategory: .large,
                colorScheme: .light,
                locale: Locale(identifier: "ar_SA"),
                layoutDirection: .rightToLeft
            ),
            as: .image(
                on: snapshotDevice,
                precision: 0.99,
                perceptualPrecision: 0.98
            ),
            named: "welcome-light-right-to-left"
        )
    }

    func testOnboardingWelcomeOnIPad() {
        assertSnapshot(
            of: onboardingController(sizeCategory: .large, colorScheme: .light),
            as: .image(
                on: snapshotTablet,
                precision: 0.99,
                perceptualPrecision: 0.98
            ),
            named: "welcome-light-ipad-mini"
        )
    }

    func testOnboardingWelcomeWithPersonalConnectOnTestChannel() {
        assertSnapshot(
            of: onboardingController(
                sizeCategory: .large,
                colorScheme: .light,
                buildChannel: .test
            ),
            as: .image(
                on: snapshotDevice,
                precision: 0.99,
                perceptualPrecision: 0.98
            ),
            named: "welcome-light-personal-connect-test"
        )
    }

    /// Point-Free's device presets define points and size classes but inherit
    /// the host Simulator's display scale. Pinning the reviewed references at
    /// 3x makes them independent of whether tests execute on an SE, 17e, or CI's
    /// 17 Pro.
    private var snapshotDevice: ViewImageConfig {
        var configuration = ViewImageConfig.iPhoneSe
        configuration.traits = configuration.traits.modifyingTraits {
            $0.displayScale = 3
        }
        return configuration
    }

    private var snapshotTablet: ViewImageConfig {
        var configuration = ViewImageConfig.iPadMini
        configuration.traits = configuration.traits.modifyingTraits {
            $0.displayScale = 2
        }
        return configuration
    }

    private func onboardingController(
        sizeCategory: ContentSizeCategory,
        colorScheme: ColorScheme,
        locale: Locale = Locale(identifier: "en_US"),
        layoutDirection: LayoutDirection = .leftToRight,
        buildChannel: PersonalBuildChannel = .upstream
    ) -> UIViewController {
        let model = FeatureRootModel(
            client: AppFlowFixtureClient(scenario: .onboarding)
        )
        let view = ConnectionOnboardingView(
            model: model,
            readinessChecker: LocalNetworkAccessChecker(),
            personalFleetHosts: snapshotPersonalFleetHosts,
            buildChannel: buildChannel
        )
            .environment(\.locale, locale)
            .environment(\.layoutDirection, layoutDirection)
            .environment(\.sizeCategory, sizeCategory)
            .environment(\.colorScheme, colorScheme)
        return UIHostingController(rootView: view)
    }

    private var snapshotPersonalFleetHosts: [PersonalFleetPairingHost] {
        ["MacBook Pro", "MacBook Air", "LXSO1", "LXSO2", "LXSO3", "NurseDroid"]
            .enumerated()
            .map { index, label in
                PersonalFleetPairingHost(
                    id: "snapshot-host-\(index)",
                    label: label,
                    httpsBaseURL: URL(string: "https://host-\(index).example")!
                )
            }
    }
}
