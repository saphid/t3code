// t3-voice-transcriber: on-device speech-to-text helper for T3 Code.
//
// Reads an audio file, transcribes it with Apple's Speech framework
// (macOS 26 SpeechAnalyzer stack), and prints a JSON result to stdout.
// The DictationTranscriber module is used rather than SpeechTranscriber
// because it is the only module that honors contextual vocabulary
// (AnalysisContext.contextualStrings), which T3 feeds with terms learned
// from the user's sessions.
//
// Commands:
//   t3-voice-transcriber status --locale en_US
//   t3-voice-transcriber install --locale en_US
//   t3-voice-transcriber transcribe --audio <file> --locale en_US [--vocab <json-file>]
//
// The vocab file is a JSON array of strings (max 100 honored, per Apple).
// Progress notes go to stderr; the single JSON result goes to stdout.

import AVFoundation
import Foundation
import Speech

struct CLIError: Error, CustomStringConvertible {
    let description: String
}

/// Hands one buffer to AVAudioConverter's pull callback exactly once.
/// The callback runs synchronously inside `convert`, so single-threaded
/// access is guaranteed; the class exists to keep the capture immutable.
final class ConversionChunk: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func take() -> AVAudioPCMBuffer? {
        defer { buffer = nil }
        return buffer
    }
}

struct TranscribeResult: Codable {
    let text: String
}

struct StatusResult: Codable {
    let supported: Bool
    let installed: Bool
    let locale: String
}

struct InstallResult: Codable {
    let installed: Bool
}

func emit(_ value: some Encodable) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func note(_ message: String) {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
}

func parseArguments(_ arguments: [String]) throws -> (command: String, options: [String: String]) {
    guard arguments.count >= 2 else {
        throw CLIError(description: "usage: t3-voice-transcriber <status|install|transcribe> [--option value ...]")
    }
    let command = arguments[1]
    var options: [String: String] = [:]
    var index = 2
    while index < arguments.count {
        let key = arguments[index]
        guard key.hasPrefix("--"), index + 1 < arguments.count else {
            throw CLIError(description: "malformed option near '\(key)'")
        }
        options[String(key.dropFirst(2))] = arguments[index + 1]
        index += 2
    }
    return (command, options)
}

func loadVocabulary(path: String?) throws -> [String] {
    guard let path else { return [] }
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    let terms = try JSONDecoder().decode([String].self, from: data)
    // Apple documents a 100-phrase ceiling across all contextual-string tags.
    return Array(terms.prefix(100))
}

@available(macOS 26.0, *)
func resolveSupportedLocale(_ identifier: String) async throws -> Locale {
    let requested = Locale(identifier: identifier)
    guard let supported = await DictationTranscriber.supportedLocale(equivalentTo: requested) else {
        throw CLIError(description: "locale '\(identifier)' is not supported for on-device dictation")
    }
    return supported
}

@available(macOS 26.0, *)
func makeTranscriber(locale: Locale) -> DictationTranscriber {
    DictationTranscriber(
        locale: locale,
        contentHints: [],
        transcriptionOptions: [],
        reportingOptions: [],
        attributeOptions: []
    )
}

@available(macOS 26.0, *)
func ensureAssets(for transcriber: DictationTranscriber) async throws {
    let status = await AssetInventory.status(forModules: [transcriber])
    switch status {
    case .installed:
        return
    case .unsupported:
        throw CLIError(description: "on-device dictation assets are unsupported on this machine")
    default:
        note("downloading dictation model assets…")
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await request.downloadAndInstall()
        }
        note("dictation model assets installed")
    }
}

@available(macOS 26.0, *)
func runStatus(options: [String: String]) async throws {
    let identifier = options["locale"] ?? Locale.current.identifier
    guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: identifier)) else {
        try emit(StatusResult(supported: false, installed: false, locale: identifier))
        return
    }
    let status = await AssetInventory.status(forModules: [makeTranscriber(locale: locale)])
    try emit(
        StatusResult(
            supported: true,
            installed: status == .installed,
            locale: locale.identifier(.bcp47)
        )
    )
}

@available(macOS 26.0, *)
func runInstall(options: [String: String]) async throws {
    let locale = try await resolveSupportedLocale(options["locale"] ?? Locale.current.identifier)
    try await ensureAssets(for: makeTranscriber(locale: locale))
    try emit(InstallResult(installed: true))
}

