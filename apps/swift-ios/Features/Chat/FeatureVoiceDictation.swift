import AVFoundation
import Foundation
import Observation
import Speech

/// Drives push-to-talk dictation in the composer with Apple's on-device
/// speech stack. The DictationTranscriber module is used rather than
/// SpeechTranscriber because it is the only module that honors contextual
/// vocabulary (AnalysisContext.contextualStrings), which carries terms
/// learned from the user's sessions.
///
/// The model is deployable on iOS 17 (the app's target); the engine behind
/// it requires iOS 26 and the availability split keeps the 26-only types out
/// of stored properties.
@MainActor
@Observable
final class FeatureVoiceDictationModel {
    enum Phase: Equatable {
        case idle
        case preparing
        case downloadingModel
        case recording
        case stopping
    }

    private(set) var phase: Phase = .idle
    /// In-progress hypothesis for the current utterance; replaced continually
    /// until the recognizer finalizes it.
    private(set) var volatileText = ""
    private(set) var errorMessage: String?

    private var engineBox: AnyObject?
    private var startTask: Task<Void, Never>?
    private var autoStopTask: Task<Void, Never>?
    private var interruptionObserver: (any NSObjectProtocol)?

    /// Recordings stop themselves after five minutes; dictation is for
    /// composing messages, not meetings.
    static let maximumDuration: Duration = .seconds(5 * 60)

    static var isSupported: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    var isRecording: Bool { phase == .recording }
    var isBusy: Bool { phase == .preparing || phase == .downloadingModel || phase == .stopping }

    /// Starts recording and streams finalized transcript segments to
    /// `onText`. Vocabulary is applied both as recognizer context and as a
    /// post-recognition correction pass.
    func start(vocabulary: [String], onText: @escaping (String) -> Void) {
        guard phase == .idle, startTask == nil else { return }
        errorMessage = nil
        volatileText = ""

        guard #available(iOS 26.0, *) else {
            errorMessage = "Voice dictation needs iOS 26 or later."
            return
        }

        phase = .preparing
        startTask = Task { @MainActor [weak self] in
            defer { self?.startTask = nil }
            let granted = await AVAudioApplication.requestRecordPermission()
            guard let self, !Task.isCancelled else { return }
            guard granted else {
                errorMessage = "Allow microphone access for T3 Code in Settings."
                phase = .idle
                return
            }

            let engine = FeatureVoiceDictationEngine()
            engineBox = engine
            do {
                // Callbacks capture the engine weakly: the engine retains the
                // results task, which retains these closures, and a strong
                // capture would close that cycle.
                try await engine.start(
                    vocabulary: vocabulary,
                    onVolatile: { [weak self, weak engine] text in
                        guard let engine, self?.engineBox === engine else { return }
                        self?.volatileText = text
                    },
                    onFinal: { [weak self, weak engine] text in
                        guard let engine, self?.engineBox === engine else { return }
                        self?.volatileText = ""
                        let corrected = FeatureVoiceVocabulary.applyCorrections(
                            to: text,
                            vocabulary: vocabulary
                        )
                        onText(corrected)
                    },
                    onDownloading: { [weak self, weak engine] in
                        guard let engine, self?.engineBox === engine else { return }
                        self?.phase = .downloadingModel
                    }
                )
                guard !Task.isCancelled, engineBox === engine else {
                    await engine.cancel()
                    return
                }
                phase = .recording
                observeInterruptions()
                autoStopTask = Task { [weak self] in
                    try? await Task.sleep(for: Self.maximumDuration)
                    guard !Task.isCancelled else { return }
                    self?.stop()
                }
            } catch {
                // The engine tears its partial state down before throwing;
                // cancel() here is an idempotent belt-and-braces pass.
                await engine.cancel()
                guard engineBox === engine else { return }
                engineBox = nil
                phase = .idle
                if !(error is CancellationError) {
                    errorMessage = Self.friendlyMessage(for: error)
                }
            }
        }
    }

    /// Stops recording and finalizes; remaining segments flush through
    /// `onText` before the phase returns to idle.
    func stop() {
        guard #available(iOS 26.0, *),
              let engine = engineBox as? FeatureVoiceDictationEngine,
              phase == .recording else {
            cancel()
            return
        }
        phase = .stopping
        stopObservingInterruptions()
        autoStopTask?.cancel()
        autoStopTask = nil
        Task { @MainActor in
            await engine.finishAndFlush()
            guard engineBox === engine else { return }
            engineBox = nil
            volatileText = ""
            phase = .idle
        }
    }

    /// Abandons the recording and discards any pending transcript. Safe to
    /// call in any phase, including mid-startup: the startup task observes
    /// its cancellation at the next suspension and tears the engine down.
    func cancel() {
        startTask?.cancel()
        startTask = nil
        autoStopTask?.cancel()
        autoStopTask = nil
        stopObservingInterruptions()
        volatileText = ""
        let box = engineBox
        engineBox = nil
        guard #available(iOS 26.0, *), let engine = box as? FeatureVoiceDictationEngine else {
            phase = .idle
            return
        }
        // Hold .stopping until teardown completes so a new recording cannot
        // race the old engine's audio-session deactivation.
        phase = .stopping
        Task { @MainActor in
            await engine.cancel()
            if phase == .stopping, engineBox == nil {
                phase = .idle
            }
        }
    }

    /// Phone calls, Siri, and other recorders interrupt the audio session;
    /// keep what was said instead of pretending the mic is still live.
    private func observeInterruptions() {
        stopObservingInterruptions()
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.stop()
            }
        }
    }

    private func stopObservingInterruptions() {
        if let interruptionObserver {
            NotificationCenter.default.removeObserver(interruptionObserver)
        }
        interruptionObserver = nil
    }

    private static func friendlyMessage(for error: Error) -> String {
        if let dictationError = error as? FeatureVoiceDictationError {
            return dictationError.message
        }
        return "Dictation could not start."
    }
}

