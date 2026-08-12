import SwiftUI
import UniformTypeIdentifiers

struct ThemeSettingsView: View {
    @SwiftUI.Environment(T3ThemeRuntime.self) private var themeRuntime
    @Binding var appearance: FeatureAppearance
    let converter: (any ThemeConversionCapable)?
    @State private var showingImporter = false
    @State private var importMessage: String?
    @State private var isImporting = false
    @State private var openVsxQuery = ""
    @State private var openVsxResults: [T3OpenVsxThemeExtension] = []
    @State private var isSearchingOpenVsx = false
    @State private var installingExtensionID: String?

    private let columns = [
        GridItem(.adaptive(minimum: 132, maximum: 180), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                appearancePicker

                importSection

                if converter?.canConvertThemes == true {
                    openVsxSection
                }

                if appearance == .system {
                    themeSection(title: "Light theme", mode: .light)
                    themeSection(title: "Dark theme", mode: .dark)
                } else {
                    themeSection(
                        title: appearance == .light ? "Light theme" : "Dark theme",
                        mode: appearance == .light ? .light : .dark
                    )
                }
            }
            .padding(20)
        }
        .background(T3Colors.background)
        .navigationTitle("Themes")
        .navigationBarTitleDisplayMode(.inline)
        .t3NavigationChrome()
        .onChange(of: appearance, initial: true) { _, value in
            themeRuntime.setAppearance(value)
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            Task { await importTheme(result) }
        }
        .alert(
            "Theme import",
            isPresented: Binding(
                get: { importMessage != nil },
                set: { if !$0 { importMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(importMessage ?? "")
        }
    }

    private var appearancePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Appearance")
                .font(T3Typography.supportingStrong)
                .foregroundStyle(T3Colors.textSecondary)

            Picker("Appearance", selection: $appearance) {
                Text("System").tag(FeatureAppearance.system)
                Text("Light").tag(FeatureAppearance.light)
                Text("Dark").tag(FeatureAppearance.dark)
            }
            .pickerStyle(.segmented)
        }
    }

