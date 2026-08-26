import SwiftUI
import UIKit
#if canImport(FoundationModels)
import FoundationModels
#endif

extension Notification.Name {
    static let platformBetaFeedbackResponse = Notification.Name("T3PlatformBetaFeedbackResponse")
}

enum PlatformBetaFeedbackPolicy {
    enum PresentationPath: Equatable {
        case notificationReply
        case inAppFallback
        case disabled
    }

    static func presentationPath(
        channel: PersonalBuildChannel,
        notificationsAvailable: Bool
    ) -> PresentationPath {
        guard channel != .upstream else { return .disabled }
        return notificationsAvailable ? .notificationReply : .inAppFallback
    }
}

struct PlatformBetaFeedbackDiagnostics: Codable, Equatable, Sendable {
    let channel: String
    let appVersion: String
    let buildNumber: String
    let sourceRevision: String
    let deviceModel: String
    let operatingSystem: String
    let localeIdentifier: String
    let enabledEnvironmentCount: Int
    let connectedEnvironmentCount: Int
    let environmentSources: [String]

    init(
        build: AppBuildIdentity,
        deviceModel: String,
        operatingSystem: String,
        localeIdentifier: String,
        environments: [FeatureEnvironment]
    ) {
        channel = build.channel
        appVersion = build.marketingVersion
        buildNumber = build.buildNumber
        sourceRevision = build.sourceRevision
        self.deviceModel = deviceModel
        self.operatingSystem = operatingSystem
        self.localeIdentifier = localeIdentifier
        enabledEnvironmentCount = environments.count(where: \.isEnabled)
        connectedEnvironmentCount = environments.count {
            $0.isEnabled && $0.connectionState == .connected
        }
        environmentSources = Set(environments.filter(\.isEnabled).map(\.source.rawValue)).sorted()
    }

    var rendered: String {
        let sources = environmentSources.isEmpty ? "none" : environmentSources.joined(separator: ", ")
        return [
            "App: T3 Code \(channel) \(appVersion) (\(buildNumber))",
            "Source: \(sourceRevision)",
            "Device: \(deviceModel), \(operatingSystem)",
            "Locale: \(localeIdentifier)",
            "Environments: \(connectedEnvironmentCount)/\(enabledEnvironmentCount) connected; \(sources)",
        ].joined(separator: "\n")
    }
}

struct PlatformBetaFeedbackDraft: Identifiable, Equatable, Sendable {
    let id: String
    let screenshotJPEG: Data
    let diagnostics: PlatformBetaFeedbackDiagnostics
    var originalDescription: String
    var notificationWasUnavailable: Bool

    init(
        id: String = UUID().uuidString,
        screenshotJPEG: Data,
        diagnostics: PlatformBetaFeedbackDiagnostics,
        originalDescription: String = "",
        notificationWasUnavailable: Bool = false
    ) {
        self.id = id
        self.screenshotJPEG = screenshotJPEG
        self.diagnostics = diagnostics
        self.originalDescription = originalDescription
        self.notificationWasUnavailable = notificationWasUnavailable
    }
}

struct PlatformBetaFeedbackReport: Equatable, Sendable {
    let text: String
    let usedOnDeviceModel: Bool
    let fallbackMessage: String?

    static func fallback(
        originalDescription: String,
        diagnostics: PlatformBetaFeedbackDiagnostics,
        message: String
    ) -> Self {
        let original = originalDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return Self(
            text: """
            Summary
            \(original)

            Observed
            \(original)

            Expected
            Describe what you expected to happen.

            Diagnostics
            \(diagnostics.rendered)
            """,
            usedOnDeviceModel: false,
            fallbackMessage: message
        )
    }
}

struct PlatformBetaFeedbackStructurer: Sendable {
    var isAvailable: @Sendable () async -> Bool
    var generate: @Sendable (_ description: String, _ diagnostics: String) async throws -> String

