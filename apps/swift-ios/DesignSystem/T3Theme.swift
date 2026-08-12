import SwiftUI
import UIKit

enum T3Colors {
    // Keep these values aligned with apps/mobile/global.css. UIKit variants
    // let recycled collection and terminal surfaces participate in the same
    // system appearance changes as SwiftUI views.
    static var uiBackground: UIColor {
        themed("canvas", light: rgb(0xF2F2F7), dark: rgb(0x0A0A0A))
    }
    static var uiTextPrimary: UIColor {
        themed("text", light: rgb(0x262626), dark: rgb(0xF5F5F5))
    }
    static var uiTextSecondary: UIColor {
        themed("textMuted", light: rgb(0x525252), dark: rgb(0xA3A3A3))
    }

    static var background: Color { Color(uiColor: uiBackground) }
    static var sheet: Color {
        themedColor(
            "surfaceOverlay", light: rgb(0xF2F2F7, alpha: 0.98), dark: rgb(0x0E0E0E, alpha: 0.98))
    }
    static var surface: Color { themedColor("surface", light: rgb(0xFFFFFF), dark: rgb(0x171717)) }
    static var surfaceRaised: Color {
        themedColor("surfaceRaised", light: rgb(0xF5F5F5), dark: rgb(0x1C1C1C))
    }
    static var input: Color { themedColor("input", light: rgb(0xFFFFFF), dark: rgb(0x141414)) }
    static var border: Color {
        themedColor("border", light: rgb(0x000000, alpha: 0.08), dark: rgb(0xFFFFFF, alpha: 0.06))
    }
    static var inputBorder: Color {
        themedColor(
            "border",
        light: rgb(0x000000, alpha: 0.10), dark: rgb(0xFFFFFF, alpha: 0.08))
    }
    static var separator: Color {
        themedColor(
            "border",
        light: rgb(0x000000, alpha: 0.04), dark: rgb(0xFFFFFF, alpha: 0.03))
    }
    static var subtle: Color {
        themedColor("muted", light: rgb(0x000000, alpha: 0.04), dark: rgb(0xFFFFFF, alpha: 0.04))
    }
    static var subtleStrong: Color {
        themedColor(
            "accentSurface",
        light: rgb(0x000000, alpha: 0.08), dark: rgb(0xFFFFFF, alpha: 0.08))
    }
    static var shadow: Color {
        color(light: rgb(0x000000, alpha: 0.18), dark: rgb(0x000000, alpha: 0.32))
    }
    static var ledgerSurface: Color { surface }
    static var ledgerSelected: Color { surfaceRaised }

    static var textPrimary: Color { Color(uiColor: uiTextPrimary) }
    static var textSecondary: Color {
        themedColor("textMuted", light: rgb(0x525252), dark: rgb(0xA3A3A3))
    }
    static var textTertiary: Color {
        themedColor("secondaryLabel", light: rgb(0x737373), dark: rgb(0x8E8E93))
    }
    static var placeholder: Color {
        themedColor("placeholder", light: rgb(0xA3A3A3), dark: rgb(0x8E8E93))
    }

    static var primaryAction: Color {
        themedColor("messageAction", light: rgb(0x262626), dark: rgb(0xF5F5F5))
    }
    static var primaryActionForeground: Color {
        themedColor("messageActionForeground", light: rgb(0xFFFFFF), dark: rgb(0x0A0A0A))
    }
    static var accent: Color { themedColor("accent", light: rgb(0x007AFF), dark: rgb(0x0A84FF)) }
    static let statusRunning = color(light: rgb(0x0284C7), dark: rgb(0x22D3EE))
    static let statusInput = color(light: rgb(0x4F46E5), dark: rgb(0xA5B4FC))
    static let success = color(light: rgb(0x16A34A), dark: rgb(0x30D158))
    static var warning: Color { themedColor("warning", light: rgb(0xD97706), dark: rgb(0xFF9F0A)) }
    static var danger: Color { themedColor("error", light: rgb(0xDC2626), dark: rgb(0xFF453A)) }

    static let syntaxKeyword = color(light: rgb(0x7C3AED), dark: rgb(0xC78EFF))
    static let syntaxLiteral = color(light: rgb(0x2563EB), dark: rgb(0x8CC7FF))
    static let syntaxNumber = color(light: rgb(0xB45309), dark: rgb(0xEBAA6B))
    static let syntaxProperty = color(light: rgb(0x0F766E), dark: rgb(0x6BD1C2))

    private static func color(light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: adaptive(light: light, dark: dark))
    }

    private static func themedColor(_ role: String, light: UIColor, dark: UIColor) -> Color {
        Color(uiColor: themed(role, light: light, dark: dark))
    }

    private static func themed(_ role: String, light: UIColor, dark: UIColor) -> UIColor {
        T3ThemeRuntime.adaptiveColor(role: role, fallbackLight: light, fallbackDark: dark)
    }

    private static func adaptive(light: UIColor, dark: UIColor) -> UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        }
    }

    private static func rgb(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

/// The native client uses semantic fonts so every surface follows Dynamic Type.
/// Keep roles here instead of introducing one-off point sizes in feature views.
enum T3Typography {
    static let homeTitle = Font.system(.body, design: .default, weight: .semibold)
    static let homeMetadata = Font.system(.footnote, design: .default)

    static let navigationTitle = Font.system(.headline, design: .default, weight: .semibold)
    static let navigationMetadata = Font.system(.footnote, design: .default)
    static let status = Font.system(.footnote, design: .default, weight: .semibold)

    static let threadBody = Font.system(.body, design: .default)
    static let threadHeading1 = Font.system(.title2, design: .default, weight: .bold)
    static let code = Font.system(.callout, design: .monospaced)
    static let tool = Font.system(.footnote, design: .monospaced)

    static let composer = Font.system(.body, design: .default)
    static let control = Font.system(.callout, design: .default, weight: .medium)
    static let supporting = Font.system(.footnote, design: .default)
    static let supportingStrong = Font.system(.footnote, design: .default, weight: .semibold)
    static let eyebrow = Font.system(.footnote, design: .default, weight: .bold)
}

enum T3Metrics {
    static let minimumTapTarget: CGFloat = 44
    static let sidebarWidth: CGFloat = 320
    static let minimumSidebarWidth: CGFloat = 280
    static let maximumSidebarWidth: CGFloat = 380
    static let readingWidth: CGFloat = 760
}

extension View {
    func t3NavigationChrome() -> some View {
        toolbarBackground(T3Colors.sheet, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
