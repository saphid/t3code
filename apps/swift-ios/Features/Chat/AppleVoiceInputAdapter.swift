import AVFoundation
import Foundation
import Speech

@MainActor
enum FeatureVoiceInputAdapterFactory {
    static var isSupported: Bool {
        if #available(iOS 26.0, *) { return SpeechTranscriber.isAvailable }
        return false
    }

    static func make() -> any FeatureVoiceInputAdapter {
        if #available(iOS 26.0, *) {
            return AppleVoiceInputAdapter()
        }
        return UnsupportedVoiceInputAdapter()
    }
}

@MainActor
private final class UnsupportedVoiceInputAdapter: FeatureVoiceInputAdapter {
    let isSupported = false
    let localeIdentifier = Locale.current.identifier

    func prepare(configuration: FeatureVoiceInputConfiguration) async throws {}
    func requestMicrophonePermission() async -> FeatureVoiceMicrophonePermission { .denied }
    func startRecording(maximumDuration: TimeInterval) throws {}
    func stopRecording() async throws -> URL { throw AppleVoiceInputError.unavailable }
    func transcribe(recordingURL: URL) async throws -> String {
        throw AppleVoiceInputError.unavailable
    }
    func cancelTranscription() async {}
    func cleanup() async {}
}

private enum AppleVoiceInputError: Error {
    case unavailable
    case unsupportedLocale
    case recordingFailed
}

private struct AppleVoiceAudioSessionConfiguration {
    let category: AVAudioSession.Category
    let mode: AVAudioSession.Mode
    let options: AVAudioSession.CategoryOptions
}

@available(iOS 26.0, *)
@MainActor
private final class AppleVoiceInputAdapter: FeatureVoiceInputAdapter {
    private let audioSession = AVAudioSession.sharedInstance()
    private let fileManager = FileManager.default
    @MainActor
    private enum Transcriber {
        case dictation(DictationTranscriber)
        case general(SpeechTranscriber)

        var module: any SpeechModule {
            switch self {
            case let .dictation(transcriber): transcriber
            case let .general(transcriber): transcriber
            }
        }

        func collectSegments() async throws -> [String] {
            var segments: [String] = []
            switch self {
            case let .dictation(transcriber):
                for try await result in transcriber.results where result.isFinal {
                    segments.append(String(result.text.characters))
                }
            case let .general(transcriber):
                for try await result in transcriber.results where result.isFinal {
                    segments.append(String(result.text.characters))
                }
            }
            return segments
        }
    }

    private var transcriber: Transcriber?
    private var contextualVocabulary: [String] = []
    private var analyzer: SpeechAnalyzer?
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var ownedRecordingURLs = Set<URL>()
    private var previousAudioSessionConfiguration: AppleVoiceAudioSessionConfiguration?
    private var audioSessionWasConfigured = false

    var isSupported: Bool { SpeechTranscriber.isAvailable }
    private(set) var localeIdentifier = Locale.current.identifier

    func prepare(configuration: FeatureVoiceInputConfiguration) async throws {
        guard SpeechTranscriber.isAvailable else { throw AppleVoiceInputError.unavailable }
        let transcriber: Transcriber
        let locale: Locale
        switch configuration.engine {
        case .dictation:
            guard let supported = await DictationTranscriber.supportedLocale(
                equivalentTo: Locale.current
            ) else {
                throw AppleVoiceInputError.unsupportedLocale
            }
            locale = supported
            transcriber = .dictation(DictationTranscriber(
                locale: locale,
                contentHints: [],
                transcriptionOptions: [],
                reportingOptions: [],
                attributeOptions: []
            ))
            contextualVocabulary = configuration.vocabulary
        case .general:
            guard let supported = await SpeechTranscriber.supportedLocale(
                equivalentTo: Locale.current
            ) else {
                throw AppleVoiceInputError.unsupportedLocale
            }
            locale = supported
            transcriber = .general(SpeechTranscriber(locale: locale, preset: .transcription))
            contextualVocabulary = []
        }
        if let request = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber.module]
        ) {
            try await request.downloadAndInstall()
        }
        self.transcriber = transcriber
        localeIdentifier = locale.identifier
    }

    func requestMicrophonePermission() async -> FeatureVoiceMicrophonePermission {
        let granted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        return granted ? .granted : .denied
    }

    func startRecording(maximumDuration: TimeInterval) throws {
        let url = fileManager.temporaryDirectory
            .appendingPathComponent("t3-voice-\(UUID().uuidString)")
            .appendingPathExtension("m4a")
        ownedRecordingURLs.insert(url)
        recordingURL = url

        previousAudioSessionConfiguration = AppleVoiceAudioSessionConfiguration(
            category: audioSession.category,
            mode: audioSession.mode,
            options: audioSession.categoryOptions
        )
        do {
            try audioSession.setCategory(.record, mode: .measurement)
            audioSessionWasConfigured = true
            try audioSession.setActive(true)
            let recorder = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ])
            recorder.prepareToRecord()
            guard recorder.record(forDuration: maximumDuration) else {
                throw AppleVoiceInputError.recordingFailed
            }
            self.recorder = recorder
        } catch {
            restoreAudioSession()
            throw error
        }
    }

    func stopRecording() async throws -> URL {
        guard let recordingURL else { throw AppleVoiceInputError.recordingFailed }
        recorder?.stop()
        recorder = nil
        restoreAudioSession()
        return recordingURL
    }

    func transcribe(recordingURL: URL) async throws -> String {
        guard let transcriber else { throw AppleVoiceInputError.unavailable }
        let audioFile = try AVAudioFile(forReading: recordingURL)
        let analyzer = SpeechAnalyzer(modules: [transcriber.module])
        self.analyzer = analyzer

        let collector = Task { try await transcriber.collectSegments() }

        do {
            if !contextualVocabulary.isEmpty {
                let context = AnalysisContext()
                context.contextualStrings = [.general: contextualVocabulary]
                try await analyzer.setContext(context)
            }
            try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
            let segments = try await collector.value
            if self.analyzer === analyzer { self.analyzer = nil }
            return segments.joined(separator: " ").trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        } catch {
            collector.cancel()
            await analyzer.cancelAndFinishNow()
            _ = try? await collector.value
            if self.analyzer === analyzer { self.analyzer = nil }
            throw error
        }
    }

    func cancelTranscription() async {
        await analyzer?.cancelAndFinishNow()
    }

    func cleanup() async {
        recorder?.stop()
        recorder = nil
        restoreAudioSession()
        if let analyzer {
            await analyzer.cancelAndFinishNow()
            self.analyzer = nil
        }
        for url in ownedRecordingURLs {
            try? fileManager.removeItem(at: url)
        }
        ownedRecordingURLs.removeAll()
        recordingURL = nil
        transcriber = nil
        contextualVocabulary = []
    }

    private func restoreAudioSession() {
        guard let previousAudioSessionConfiguration else { return }
        guard audioSessionWasConfigured else {
            self.previousAudioSessionConfiguration = nil
            return
        }
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        try? audioSession.setCategory(
            previousAudioSessionConfiguration.category,
            mode: previousAudioSessionConfiguration.mode,
            options: previousAudioSessionConfiguration.options
        )
        self.previousAudioSessionConfiguration = nil
        audioSessionWasConfigured = false
    }
}