    func report(
        for description: String,
        diagnostics: PlatformBetaFeedbackDiagnostics
    ) async -> PlatformBetaFeedbackReport {
        let original = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard await isAvailable() else {
            return .fallback(
                originalDescription: original,
                diagnostics: diagnostics,
                message: "On-device report cleanup is unavailable. Your original text is unchanged."
            )
        }

        do {
            let generated = try await generate(original, diagnostics.rendered)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !generated.isEmpty else {
                return .fallback(
                    originalDescription: original,
                    diagnostics: diagnostics,
                    message: "The on-device model returned no report. Your original text is unchanged."
                )
            }
            return PlatformBetaFeedbackReport(
                text: """
                \(generated)

                Original tester text
                \(original)

                Diagnostics
                \(diagnostics.rendered)
                """,
                usedOnDeviceModel: true,
                fallbackMessage: nil
            )
        } catch {
            return .fallback(
                originalDescription: original,
                diagnostics: diagnostics,
                message: "On-device report cleanup failed. Your original text is unchanged."
            )
        }
    }

    static let live = Self(
        isAvailable: {
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                return SystemLanguageModel.default.isAvailable
            }
            #endif
            return false
        },
        generate: { description, diagnostics in
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                let session = LanguageModelSession(instructions: """
                    Turn a beta tester's short description into a concise bug report. Preserve the tester's meaning. Use the headings Summary, Observed, and Expected. Do not add facts, secrets, conversation text, endpoints, identifiers, or guesses. Return only those three sections.
                    """)
                let response = try await session.respond(to: """
                    Tester description:
                    \(description)

                    Allowlisted diagnostics:
                    \(diagnostics)
                    """)
                return response.content
            }
            #endif
            throw PlatformBetaFeedbackError.modelUnavailable
        }
    )
}

enum PlatformBetaFeedbackError: Error {
    case modelUnavailable
}

enum PlatformBetaFeedbackNotificationPayload {
    static let draftIDKey = "t3_beta_feedback_draft_id"

    static func draftID(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo[draftIDKey] as? String, !id.isEmpty else { return nil }
        return id
    }
}

actor PlatformBetaFeedbackStore {
    static let shared = PlatformBetaFeedbackStore()

    private struct Record: Codable {
        let id: String
        let diagnostics: PlatformBetaFeedbackDiagnostics
        let createdAt: Date
    }

    private let directory: URL

    init(directory: URL? = nil) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        self.directory = directory ?? caches
            .appendingPathComponent("T3BetaFeedback", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
    }

    func save(_ draft: PlatformBetaFeedbackDraft) throws {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        removeExpiredDrafts(now: .now)
        let record = Record(id: draft.id, diagnostics: draft.diagnostics, createdAt: .now)
        try draft.screenshotJPEG.write(to: screenshotURL(for: draft.id), options: .atomic)
        try JSONEncoder().encode(record).write(to: recordURL(for: draft.id), options: .atomic)
    }

    func load(id: String, description: String = "") throws -> PlatformBetaFeedbackDraft? {
        let recordURL = recordURL(for: id)
        let screenshotURL = screenshotURL(for: id)
        guard FileManager.default.fileExists(atPath: recordURL.path),
              FileManager.default.fileExists(atPath: screenshotURL.path) else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: recordURL))
        return PlatformBetaFeedbackDraft(
            id: record.id,
            screenshotJPEG: try Data(contentsOf: screenshotURL),
            diagnostics: record.diagnostics,
            originalDescription: description
        )
    }

    func remove(id: String) {
        try? FileManager.default.removeItem(at: recordURL(for: id))
        try? FileManager.default.removeItem(at: screenshotURL(for: id))
    }

    private func recordURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).json")
    }

    private func screenshotURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).jpg")
    }

    private func removeExpiredDrafts(now: Date) {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let cutoff = now.addingTimeInterval(-24 * 60 * 60)
        for recordURL in urls where recordURL.pathExtension == "json" {
            let modified = try? recordURL.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            guard let modified, modified < cutoff else { continue }
            let id = recordURL.deletingPathExtension().lastPathComponent
            remove(id: id)
        }
    }
}

@MainActor
enum PlatformBetaFeedbackScreenshotCapture {
    static func capture() -> Data? {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) else { return nil }

