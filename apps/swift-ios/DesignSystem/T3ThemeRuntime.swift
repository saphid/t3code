import Foundation
import Observation
import SwiftUI
import UIKit

struct T3ThemeColorValue: Codable, Equatable, Sendable {
    let css: String
    let colorSpace: String
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double

    var uiColor: UIColor {
        UIColor(
            red: CGFloat(red),
            green: CGFloat(green),
            blue: CGFloat(blue),
            alpha: CGFloat(alpha)
        )
    }
}

struct T3ResolvedThemePalette: Codable, Equatable, Sendable {
    let appearance: String
    let colors: [String: T3ThemeColorValue]
}

struct T3ResolvedThemeDefinition: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let label: String
    let modes: [T3ResolvedThemePalette]

    func palette(for appearance: T3ThemeAppearance) -> T3ResolvedThemePalette? {
        modes.first { $0.appearance == appearance.rawValue }
    }
}

public struct T3ResolvedThemeArtifact: Codable, Equatable, Sendable {
    let artifactVersion: Int
    let engineVersion: String
    let roleManifest: [String]
    let roleSchema: String
    let themes: [T3ResolvedThemeDefinition]
}

public struct T3OpenVsxThemeExtension: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    let name: String
    let publisher: String
    let description: String
    let downloadCount: Double
    let iconUrl: String?
    let version: String
    let license: String
}

enum T3ThemeAppearance: String, Codable, CaseIterable, Sendable {
    case light
    case dark
}

struct T3ThemeSelection: Codable, Equatable, Sendable {
    var appearance: FeatureAppearance
    var lightThemeId: String
    var darkThemeId: String

    static let standard = T3ThemeSelection(
        appearance: .system,
        lightThemeId: "t3-code",
        darkThemeId: "t3-code"
    )
}

@MainActor
@Observable
final class T3ThemeRuntime {
    static let shared = T3ThemeRuntime()
    static let selectionStorageKey = "swift-ios.theme-selection.v1"

    nonisolated private static let paletteLock = NSLock()
    nonisolated(unsafe) private static var activeLightColors: [String: T3ThemeColorValue] = [:]
    nonisolated(unsafe) private static var activeDarkColors: [String: T3ThemeColorValue] = [:]

    private let builtInArtifact: T3ResolvedThemeArtifact
    private var installedArtifact: T3ResolvedThemeArtifact?
    private(set) var selection: T3ThemeSelection
    private(set) var revision: UInt64 = 0
    private let defaults: UserDefaults
    private let installedThemesURL: URL?

    var artifact: T3ResolvedThemeArtifact {
        guard let installedArtifact else { return builtInArtifact }
        return T3ResolvedThemeArtifact(
            artifactVersion: builtInArtifact.artifactVersion,
            engineVersion: builtInArtifact.engineVersion,
            roleManifest: builtInArtifact.roleManifest,
            roleSchema: builtInArtifact.roleSchema,
            themes: builtInArtifact.themes + installedArtifact.themes
        )
    }

    var themes: [T3ResolvedThemeDefinition] { artifact.themes }

    var sharedProjection: T3SharedThemeProjection {
        let light = selectedTheme(for: .light).palette(for: .light)?.colors
        let dark = selectedTheme(for: .dark).palette(for: .dark)?.colors
        return T3SharedThemeProjection(
            lightCanvas: light?["canvas"]?.css ?? T3SharedThemeProjection.fallback.lightCanvas,
            darkCanvas: dark?["canvas"]?.css ?? T3SharedThemeProjection.fallback.darkCanvas,
            lightAccent: light?["accent"]?.css ?? T3SharedThemeProjection.fallback.lightAccent,
            darkAccent: dark?["accent"]?.css ?? T3SharedThemeProjection.fallback.darkAccent
        )
    }

    init(
        artifact: T3ResolvedThemeArtifact? = nil,
        defaults: UserDefaults = .standard,
        installedThemesURL: URL? = T3ThemeRuntime.defaultInstalledThemesURL()
    ) {
        self.defaults = defaults
        self.installedThemesURL = installedThemesURL
        builtInArtifact = artifact ?? Self.loadBundledArtifact() ?? Self.fallbackArtifact
        installedArtifact = installedThemesURL.flatMap(Self.loadInstalledArtifact(from:))
        selection = Self.loadSelection(defaults: defaults)
        if installedArtifact?.roleSchema != builtInArtifact.roleSchema {
            installedArtifact = nil
        }
        repairSelection()
        publishActivePalettes()
    }

