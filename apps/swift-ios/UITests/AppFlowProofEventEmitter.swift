import Foundation
import XCTest

/// Opt-in proof timing for cataloged XCUITest actions. The emitted files use
/// the app-flow-agent session and proof-map schemas, so recording overlays can
/// use actual action centers and one monotonic clock instead of guessed points.
@MainActor
final class AppFlowProofEventEmitter {
    static let sessionPathEnvironment = "T3_APP_FLOW_PROOF_SESSION_PATH"
    static let actionMapPathEnvironment = "T3_APP_FLOW_PROOF_ACTION_MAP_PATH"
    static let recordingStartEnvironment = "T3_APP_FLOW_PROOF_RECORDING_STARTED_AT"
    static let planEnvironment = "T3_APP_FLOW_PROOF_PLAN"
    static let testNamePlaceholder = "{test}"

    private struct Session: Codable {
        let schemaVersion = 1
        let createdAt: String
        let plan: String
        let clock: ClockIdentity
        var events: [Event] = []
    }

    private struct ClockIdentity: Codable {
        let kind = "system-uptime-anchored-wall-clock"
        let wallAnchorAt: String
        let monotonicAnchorSeconds: Double
    }

    private struct Event: Codable {
        let id: String
        let phase: String
        let at: String
        let elapsedSeconds: Double
        var selector: String?
        var action: String?
        var postcondition: String?
        var point: [Double]?
        var from: [Double]?
        var to: [Double]?
        var duration: Double?
        var actionID: String?
        var result: String?
        var observation: String?

        enum CodingKeys: String, CodingKey {
            case id, phase, at, elapsedSeconds, selector, action, postcondition
            case point, from, to, duration
            case actionID = "actionid"
            case result, observation
        }
    }

    private struct ActionMap: Codable {
        let version = 1
        let recordingStartedAt: String
        var actions: [ActionMapping] = []

        enum CodingKeys: String, CodingKey {
            case version
            case recordingStartedAt = "recording_started_at"
            case actions
        }
    }

    private struct ActionMapping: Codable {
        let actionID: String
        let at: Double
        let kind: String
        var point: [Double]?
        var from: [Double]?
        var to: [Double]?
        var duration: Double?

        enum CodingKeys: String, CodingKey {
            case actionID = "action_id"
            case at, kind, point, from, to, duration
        }
    }

    private let sessionURL: URL?
    private let actionMapURL: URL?
    private let wallAnchor: Date
    private let monotonicAnchor: TimeInterval
    private let monotonicNow: () -> TimeInterval
    private let recordingStart: Date
    private var session: Session
    private var actionMap: ActionMap

    var isEnabled: Bool { sessionURL != nil }

    init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        testName: String? = nil,
        wallAnchor: Date = Date(),
        monotonicAnchor: TimeInterval = ProcessInfo.processInfo.systemUptime,
        monotonicNow: @escaping () -> TimeInterval = {
            ProcessInfo.processInfo.systemUptime
        }
    ) {
        let sessionPath = Self.outputPath(
            environment[Self.sessionPathEnvironment],
            testName: testName
        )
        let actionMapPath = Self.outputPath(
            environment[Self.actionMapPathEnvironment],
            testName: testName
        )
        sessionURL = sessionPath.map { URL(fileURLWithPath: $0) }
        actionMapURL = actionMapPath.map { URL(fileURLWithPath: $0) }
        self.wallAnchor = wallAnchor
        self.monotonicAnchor = monotonicAnchor
        self.monotonicNow = monotonicNow
        recordingStart = environment[Self.recordingStartEnvironment]
            .flatMap(Self.parseTimestamp) ?? wallAnchor
        let anchorText = Self.timestamp(wallAnchor)
        session = Session(
            createdAt: anchorText,
            plan: environment[Self.planEnvironment] ?? "xctest-proof",
            clock: ClockIdentity(
                wallAnchorAt: anchorText,
                monotonicAnchorSeconds: monotonicAnchor
            )
        )
        actionMap = ActionMap(recordingStartedAt: Self.timestamp(recordingStart))
    }

    @discardableResult
    func recordTap(
        selector: String,
        point: CGPoint,
        postcondition: String
    ) -> String? {
        guard isEnabled else { return nil }
        let eventID = "event-\(session.events.count + 1)"
        let timing = currentTiming()
        session.events.append(
            Event(
                id: eventID,
                phase: "act",
                at: Self.timestamp(timing.wallDate),
                elapsedSeconds: timing.elapsed,
                selector: selector,
                action: "tap",
                postcondition: postcondition,
                point: [point.x, point.y]
            )
        )
        actionMap.actions.append(
            ActionMapping(
                actionID: eventID,
                at: max(0, timing.wallDate.timeIntervalSince(recordingStart)),
                kind: "tap",
                point: [point.x, point.y]
            )
        )
        persist()
        return eventID
    }

    @discardableResult
    func recordSwipe(
        selector: String,
        from: CGPoint,
        to: CGPoint,
        duration: TimeInterval,
        postcondition: String
    ) -> String? {
        guard isEnabled else { return nil }
        guard duration > 0 else {
            XCTFail("App-flow proof swipe duration must be positive")
            return nil
        }
        let eventID = "event-\(session.events.count + 1)"
        let timing = currentTiming()
        session.events.append(
            Event(
                id: eventID,
                phase: "act",
                at: Self.timestamp(timing.wallDate),
                elapsedSeconds: timing.elapsed,
                selector: selector,
                action: "swipe",
                postcondition: postcondition,
                from: [from.x, from.y],
                to: [to.x, to.y],
                duration: duration
            )
        )
        actionMap.actions.append(
            ActionMapping(
                actionID: eventID,
                at: max(0, timing.wallDate.timeIntervalSince(recordingStart)),
                kind: "swipe",
                from: [from.x, from.y],
                to: [to.x, to.y],
                duration: duration
            )
        )
        persist()
        return eventID
    }

    func recordPassed(actionID: String?, observation: String) {
        guard isEnabled, let actionID else { return }
        let timing = currentTiming()
        session.events.append(
            Event(
                id: "event-\(session.events.count + 1)",
                phase: "assert",
                at: Self.timestamp(timing.wallDate),
                elapsedSeconds: timing.elapsed,
                actionID: actionID,
                result: "passed",
                observation: observation
            )
        )
        persist()
    }

    private func currentTiming() -> (elapsed: Double, wallDate: Date) {
        let elapsed = max(0, monotonicNow() - monotonicAnchor)
        return (elapsed, wallAnchor.addingTimeInterval(elapsed))
    }

    private func persist() {
        do {
            if let sessionURL {
                try Self.write(session, to: sessionURL)
            }
            if let actionMapURL {
                try Self.write(actionMap, to: actionMapURL)
            }
        } catch {
            XCTFail("Could not write opt-in app-flow proof events: \(error)")
        }
    }

    private static func write<Value: Encodable>(_ value: Value, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(value).write(to: url, options: .atomic)
    }

    private static func timestamp(_ date: Date) -> String {
        formatter().string(from: date)
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        formatter().date(from: value)
    }

    private static func outputPath(_ value: String?, testName: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        guard value.contains(testNamePlaceholder) else { return value }
        let component = testName.map(safePathComponent) ?? "xctest"
        return value.replacingOccurrences(of: testNamePlaceholder, with: component)
    }

    private static func safePathComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "-" }
        return String(scalars)
            .replacingOccurrences(of: "--", with: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    private static func formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
