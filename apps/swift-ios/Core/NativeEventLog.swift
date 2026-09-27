import Foundation
import OSLog

/// An on-device activity log for diagnosing stuck states after the fact.
///
/// It records lifecycle events (sends, connections, draft restores), never
/// message text or credentials. Two files of up to 1 MB each keep the recent
/// history. Share it from Settings > Diagnostics, or copy
/// `Library/Application Support/Diagnostics/events.log` out of the app
/// container with `simctl get_app_container` or `devicectl device copy from`.
public final class NativeEventLog: @unchecked Sendable {
    public static let shared = NativeEventLog(
        directory: URL.applicationSupportDirectory.appending(path: "Diagnostics", directoryHint: .isDirectory)
    )

    private static let logger = Logger(subsystem: "com.t3tools.t3code", category: "Events")

    public let currentURL: URL
    public let previousURL: URL
    private let directory: URL
    private let maximumFileBytes: Int
    private let queue = DispatchQueue(label: "com.t3tools.t3code.event-log")
    private let formatter: ISO8601DateFormatter
    private var handle: FileHandle?
    private var size = 0

    public init(directory: URL, maximumFileBytes: Int = 1024 * 1024) {
        self.directory = directory
        self.maximumFileBytes = maximumFileBytes
        currentURL = directory.appending(path: "events.log")
        previousURL = directory.appending(path: "events.1.log")
        formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = .current
    }

    public func record(_ category: String, _ message: String) {
        let date = Date()
        Self.logger.log("[\(category, privacy: .public)] \(message, privacy: .public)")
        queue.async { self.append("\(self.formatter.string(from: date)) [\(category)] \(message)\n") }
    }

    /// Both files, oldest line first.
    public func contents() async -> String {
        await withCheckedContinuation { continuation in
            queue.async {
                try? self.handle?.synchronize()
                let previous = (try? String(contentsOf: self.previousURL, encoding: .utf8)) ?? ""
                let current = (try? String(contentsOf: self.currentURL, encoding: .utf8)) ?? ""
                continuation.resume(returning: previous + current)
            }
        }
    }

    public func clear() async {
        await withCheckedContinuation { continuation in
            queue.async {
                try? self.handle?.close()
                self.handle = nil
                try? FileManager.default.removeItem(at: self.previousURL)
                try? FileManager.default.removeItem(at: self.currentURL)
                continuation.resume()
            }
        }
    }

    private func append(_ line: String) {
        let data = Data(line.utf8)
        if handle == nil { open() }
        if size > 0, size + data.count > maximumFileBytes { rotate() }
        guard let handle else { return }
        do {
            try handle.write(contentsOf: data)
            size += data.count
        } catch {
            try? handle.close()
            self.handle = nil
        }
    }

    private func open() {
        let manager = FileManager.default
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        if !manager.fileExists(atPath: currentURL.path) {
            // Background reconnects log while the device is locked.
            manager.createFile(
                atPath: currentURL.path, contents: nil,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
        handle = try? FileHandle(forWritingTo: currentURL)
        size = Int((try? handle?.seekToEnd()) ?? 0)
    }

    private func rotate() {
        try? handle?.close()
        handle = nil
        try? FileManager.default.removeItem(at: previousURL)
        try? FileManager.default.moveItem(at: currentURL, to: previousURL)
        open()
    }
}