    private var importSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                showingImporter = true
            } label: {
                Label(
                    isImporting ? "Importing…" : "Import theme file",
                    systemImage: "square.and.arrow.down"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isImporting)

            if let converter, converter.canConvertThemes {
                Text(
                    "VS Code and T3 theme files are converted privately by \(converter.themeConversionEnvironmentName ?? "your selected server"). The resolved colors are then stored on this iPhone for offline use."
                )
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
            } else {
                Text(
                    "Portable SwiftyY theme artifacts can be imported offline. Connect to an updated T3 server to convert raw VS Code theme files."
                )
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
            }
        }
    }

    private var openVsxSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("VS Code themes from Open VSX")
                .font(T3Typography.supportingStrong)
                .foregroundStyle(T3Colors.textSecondary)

            HStack(spacing: 8) {
                TextField("Search themes", text: $openVsxQuery)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await searchOpenVsx() } }
                Button {
                    Task { await searchOpenVsx() }
                } label: {
                    if isSearchingOpenVsx {
                        ProgressView()
                    } else {
                        Image(systemName: "magnifyingglass")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    openVsxQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || isSearchingOpenVsx
                )
            }

            ForEach(openVsxResults, id: \.id) { extensionInfo in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(extensionInfo.name)
                            .font(T3Typography.supportingStrong)
                            .foregroundStyle(T3Colors.textPrimary)
                        Text("\(extensionInfo.publisher) · \(extensionInfo.license)")
                            .font(T3Typography.supporting)
                            .foregroundStyle(T3Colors.textSecondary)
                        if !extensionInfo.description.isEmpty {
                            Text(extensionInfo.description)
                                .font(T3Typography.supporting)
                                .foregroundStyle(T3Colors.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 8)
                    Button(installingExtensionID == extensionInfo.id ? "Installing…" : "Install") {
                        Task { await installOpenVsx(extensionInfo) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(installingExtensionID != nil)
                }
                .padding(12)
                .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 12))
            }

            Text(
                "Searches and extension downloads are performed by \(converter?.themeConversionEnvironmentName ?? "your selected server") from Open VSX. Only supported open-license color themes are offered; installed colors remain available offline."
            )
            .font(T3Typography.supporting)
            .foregroundStyle(T3Colors.textSecondary)
        }
    }

    @MainActor
    private func searchOpenVsx() async {
        guard let converter else { return }
        isSearchingOpenVsx = true
        defer { isSearchingOpenVsx = false }
        do {
            openVsxResults = try await converter.searchOpenVsxThemes(query: openVsxQuery)
            if openVsxResults.isEmpty {
                importMessage = "No compatible Open VSX color themes matched that search."
            }
        } catch {
            importMessage = error.localizedDescription
        }
    }

    @MainActor
    private func installOpenVsx(_ extensionInfo: T3OpenVsxThemeExtension) async {
        guard let converter else { return }
        installingExtensionID = extensionInfo.id
        defer { installingExtensionID = nil }
        do {
            let artifact = try await converter.installOpenVsxTheme(extensionID: extensionInfo.id)
            try themeRuntime.install(artifact)
            if let first = artifact.themes.first { themeRuntime.selectBoth(themeID: first.id) }
            importMessage =
                "Installed \(artifact.themes.count) theme\(artifact.themes.count == 1 ? "" : "s") from \(extensionInfo.name)."
        } catch {
            importMessage = error.localizedDescription
        }
    }

    @MainActor
    private func importTheme(_ result: Result<[URL], any Error>) async {
        isImporting = true
        defer { isImporting = false }
        do {
            guard let url = try result.get().first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            guard data.count <= 256 * 1024 else {
                throw ThemeImportViewError.tooLarge
            }

            let artifact: T3ResolvedThemeArtifact
            if let portable = try? JSONDecoder().decode(T3ResolvedThemeArtifact.self, from: data) {
                artifact = portable
            } else {
                guard let converter, converter.canConvertThemes else {
                    throw ThemeImportViewError.converterUnavailable
                }
                guard let contents = String(data: data, encoding: .utf8) else {
                    throw ThemeImportViewError.invalidText
                }
                artifact = try await converter.compileTheme(
                    fileName: url.lastPathComponent,
                    contents: contents
                )
            }
            try themeRuntime.install(artifact)
            if let imported = artifact.themes.first {
                themeRuntime.selectBoth(themeID: imported.id)
            }
            importMessage =
                artifact.themes.count == 1
                ? "Imported \(artifact.themes[0].label)."
                : "Imported \(artifact.themes.count) themes."
        } catch {
            importMessage = error.localizedDescription
        }
    }

    private func themeSection(title: String, mode: T3ThemeAppearance) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(T3Typography.supportingStrong)
                .foregroundStyle(T3Colors.textSecondary)

            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                ForEach(themeRuntime.themes.filter { $0.palette(for: mode) != nil }) { theme in
                    ThemeCard(
                        theme: theme,
                        mode: mode,
                        isSelected: selectedThemeID(for: mode) == theme.id
                    ) {
                        themeRuntime.select(themeID: theme.id, for: mode)
                    }
                }
            }
        }
    }

    private func selectedThemeID(for mode: T3ThemeAppearance) -> String {
        mode == .light
            ? themeRuntime.selection.lightThemeId
            : themeRuntime.selection.darkThemeId
    }
}

private enum ThemeImportViewError: LocalizedError {
    case tooLarge
    case converterUnavailable
    case invalidText

    var errorDescription: String? {
        switch self {
        case .tooLarge: "Theme files must be 256 KB or smaller."
        case .converterUnavailable: "Connect to an updated T3 server to convert this theme file."
        case .invalidText: "That theme file is not valid UTF-8 text."
        }
    }
}

private struct ThemeCard: View {
    let theme: T3ResolvedThemeDefinition
    let mode: T3ThemeAppearance
    let isSelected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            VStack(alignment: .leading, spacing: 10) {
                preview
                    .frame(height: 66)

                HStack(spacing: 6) {
                    Text(theme.label)
                        .font(T3Typography.supportingStrong)
                        .foregroundStyle(T3Colors.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(T3Colors.accent)
                    }
                }
            }
            .padding(12)
            .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(
                        isSelected ? T3Colors.accent : T3Colors.border,
                        lineWidth: isSelected ? 2 : 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("(theme.label), (mode.rawValue)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var preview: some View {
        let colors = theme.palette(for: mode)?.colors ?? [:]
        return ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: 10)
                .fill(color(colors["canvas"]))
            RoundedRectangle(cornerRadius: 7)
                .fill(color(colors["surfaceRaised"]))
                .frame(width: 74, height: 42)
                .padding(8)
            Circle()
                .fill(color(colors["accent"]))
                .frame(width: 22, height: 22)
                .padding(10)
        }
    }

    private func color(_ value: T3ThemeColorValue?) -> Color {
        guard let value else { return .clear }
        return Color(uiColor: value.uiColor)
    }
}