@available(macOS 26.0, *)
func runTranscribe(options: [String: String]) async throws {
    guard let audioPath = options["audio"] else {
        throw CLIError(description: "transcribe requires --audio <file>")
    }
    let locale = try await resolveSupportedLocale(options["locale"] ?? Locale.current.identifier)
    let vocabulary = try loadVocabulary(path: options["vocab"])

    let transcriber = makeTranscriber(locale: locale)
    try await ensureAssets(for: transcriber)

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    if !vocabulary.isEmpty {
        let context = AnalysisContext()
        context.contextualStrings = [.general: vocabulary]
        try await analyzer.setContext(context)
        note("using \(vocabulary.count) contextual vocabulary terms")
    }

    guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
        throw CLIError(description: "no compatible audio format for the dictation module")
    }

    let file = try AVAudioFile(forReading: URL(fileURLWithPath: audioPath))
    guard let converter = AVAudioConverter(from: file.processingFormat, to: analyzerFormat) else {
        throw CLIError(description: "cannot convert \(file.processingFormat) to \(analyzerFormat)")
    }
    // Priming would inject converter latency into the audio timeline and
    // shift result timestamps.
    converter.primeMethod = .none

    let (inputSequence, inputBuilder) = AsyncStream<AnalyzerInput>.makeStream()

    let collector = Task {
        var pieces: [String] = []
        for try await result in transcriber.results where result.isFinal {
            pieces.append(String(result.text.characters))
        }
        return pieces
    }

    let feeder = Task {
        defer { inputBuilder.finish() }
        let readCapacity: AVAudioFrameCount = 8192
        guard let readBuffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: readCapacity) else {
            throw CLIError(description: "cannot allocate read buffer")
        }
        while file.framePosition < file.length {
            try file.read(into: readBuffer, frameCount: readCapacity)
            if readBuffer.frameLength == 0 { break }
            let ratio = analyzerFormat.sampleRate / file.processingFormat.sampleRate
            let outCapacity = AVAudioFrameCount((Double(readBuffer.frameLength) * ratio).rounded(.up) + 64)
            guard let outBuffer = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: outCapacity) else {
                throw CLIError(description: "cannot allocate conversion buffer")
            }
            var conversionError: NSError?
            let chunk = ConversionChunk(buffer: readBuffer)
            let conversionStatus = converter.convert(to: outBuffer, error: &conversionError) { _, status in
                guard let buffer = chunk.take() else {
                    status.pointee = .noDataNow
                    return nil
                }
                status.pointee = .haveData
                return buffer
            }
            if let conversionError {
                throw CLIError(description: "audio conversion failed: \(conversionError.localizedDescription)")
            }
            if conversionStatus == .error {
                throw CLIError(description: "audio conversion failed")
            }
            if outBuffer.frameLength > 0 {
                inputBuilder.yield(AnalyzerInput(buffer: outBuffer))
            }
        }

        // Rate conversion holds tail frames internally; without an explicit
        // end-of-stream drain the final phoneme can be clipped.
        var drained = false
        while !drained {
            guard let tail = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: 8192) else {
                break
            }
            var drainError: NSError?
            let drainStatus = converter.convert(to: tail, error: &drainError) { _, outStatus in
                outStatus.pointee = .endOfStream
                return nil
            }
            if drainError != nil || drainStatus == .error { break }
            if tail.frameLength > 0 {
                inputBuilder.yield(AnalyzerInput(buffer: tail))
            }
            drained = drainStatus == .endOfStream || tail.frameLength == 0
        }
    }

    let pieces: [String]
    do {
        try await analyzer.start(inputSequence: inputSequence)
        try await feeder.value
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        pieces = try await collector.value
    } catch {
        collector.cancel()
        await analyzer.cancelAndFinishNow()
        throw error
    }

    let text = pieces
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    try emit(TranscribeResult(text: text))
}

let parsed: (command: String, options: [String: String])
do {
    parsed = try parseArguments(CommandLine.arguments)
} catch {
    note("\(error)")
    exit(2)
}

guard #available(macOS 26.0, *) else {
    note("t3-voice-transcriber requires macOS 26 or later")
    exit(3)
}

do {
    switch parsed.command {
    case "status":
        try await runStatus(options: parsed.options)
    case "install":
        try await runInstall(options: parsed.options)
    case "transcribe":
        try await runTranscribe(options: parsed.options)
    default:
        throw CLIError(description: "unknown command '\(parsed.command)'")
    }
} catch {
    note("\(error)")
    exit(1)
}