        let format = UIGraphicsImageRendererFormat.preferred()
        format.scale = window.screen.scale
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: format)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: false)
        }
        return image.jpegData(compressionQuality: 0.9)
    }
}

struct PlatformBetaFeedbackSharePayload: Equatable, Sendable {
    let report: String
    let screenshotJPEG: Data

    var activityItems: [Any] {
        var items: [Any] = [report]
        if let image = UIImage(data: screenshotJPEG) {
            items.append(image)
        }
        return items
    }
}

struct PlatformBetaFeedbackSheet: View {
    let draft: PlatformBetaFeedbackDraft
    let onCancel: () -> Void
    let onFinished: () -> Void

    @State private var descriptionText: String
    @State private var reportText = ""
    @State private var fallbackMessage: String?
    @State private var usedOnDeviceModel = false
    @State private var isStructuring = false
    @State private var showingShare = false
    @State private var hasStartedInlineResponse = false

    init(
        draft: PlatformBetaFeedbackDraft,
        onCancel: @escaping () -> Void,
        onFinished: @escaping () -> Void
    ) {
        self.draft = draft
        self.onCancel = onCancel
        self.onFinished = onFinished
        _descriptionText = State(initialValue: draft.originalDescription)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    screenshot
                    if reportText.isEmpty {
                        descriptionEditor
                    } else {
                        reportEditor
                    }
                }
                .padding()
            }
            .navigationTitle(reportText.isEmpty ? "Quick beta feedback" : "Review report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if reportText.isEmpty {
                        Button("Review", action: structureReport)
                            .disabled(descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isStructuring)
                    } else {
                        Button("Share report", action: { showingShare = true })
                            .disabled(reportText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .sheet(isPresented: $showingShare) {
                PlatformBetaFeedbackActivityView(
                    payload: PlatformBetaFeedbackSharePayload(
                        report: reportText,
                        screenshotJPEG: draft.screenshotJPEG
                    ),
                    onComplete: onFinished
                )
            }
            .task {
                guard !hasStartedInlineResponse,
                      !draft.originalDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                hasStartedInlineResponse = true
                await structureReportNow()
            }
        }
    }

    private var screenshot: some View {
        Group {
            if let image = UIImage(data: draft.screenshotJPEG) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(.quaternary)
                    }
                    .accessibilityLabel("Captured app screenshot")
            }
        }
    }

    private var descriptionEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What went wrong?")
                .font(.headline)
            TextEditor(text: $descriptionText)
                .frame(minHeight: 120)
                .padding(8)
                .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("betaFeedbackDescription")
            if draft.notificationWasUnavailable {
                Label(
                    "Notifications are unavailable, so this report opened in the app instead.",
                    systemImage: "bell.slash"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            if isStructuring {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Preparing an editable report on this device...")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var reportEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                usedOnDeviceModel ? "Prepared on device" : "Original text preserved",
                systemImage: usedOnDeviceModel ? "apple.intelligence" : "text.document"
            )
            .font(.headline)
            if let fallbackMessage {
                Text(fallbackMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Text("Edit anything before sharing. The screenshot and only the diagnostics shown below leave the app.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            TextEditor(text: $reportText)
                .frame(minHeight: 280)
                .padding(8)
                .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("betaFeedbackReport")
        }
    }

    private func structureReport() {
        Task { await structureReportNow() }
    }

    @MainActor
    private func structureReportNow() async {
        guard !isStructuring else { return }
        let text = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isStructuring = true
        let report = await PlatformBetaFeedbackStructurer.live.report(
            for: text,
            diagnostics: draft.diagnostics
        )
        reportText = report.text
        fallbackMessage = report.fallbackMessage
        usedOnDeviceModel = report.usedOnDeviceModel
        isStructuring = false
    }
}

private struct PlatformBetaFeedbackActivityView: UIViewControllerRepresentable {
    let payload: PlatformBetaFeedbackSharePayload
    let onComplete: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: payload.activityItems,
            applicationActivities: nil
        )
        controller.completionWithItemsHandler = { _, completed, _, _ in
            if completed { onComplete() }
        }
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