    func install(_ incoming: T3ResolvedThemeArtifact) throws {
        try validate(incoming)
        let builtInIDs = Set(builtInArtifact.themes.map(\.id))
        guard incoming.themes.allSatisfy({ !builtInIDs.contains($0.id) }) else {
            throw T3ThemeInstallError.reservedIdentifier
        }

        var installed = installedArtifact?.themes ?? []
        let incomingIDs = Set(incoming.themes.map(\.id))
        installed.removeAll { incomingIDs.contains($0.id) }
        installed.append(contentsOf: incoming.themes)
        installed.sort { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        installedArtifact = T3ResolvedThemeArtifact(
            artifactVersion: 1,
            engineVersion: incoming.engineVersion,
            roleManifest: builtInArtifact.roleManifest,
            roleSchema: builtInArtifact.roleSchema,
            themes: installed
        )
        try persistInstalledArtifact()
        repairSelection()
        publishActivePalettes()
        revision &+= 1
    }

    func removeInstalledTheme(id: String) throws {
        guard var installed = installedArtifact else { return }
        installed = T3ResolvedThemeArtifact(
            artifactVersion: installed.artifactVersion,
            engineVersion: installed.engineVersion,
            roleManifest: installed.roleManifest,
            roleSchema: installed.roleSchema,
            themes: installed.themes.filter { $0.id != id }
        )
        installedArtifact = installed.themes.isEmpty ? nil : installed
        try persistInstalledArtifact()
        repairSelection()
        persistAndPublish()
    }

    func isInstalled(themeID: String) -> Bool {
        installedArtifact?.themes.contains { $0.id == themeID } == true
    }

    func setAppearance(_ appearance: FeatureAppearance) {
        guard selection.appearance != appearance else { return }
        selection.appearance = appearance
        persistAndPublish()
    }

    func select(themeID: String, for appearance: T3ThemeAppearance) {
        guard theme(id: themeID)?.palette(for: appearance) != nil else { return }
        switch appearance {
        case .light: selection.lightThemeId = themeID
        case .dark: selection.darkThemeId = themeID
        }
        persistAndPublish()
    }

    func selectBoth(themeID: String) {
        guard let theme = theme(id: themeID) else { return }
        if theme.palette(for: .light) != nil { selection.lightThemeId = themeID }
        if theme.palette(for: .dark) != nil { selection.darkThemeId = themeID }
        persistAndPublish()
    }

    func theme(id: String) -> T3ResolvedThemeDefinition? {
        artifact.themes.first { $0.id == id }
    }

    func selectedTheme(for appearance: T3ThemeAppearance) -> T3ResolvedThemeDefinition {
        let id = appearance == .light ? selection.lightThemeId : selection.darkThemeId
        return theme(id: id) ?? artifact.themes[0]
    }

    nonisolated static func adaptiveColor(
        role: String,
        fallbackLight: UIColor,
        fallbackDark: UIColor
    ) -> UIColor {
        UIColor { traits in
            paletteLock.lock()
            defer { paletteLock.unlock() }
            let colors = traits.userInterfaceStyle == .dark ? activeDarkColors : activeLightColors
            return colors[role]?.uiColor
                ?? (traits.userInterfaceStyle == .dark ? fallbackDark : fallbackLight)
        }
    }

    nonisolated static func currentColor(
        role: String,
        appearance: T3ThemeAppearance,
        fallback: UIColor
    ) -> UIColor {
        paletteLock.lock()
        defer { paletteLock.unlock() }
        let colors = appearance == .dark ? activeDarkColors : activeLightColors
        return colors[role]?.uiColor ?? fallback
    }

    nonisolated static func currentCSS(
        role: String,
        appearance: T3ThemeAppearance,
        fallback: String
    ) -> String {
        paletteLock.lock()
        defer { paletteLock.unlock() }
        let colors = appearance == .dark ? activeDarkColors : activeLightColors
        return colors[role]?.css ?? fallback
    }

    private func repairSelection() {
        if theme(id: selection.lightThemeId)?.palette(for: .light) == nil {
            selection.lightThemeId = "t3-code"
        }
        if theme(id: selection.darkThemeId)?.palette(for: .dark) == nil {
            selection.darkThemeId = "t3-code"
        }
    }

    private func validate(_ candidate: T3ResolvedThemeArtifact) throws {
        guard candidate.artifactVersion == 1,
            candidate.roleSchema == builtInArtifact.roleSchema,
            candidate.roleManifest == builtInArtifact.roleManifest,
            !candidate.themes.isEmpty
        else {
            throw T3ThemeInstallError.incompatibleArtifact
        }
        let roles = Set(builtInArtifact.roleManifest)
        for theme in candidate.themes {
            guard !theme.id.isEmpty, !theme.label.isEmpty, !theme.modes.isEmpty else {
                throw T3ThemeInstallError.incompleteTheme
            }
            for palette in theme.modes where Set(palette.colors.keys) != roles {
                throw T3ThemeInstallError.incompleteTheme
            }
        }
    }

    private func persistInstalledArtifact() throws {
        guard let installedThemesURL else { return }
        if let installedArtifact {
            let directory = installedThemesURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(installedArtifact).write(
                to: installedThemesURL,
                options: [.atomic, .completeFileProtection]
            )
        } else if FileManager.default.fileExists(atPath: installedThemesURL.path) {
            try FileManager.default.removeItem(at: installedThemesURL)
        }
    }

    private func persistAndPublish() {
        if let data = try? JSONEncoder().encode(selection) {
            defaults.set(data, forKey: Self.selectionStorageKey)
        }
        publishActivePalettes()
        revision &+= 1
    }

    private func publishActivePalettes() {
        let light = selectedTheme(for: .light).palette(for: .light)?.colors ?? [:]
        let dark = selectedTheme(for: .dark).palette(for: .dark)?.colors ?? [:]
        Self.paletteLock.lock()
        Self.activeLightColors = light
        Self.activeDarkColors = dark
        Self.paletteLock.unlock()
    }

    private static func loadSelection(defaults: UserDefaults) -> T3ThemeSelection {
        guard
            let data = defaults.data(forKey: selectionStorageKey),
            let selection = try? JSONDecoder().decode(T3ThemeSelection.self, from: data)
        else {
            return .standard
        }
        return selection
    }

    private static func loadBundledArtifact() -> T3ResolvedThemeArtifact? {
        guard
            let url = Bundle.main.url(forResource: "theme-catalog-v1", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let artifact = try? JSONDecoder().decode(T3ResolvedThemeArtifact.self, from: data),
            artifact.artifactVersion == 1,
            artifact.roleManifest.count == 57,
            !artifact.themes.isEmpty
        else {
            return nil
        }
        return artifact
    }

    static func defaultInstalledThemesURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("T3CodeSwift", isDirectory: true)
            .appendingPathComponent("themes-v1.json", isDirectory: false)
    }

    private static func loadInstalledArtifact(from url: URL) -> T3ResolvedThemeArtifact? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T3ResolvedThemeArtifact.self, from: data)
    }

    private static let fallbackArtifact = T3ResolvedThemeArtifact(
        artifactVersion: 1,
        engineVersion: "native-fallback",
        roleManifest: [],
        roleSchema: "fallback",
        themes: [
            T3ResolvedThemeDefinition(
                id: "t3-code",
                label: "T3 Code",
                modes: [
                    T3ResolvedThemePalette(appearance: "light", colors: [:]),
                    T3ResolvedThemePalette(appearance: "dark", colors: [:]),
                ]
            )
        ]
    )
}

private enum T3ThemeInstallError: LocalizedError {
    case incompatibleArtifact
    case incompleteTheme
    case reservedIdentifier

    var errorDescription: String? {
        switch self {
        case .incompatibleArtifact:
            "This theme was made for an incompatible theme engine."
        case .incompleteTheme:
            "This theme does not define every color required by SwiftyY."
        case .reservedIdentifier:
            "This theme uses the identifier of a built-in theme."
        }
    }
}