struct FeatureVoiceDictationError: Error {
    let message: String
}

/// One-shot handoff of a converted buffer to AVAudioConverter's pull
/// callback. The callback runs synchronously inside `convert`.
private final class FeatureVoiceConversionChunk: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func take() -> AVAudioPCMBuffer? {
        defer { buffer = nil }
        return buffer
    }
}

@available(iOS 26.0, *)
@MainActor
final class FeatureVoiceDictationEngine {
    private let audioEngine = AVAudioEngine()
    private var analyzer: SpeechAnalyzer?
    private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var tapInstalled = false
    private var sessionActive = false

    func start(
        vocabulary: [String],
        onVolatile: @escaping @MainActor (String) -> Void,
        onFinal: @escaping @MainActor (String) -> Void,
        onDownloading: @escaping @MainActor () -> Void
    ) async throws {
        do {
            try await startImpl(
                vocabulary: vocabulary,
                onVolatile: onVolatile,
                onFinal: onFinal,
                onDownloading: onDownloading
            )
        } catch {
            // Every failure path releases the mic, the session, and the
            // recognizer before the error reaches the model.
            await cancel()
            throw error
        }
    }

    private func startImpl(
        vocabulary: [String],
        onVolatile: @escaping @MainActor (String) -> Void,
        onFinal: @escaping @MainActor (String) -> Void,
        onDownloading: @escaping @MainActor () -> Void
    ) async throws {
        var resolvedLocale = await DictationTranscriber.supportedLocale(equivalentTo: Locale.current)
        if resolvedLocale == nil {
            resolvedLocale = await DictationTranscriber.supportedLocale(
                equivalentTo: Locale(identifier: "en_US")
            )
        }
        guard let locale = resolvedLocale else {
            throw FeatureVoiceDictationError(
                message: "On-device dictation does not support this language yet."
            )
        }
        try Task.checkCancellation()

        let transcriber = DictationTranscriber(
            locale: locale,
            contentHints: [],
            transcriptionOptions: [],
            reportingOptions: [.volatileResults],
            attributeOptions: []
        )

        let assetStatus = await AssetInventory.status(forModules: [transcriber])
        try Task.checkCancellation()
        switch assetStatus {
        case .installed:
            break
        case .unsupported:
            throw FeatureVoiceDictationError(
                message: "On-device dictation is unsupported on this device."
            )
        default:
            onDownloading()
            if let request = try await AssetInventory.assetInstallationRequest(
                supporting: [transcriber]
            ) {
                try await request.downloadAndInstall()
            }
            try Task.checkCancellation()
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer
        if !vocabulary.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings = [.general: Array(vocabulary.prefix(100))]
            try await analyzer.setContext(context)
            try Task.checkCancellation()
        }

        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber]
        ) else {
            throw FeatureVoiceDictationError(message: "No compatible audio format for dictation.")
        }
        try Task.checkCancellation()

        resultsTask = Task { @MainActor in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                    if result.isFinal {
                        onFinal(text)
                    } else {
                        onVolatile(text)
                    }
                }
            } catch {
                // Cancellation and post-teardown stream errors are expected;
                // start() surfaces real startup failures.
            }
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: [])
        sessionActive = true

        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inputFormat, to: analyzerFormat) else {
            throw FeatureVoiceDictationError(message: "Microphone format is not convertible.")
        }
        // Priming would inject converter latency into the audio timeline and
        // shift result timestamps.
        converter.primeMethod = .none

        let (inputSequence, builder) = AsyncStream<AnalyzerInput>.makeStream()
        inputBuilder = builder

        let ratio = analyzerFormat.sampleRate / inputFormat.sampleRate
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
            let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up) + 64)
            guard let converted = AVAudioPCMBuffer(
                pcmFormat: analyzerFormat,
                frameCapacity: capacity
            ) else { return }
            var conversionError: NSError?
            let chunk = FeatureVoiceConversionChunk(buffer: buffer)
            let status = converter.convert(to: converted, error: &conversionError) { _, outStatus in
                guard let pending = chunk.take() else {
                    outStatus.pointee = .noDataNow
                    return nil
                }
                outStatus.pointee = .haveData
                return pending
            }
            if conversionError == nil, status != .error, converted.frameLength > 0 {
                builder.yield(AnalyzerInput(buffer: converted))
            }
        }
        tapInstalled = true

        try Task.checkCancellation()
        audioEngine.prepare()
        try audioEngine.start()
        try await analyzer.start(inputSequence: inputSequence)
    }

    /// Stops capture, finalizes recognition, and waits for the last
    /// finalized segments to be delivered.
    func finishAndFlush() async {
        teardownCapture()
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await resultsTask?.value
        analyzer = nil
        resultsTask = nil
    }

    func cancel() async {
        teardownCapture()
        await analyzer?.cancelAndFinishNow()
        resultsTask?.cancel()
        analyzer = nil
        resultsTask = nil
    }

    private func teardownCapture() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioEngine.stop()
        inputBuilder?.finish()
        inputBuilder = nil
        if sessionActive {
            sessionActive = false
            try? AVAudioSession.sharedInstance().setActive(
                false,
                options: [.notifyOthersOnDeactivation]
            )
        }
    }
}
