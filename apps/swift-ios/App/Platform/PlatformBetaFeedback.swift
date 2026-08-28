import SwiftUI
import UIKit
#if canImport(FoundationModels)
import FoundationModels
#endif

extension Notification.Name {
    static let platformBetaFeedbackResponse = Notification.Name("T3PlatformBetaFeedbackResponse")
}

enum PlatformBetaFeedbackPolicy {
    enum Distribution: Equatable, Sendable {
        case development
        case testFlight
        case appStore

        static var current: Self {
            #if DEBUG || targetEnvironment(simulator)
            .development
            #else
            if Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" {
                .testFlight
            } else {
                .appStore
            }
            #endif
        }
    }

    enum PresentationPath: Equatable {
        case notificationReply
        case inAppFallback
        case disabled
    }

    static var testFlightEnabled: Bool {
        testFlightEnabled(from: Bundle.main.object(
            forInfoDictionaryKey: "T3BetaFeedbackTestFlightEnabled"
        ))
    }

    static func testFlightEnabled(from value: Any?) -> Bool {
        if let enabled = value as? Bool { return enabled }
        guard let raw = value as? String else { return false }
        return ["1", "true", "yes"].contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static var isEnabled: Bool {
        isEnabled(
            channel: .current,
            distribution: .current,
            testFlightEnabled: testFlightEnabled
        )
    }

    static func isEnabled(
        channel: PersonalBuildChannel,
        distribution: Distribution,
        testFlightEnabled: Bool
    ) -> Bool {
        return switch channel {
        case .dev, .test:
            true
        case .upstream:
            distribution == .development
                || (distribution == .testFlight && testFlightEnabled)
        }
    }

    static func presentationPath(
        channel: PersonalBuildChannel,
        distribution: Distribution,
        testFlightEnabled: Bool,
        notificationsAvailable: Bool
    ) -> PresentationPath {
        guard isEnabled(
            channel: channel,
            distribution: distribution,
            testFlightEnabled: testFlightEnabled
        ) else { return .disabled }
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
    var annotatedScreenshotJPEG: Data?
    var markup: PlatformBetaFeedbackMarkup
    let diagnostics: PlatformBetaFeedbackDiagnostics
    var originalDescription: String
    var reportText: String
    var notificationWasUnavailable: Bool
    var savedForLater: Bool
    var usedOnDeviceModel: Bool

    init(
        id: String = UUID().uuidString,
        screenshotJPEG: Data,
        annotatedScreenshotJPEG: Data? = nil,
        markup: PlatformBetaFeedbackMarkup = PlatformBetaFeedbackMarkup(),
        diagnostics: PlatformBetaFeedbackDiagnostics,
        originalDescription: String = "",
        reportText: String = "",
        notificationWasUnavailable: Bool = false,
        savedForLater: Bool = false,
        usedOnDeviceModel: Bool = false
    ) {
        self.id = id
        self.screenshotJPEG = screenshotJPEG
        self.annotatedScreenshotJPEG = annotatedScreenshotJPEG
        self.markup = markup
        self.diagnostics = diagnostics
        self.originalDescription = originalDescription
        self.reportText = reportText
        self.notificationWasUnavailable = notificationWasUnavailable
        self.savedForLater = savedForLater
        self.usedOnDeviceModel = usedOnDeviceModel
    }

    var submissionScreenshotJPEG: Data {
        annotatedScreenshotJPEG ?? screenshotJPEG
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
    ) async throws -> PlatformBetaFeedbackReport {
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
        } catch is CancellationError {
            throw CancellationError()
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
        guard let id = userInfo[draftIDKey] as? String,
              UUID(uuidString: id) != nil else { return nil }
        return id
    }
}

struct PlatformBetaFeedbackPendingDraftState: Equatable {
    private(set) var id: String?

    mutating func replace(with newID: String) -> String? {
        let supersededID = id
        id = newID
        return supersededID
    }

    mutating func clear(ifMatching draftID: String) {
        if id == draftID { id = nil }
    }
}

actor PlatformBetaFeedbackStore {
    static let shared = PlatformBetaFeedbackStore()

    private struct Record: Codable {
        let id: String
        let diagnostics: PlatformBetaFeedbackDiagnostics
        let createdAt: Date
        let originalDescription: String?
        let reportText: String?
        let notificationWasUnavailable: Bool?
        let hasAnnotatedScreenshot: Bool?
        let markup: PlatformBetaFeedbackMarkup?
        let savedForLater: Bool?
        let usedOnDeviceModel: Bool?
    }

    struct PendingResponse: Codable, Equatable, Sendable {
        let draftID: String
        let text: String
    }

    enum StoreError: Error {
        case invalidDraftID
    }

    private let directory: URL

    init(directory: URL? = nil) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        self.directory = directory ?? support
            .appendingPathComponent("T3BetaFeedback", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
    }

    func save(_ draft: PlatformBetaFeedbackDraft) throws {
        try persist(draft, savedForLater: false)
    }

    func saveForLater(_ draft: PlatformBetaFeedbackDraft) throws {
        try persist(draft, savedForLater: true)
    }

    func load(id: String, description: String = "") throws -> PlatformBetaFeedbackDraft? {
        try Self.validate(id: id)
        let recordURL = recordURL(for: id)
        let screenshotURL = screenshotURL(for: id)
        guard FileManager.default.fileExists(atPath: recordURL.path),
              FileManager.default.fileExists(atPath: screenshotURL.path) else { return nil }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: recordURL))
        let annotatedData: Data?
        if record.hasAnnotatedScreenshot == true,
           FileManager.default.fileExists(atPath: annotatedScreenshotURL(for: id).path) {
            annotatedData = try Data(contentsOf: annotatedScreenshotURL(for: id))
        } else {
            annotatedData = nil
        }
        return PlatformBetaFeedbackDraft(
            id: record.id,
            screenshotJPEG: try Data(contentsOf: screenshotURL),
            annotatedScreenshotJPEG: annotatedData,
            markup: record.markup ?? PlatformBetaFeedbackMarkup(),
            diagnostics: record.diagnostics,
            originalDescription: description.isEmpty
                ? record.originalDescription ?? ""
                : description,
            reportText: record.reportText ?? "",
            notificationWasUnavailable: record.notificationWasUnavailable ?? false,
            savedForLater: record.savedForLater ?? false,
            usedOnDeviceModel: record.usedOnDeviceModel ?? false
        )
    }

    func loadNextResumableDraft() throws -> PlatformBetaFeedbackDraft? {
        let recordURLs = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter {
            $0.pathExtension == "json" && !$0.lastPathComponent.hasSuffix(".response.json")
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }

        for url in recordURLs {
            guard let record = try? JSONDecoder().decode(Record.self, from: Data(contentsOf: url)),
                  record.savedForLater == true else {
                continue
            }
            if let draft = try load(id: record.id) { return draft }
        }
        return nil
    }

    func remove(id: String) {
        guard Self.isValid(id: id) else { return }
        try? FileManager.default.removeItem(at: recordURL(for: id))
        try? FileManager.default.removeItem(at: screenshotURL(for: id))
        try? FileManager.default.removeItem(at: annotatedScreenshotURL(for: id))
        try? FileManager.default.removeItem(at: responseURL(for: id))
    }

    func saveResponse(draftID: String, text: String) throws {
        try Self.validate(id: draftID)
        try prepareDirectory()
        let response = PendingResponse(draftID: draftID, text: text)
        try JSONEncoder().encode(response).write(
            to: responseURL(for: draftID),
            options: [.atomic, .completeFileProtectionUnlessOpen]
        )
    }

    func loadRespondedDraft(draftID: String) throws -> PlatformBetaFeedbackDraft? {
        try Self.validate(id: draftID)
        let url = responseURL(for: draftID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let response = try JSONDecoder().decode(
            PendingResponse.self,
            from: Data(contentsOf: url)
        )
        guard response.draftID == draftID,
              let draft = try load(id: draftID, description: response.text) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        try persist(draft, savedForLater: true)
        try? FileManager.default.removeItem(at: url)
        return draft
    }

    func loadNextRespondedDraft() throws -> PlatformBetaFeedbackDraft? {
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ).filter({ $0.lastPathComponent.hasSuffix(".response.json") }).sorted(by: {
            $0.lastPathComponent < $1.lastPathComponent
        })
        for url in urls {
            let data: Data
            do {
                data = try Data(contentsOf: url)
            } catch {
                continue
            }
            guard let response = try? JSONDecoder().decode(PendingResponse.self, from: data) else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            guard Self.isValid(id: response.draftID) else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            let loaded: PlatformBetaFeedbackDraft?
            do {
                loaded = try load(id: response.draftID, description: response.text)
            } catch {
                continue
            }
            guard let draft = loaded else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            try persist(draft, savedForLater: true)
            try? FileManager.default.removeItem(at: url)
            return draft
        }
        return nil
    }

    func pruneExpired() {
        removeExpiredDrafts(now: .now)
    }

    private func recordURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).json")
    }

    private func screenshotURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).jpg")
    }

    private func annotatedScreenshotURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).annotated.jpg")
    }

    private func responseURL(for id: String) -> URL {
        directory.appendingPathComponent("\(id).response.json")
    }

    private func persist(_ draft: PlatformBetaFeedbackDraft, savedForLater: Bool) throws {
        try Self.validate(id: draft.id)
        try prepareDirectory()
        removeExpiredDrafts(now: .now)
        let record = Record(
            id: draft.id,
            diagnostics: draft.diagnostics,
            createdAt: .now,
            originalDescription: draft.originalDescription,
            reportText: draft.reportText,
            notificationWasUnavailable: draft.notificationWasUnavailable,
            hasAnnotatedScreenshot: draft.annotatedScreenshotJPEG != nil,
            markup: draft.markup,
            savedForLater: savedForLater,
            usedOnDeviceModel: draft.usedOnDeviceModel
        )
        let options: Data.WritingOptions = [.atomic, .completeFileProtectionUnlessOpen]
        let hadExistingRecord = FileManager.default.fileExists(atPath: recordURL(for: draft.id).path)
        let previousScreenshot = hadExistingRecord
            ? try? Data(contentsOf: screenshotURL(for: draft.id))
            : nil
        let previousAnnotatedScreenshot = hadExistingRecord
            ? try? Data(contentsOf: annotatedScreenshotURL(for: draft.id))
            : nil
        let hadPreviousAnnotatedScreenshot = hadExistingRecord
            && FileManager.default.fileExists(atPath: annotatedScreenshotURL(for: draft.id).path)
        try draft.screenshotJPEG.write(to: screenshotURL(for: draft.id), options: options)
        if let annotatedScreenshotJPEG = draft.annotatedScreenshotJPEG {
            try annotatedScreenshotJPEG.write(
                to: annotatedScreenshotURL(for: draft.id),
                options: options
            )
        }
        do {
            try JSONEncoder().encode(record).write(to: recordURL(for: draft.id), options: options)
            if draft.annotatedScreenshotJPEG == nil {
                try? FileManager.default.removeItem(at: annotatedScreenshotURL(for: draft.id))
            }
        } catch {
            if hadExistingRecord {
                if let previousScreenshot {
                    try? previousScreenshot.write(to: screenshotURL(for: draft.id), options: options)
                }
                if let previousAnnotatedScreenshot {
                    try? previousAnnotatedScreenshot.write(
                        to: annotatedScreenshotURL(for: draft.id),
                        options: options
                    )
                } else if hadPreviousAnnotatedScreenshot == false {
                    try? FileManager.default.removeItem(at: annotatedScreenshotURL(for: draft.id))
                }
            } else {
                try? FileManager.default.removeItem(at: screenshotURL(for: draft.id))
                try? FileManager.default.removeItem(at: annotatedScreenshotURL(for: draft.id))
            }
            throw error
        }
    }

    private func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var directory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
    }

    private static func validate(id: String) throws {
        guard isValid(id: id) else { throw StoreError.invalidDraftID }
    }

    private static func isValid(id: String) -> Bool {
        id.isEmpty == false && id.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
    }

    private func removeExpiredDrafts(now: Date) {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        for recordURL in urls where recordURL.pathExtension == "json"
            && !recordURL.lastPathComponent.hasSuffix(".response.json") {
            let record = try? JSONDecoder().decode(
                Record.self,
                from: Data(contentsOf: recordURL)
            )
            let retention: TimeInterval = record?.savedForLater == false
                ? 24 * 60 * 60
                : 30 * 24 * 60 * 60
            let cutoff = now.addingTimeInterval(-retention)
            let modified = try? recordURL.resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            let id = recordURL.deletingPathExtension().lastPathComponent
            let responseModified = try? responseURL(for: id).resourceValues(
                forKeys: [.contentModificationDateKey]
            ).contentModificationDate
            let newestActivity = [modified, responseModified].compactMap(\.self).max()
            guard let newestActivity, newestActivity < cutoff else { continue }
            remove(id: id)
        }

        guard let remaining = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }
        let recordIDs = Set(remaining.compactMap { url -> String? in
            guard url.pathExtension == "json",
                  url.lastPathComponent.hasSuffix(".response.json") == false else { return nil }
            return url.deletingPathExtension().lastPathComponent
        })
        for url in remaining {
            let name = url.lastPathComponent
            let ownerID: String?
            if name.hasSuffix(".response.json") {
                ownerID = String(name.dropLast(".response.json".count))
            } else if name.hasSuffix(".annotated.jpg") {
                ownerID = String(name.dropLast(".annotated.jpg".count))
            } else if name.hasSuffix(".jpg") {
                ownerID = String(name.dropLast(".jpg".count))
            } else {
                ownerID = nil
            }
            if let ownerID, recordIDs.contains(ownerID) == false {
                try? FileManager.default.removeItem(at: url)
            }
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

struct PlatformBetaFeedbackSharePayload: Identifiable, Equatable, Sendable {
    let id: UUID
    let report: String
    let screenshotFileURL: URL

    var activityItems: [Any] {
        [report, screenshotFileURL]
    }

    static func prepare(report: String, screenshotJPEG: Data) throws -> Self {
        guard UIImage(data: screenshotJPEG) != nil else {
            throw PlatformBetaFeedbackShareError.invalidScreenshot
        }
        let id = UUID()
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("t3-beta-feedback-share", isDirectory: true)
            .appendingPathComponent(id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUnlessOpen]
        )
        let fileURL = directory.appendingPathComponent("Annotated beta feedback.jpg")
        try screenshotJPEG.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        return Self(id: id, report: report, screenshotFileURL: fileURL)
    }

    func removeTemporaryFile() {
        try? FileManager.default.removeItem(at: screenshotFileURL.deletingLastPathComponent())
    }
}

enum PlatformBetaFeedbackShareError: LocalizedError {
    case invalidScreenshot

    var errorDescription: String? {
        "The annotated screenshot could not be prepared for sharing. The report is still saved here."
    }
}
