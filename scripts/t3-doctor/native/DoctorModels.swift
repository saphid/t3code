import Foundation

enum JSONValue: Codable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let result = try? value.decode(Bool.self) { self = .bool(result) }
        else if let result = try? value.decode(Double.self) { self = .number(result) }
        else if let result = try? value.decode(String.self) { self = .string(result) }
        else if let result = try? value.decode([String: JSONValue].self) { self = .object(result) }
        else { self = .array(try value.decode([JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let result): try value.encode(result)
        case .array(let result): try value.encode(result)
        case .string(let result): try value.encode(result)
        case .number(let result): try value.encode(result)
        case .bool(let result): try value.encode(result)
        case .null: try value.encodeNil()
        }
    }

    subscript(key: String) -> JSONValue {
        if case .object(let object) = self { return object[key] ?? .null }
        return .null
    }
    var text: String? { if case .string(let value) = self { return value }; return nil }
    var scalarText: String? {
        switch self {
        case .string(let value): value.isEmpty ? nil : value
        case .number(let value): value.rounded() == value ? String(format: "%.0f", value) : String(value)
        case .bool(let value): value ? "Yes" : "No"
        default: nil
        }
    }
    var fields: [String: JSONValue] { if case .object(let value) = self { return value }; return [:] }
    var list: [JSONValue] { if case .array(let value) = self { return value }; return [] }
    var pretty: String {
        if let text { return text }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? String(data: encoder.encode(self), encoding: .utf8)) ?? "Unavailable"
    }
}

struct EvidenceFact: Identifiable {
    let label: String
    let value: String
    var id: String { label }
}

struct EvidenceSummary {
    let facts: [EvidenceFact]
    let nextStep: String
}

func evidenceSummary(kind: String, evidence: JSONValue) -> EvidenceSummary {
    var facts: [EvidenceFact] = []
    func add(_ label: String, _ key: String, from source: JSONValue? = nil) {
        guard let value = (source ?? evidence)[key].scalarText else { return }
        let display = key.hasSuffix("_at") && parseDate(value) != nil
            ? parseDate(value)!.formatted(date: .abbreviated, time: .standard) : value
        facts.append(EvidenceFact(label: label, value: display))
    }
    let nextStep: String
    if kind.hasPrefix("provider") {
        add("Provider", "name"); add("Runtime", "driver"); add("Installed version", "version")
        let auth = evidence["auth"].text
        if let auth { facts.append(EvidenceFact(label: "Authentication", value: auth == "unknown" ? "Not verified by T3" : auth.capitalized)) }
        add("Executable available", "binary_found"); add("Active runs", "active_runs"); add("T3 last checked", "checked_at")
        nextStep = auth == "unknown" ? "Check whether the provider can actually run and whether T3's authentication probe supports this configuration. An unverified probe is not proof of a login failure." : "Check the provider's current status and the reported error, then look for a configuration fix or an existing provider-adapter change."
    } else if kind == "app-update" {
        add("Component", "name"); add("Installed version", "installed_version"); add("Published version", "latest_version")
        add("Repository", "repository"); add("Release channel", "channel"); add("Last release check", "checked_at")
        nextStep = "Compare the exact running build with relevant upstream and fork changes. A newer release is useful only if it includes the fixes you need."
    } else if kind == "quiet-run" {
        let run = evidence["run"].fields.isEmpty ? evidence : evidence["run"]
        add("Thread", "title", from: run); add("State", "status", from: run)
        add("Provider", run["provider"].text == nil ? "provider_name" : "provider", from: run)
        if case .number(let seconds) = run["quiet_seconds"] { facts.append(EvidenceFact(label: "No recorded progress for", value: elapsed(seconds))) }
        add("Last progress", "last_progress_at", from: run); add("Requested", "requested_at", from: run)
        nextStep = "Check the last tool or provider activity and whether the process is still working. Silence alone cannot distinguish a slow command from a stuck turn."
    } else if kind == "orphaned-run" {
        let run = evidence["run"]
        add("Thread", "title", from: run); add("State", "status", from: run)
        add("Provider", "provider", from: run); add("Started", "started_at", from: run)
        add("Startup attempts", "attempt_count", from: evidence["failed_start"])
        add("Startup error", "last_error", from: evidence["failed_start"])
        nextStep = "The run has no recorded provider turn. Inspect the startup error, interrupt the stranded run through T3, and check whether the running build includes the startup recovery fix."
    } else if kind == "overdue-worker" {
        add("Worker task", "effect_type"); add("State", "status"); add("Attempts", "attempt_count")
        add("Available since", "available_at"); add("Lease expiry", "lease_expires_at"); add("Last change", "updated_at"); add("Last error", "last_error")
        nextStep = "Inspect the worker's last error and lease, then check whether a worker recovery fix exists but is missing from this build."
    } else {
        add("State", "state"); add("Port", "port"); add("Process", "pid"); add("Error", "error")
        nextStep = "Verify the condition against the current environment and compare it with the captured observation before changing anything."
    }
    return EvidenceSummary(facts: facts, nextStep: nextStep)
}

func parseDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}

func elapsed(_ seconds: Double?) -> String {
    guard let seconds, seconds.isFinite else { return "Unknown" }
    let value = Int(max(0, seconds))
    if value < 60 { return "\(value)s" }
    if value < 3600 { return "\(value / 60)m \(value % 60)s" }
    return "\(value / 3600)h \(value % 3600 / 60)m"
}

struct RuntimeRequest: Decodable, Sendable {
    let kind: String?
}

struct WatchedRun: Decodable, Identifiable, Sendable {
    let threadId: String
    let runId: String?
    let activeTurnId: String?
    let title: String?
    let provider: String?
    let providerName: String?
    let status: String?
    let requestedAt: String?
    let updatedAt: String?
    let lastProgressAt: String?
    let quietSeconds: Double?
    let waitingFor: String?
    let requests: [RuntimeRequest]?
    let pendingApprovalCount: Int?
    let pendingUserInputCount: Int?
    var id: String { runId ?? "\(threadId):\(activeTurnId ?? "")" }
    var displayTitle: String { title ?? "Untitled thread" }
    var displayProvider: String { provider ?? providerName ?? "Unknown provider" }
    var waitingReason: String {
        if let waitingFor { return "Waiting for \(waitingFor)" }
        if let requests, !requests.isEmpty {
            return "Waiting for " + Set(requests.compactMap(\.kind)).sorted().joined(separator: ", ").replacingOccurrences(of: "_", with: " ")
        }
        if (pendingApprovalCount ?? 0) > 0 { return "Waiting for approval" }
        if (pendingUserInputCount ?? 0) > 0 { return "Waiting for your answer" }
        return "Waiting"
    }
}

struct RelatedMatch: Decodable, Identifiable, Sendable {
    let fingerprint: String
    let score: Double
    let threadId: String
    let title: String
    let reason: String
    var id: String { fingerprint }
}

struct RelatedAssessment: Decodable, Sendable {
    let checkedAt: String
    let compared: Int
    let matches: [RelatedMatch]
    let model: String?
}

struct InvestigationLink: Decodable, Sendable {
    let threadId: String?
    let title: String?
    let projectTitle: String?
    let stage: String?
    let promptSha256: String?
}

struct IncidentTriage: Decodable, Sendable {
    let status: String
    let assignee: String?
    let note: String?
    let updatedAt: String?
    var needsAttention: Bool { !["assigned", "in_progress", "dismissed"].contains(status) }
    var label: String {
        switch status {
        case "assigned": "Assigned"
        case "in_progress": "In progress"
        case "dismissed": "Dismissed"
        default: "Needs attention"
        }
    }
}

func findingTitle(kind: String, evidence: JSONValue, reason: String) -> String {
    switch kind {
    case "app-update": return "New version available"
    case "quiet-run":
        let run = evidence["run"].fields.isEmpty ? evidence : evidence["run"]
        if ["queued", "preparing", "starting"].contains(run["status"].text ?? "") { return "Run is taking too long to start" }
        if case .number(let seconds) = run["quiet_seconds"] { return "No progress recorded for \(elapsed(seconds))" }
        return "No progress recorded"
    case "orphaned-run": return "Run is marked running without a provider turn"
    case "overdue-worker": return "Background task has not advanced"
    case "server-unreachable": return "T3 server is unreachable"
    case "monitor-unavailable": return "Doctor cannot read T3 state"
    default:
        if kind.hasPrefix("provider-") {
            if evidence["binary_found"].scalarText == "No" || evidence["installed"].scalarText == "No" { return "Provider executable unavailable" }
            if evidence["auth"].text == "unauthenticated" { return "Provider needs sign-in" }
            if kind == "provider-warning", evidence["auth"].text == "unknown" { return "Provider authentication not verified" }
            return kind == "provider-error" ? "Provider reported an error" : "Provider reported a warning"
        }
        return reason
    }
}

struct Finding: Decodable, Identifiable, Sendable {
    let key: String
    let kind: String
    let reason: String
    let threadId: String?
    let evidence: JSONValue?
    let fingerprint: String?
    let triage: IncidentTriage?
    let investigation: InvestigationLink?
    let related: RelatedAssessment?
    let duplicateOf: String?
    var id: String { key }
    var title: String { findingTitle(kind: kind, evidence: evidence ?? .null, reason: reason) }
    var subject: String? { evidence?["run"]["title"].text ?? evidence?["title"].text ?? evidence?["name"].text }
    func matches(_ run: WatchedRun) -> Bool {
        if let runId = evidence?["run"]["run_id"].text { return run.runId == runId }
        return threadId == run.threadId
    }
}

struct Observation: Decodable, Sendable {
    struct Server: Decodable, Sendable { let state: String }
    struct Monitoring: Decodable, Sendable { let interval: Double; let quiet: Double; let startup: Double }
    struct Incident: Decodable, Sendable {
        let report: String?
        let fingerprint: String?
        let triage: IncidentTriage?
    }
    let checkedAt: String
    let schema: String?
    let server: Server?
    let active: [WatchedRun]
    let waiting: [WatchedRun]
    private let findings: [Finding]
    var currentFindings: [Finding] { findings.filter { $0.kind != "app-update" && !$0.key.hasPrefix("update:") } }
    let monitoring: Monitoring?
    let incidents: [String: Incident]?
    let providers: [ProviderHealth]?
    let providerErrors: [String]?
    let updates: [AppVersionCheck]?
    let updateErrors: [String]?
    var runs: [WatchedRun] { active + waiting }
    private var handling: [String: Bool] {
        var values: [String: Bool] = [:]
        for (key, incident) in incidents ?? [:] where !key.hasPrefix("update:") { values[incident.fingerprint ?? key] = incident.triage?.needsAttention ?? true }
        for finding in currentFindings { values[finding.fingerprint ?? finding.key] = finding.triage?.needsAttention ?? true }
        return values
    }
    var attention: Int { handling.values.filter { $0 }.count }
    var handled: Int { handling.values.filter { !$0 }.count }
    var unavailable: Bool { findings.contains { $0.kind == "monitor-unavailable" } }
    func isStale(at date: Date) -> Bool {
        guard let checked = parseDate(checkedAt) else { return true }
        return date.timeIntervalSince(checked) > max(90, (monitoring?.interval ?? 30) * 3)
    }
}

struct ProviderHealth: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let driver: String
    let enabled: Bool
    let state: String
    let installed: Bool?
    let version: String?
    let auth: String
    let checkedAt: String?
    let observedAt: String?
    let binaryFound: Bool?
    let message: String
    let source: String
    let activeRuns: Int?
}

struct AppVersionCheck: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let state: String
    let installedVersion: String?
    let latestVersion: String?
    let repository: String?
    let channel: String?
    let checkedAt: String?
    let nextCheckAt: String?
    let releaseUrl: String?
    let path: String?
    let message: String
    let releasesBehind: Int?
    let releasesBehindExact: Bool?
    let releaseDistanceNote: String?
    let sourceCommit: String?
    let commitStatus: String?
    let commitsBehind: Int?
    let commitsAhead: Int?
    let commitDistanceNote: String?
    let comparisonUrl: String?
    var statusTitle: String {
        if commitStatus == "diverged" { return "Build histories differ" }
        if commitStatus == "identical" { return "Source matches latest release" }
        if commitStatus == "ahead", let commitsBehind { return "\(commitsBehind) commits behind" }
        if commitStatus == "behind", let commitsAhead { return "\(commitsAhead) commits ahead" }
        switch state {
        case "current": return "Up to date"
        case "ahead": return "Newer than published release"
        case "update_available": return "New version available"
        case "release_available": return "Different release channel"
        default: return "Version status unavailable"
        }
    }
    var releaseDistance: String {
        guard let releasesBehind else { return "Not comparable" }
        return (releasesBehindExact == false ? "At least " : "") + "\(releasesBehind) releases behind"
    }
    var commitDistance: String {
        guard let commitsBehind, let commitsAhead else { return "Unknown" }
        if commitStatus == "diverged" { return "\(commitsBehind) only in published build; \(commitsAhead) only in installed build" }
        return "\(commitsBehind) behind · \(commitsAhead) ahead"
    }
}

struct IncidentSummary: Identifiable, Sendable {
    let id: String
    let key: String
    let title: String
    let subject: String?
    let kind: String
    let reason: String
    let threadId: String?
    let detectedAt: String?
    let resolvedAt: String?
    let fileURL: URL
    let fingerprint: String?
    let triage: IncidentTriage?
    let investigation: InvestigationLink?
    let related: RelatedAssessment?
    let duplicateOf: String?
    var handlingLabel: String { resolved ? "Cleared" : triage?.label ?? "Needs attention" }
    var needsAttention: Bool { !resolved && (triage?.needsAttention ?? true) }
    var resolved: Bool { resolvedAt != nil }
}

struct DoctorSnapshot: Sendable {
    var observation: Observation?
    var reports: [IncidentSummary] = []
    var error: String?
    var reportErrors: [String] = []
    var readAt = Date()
}

actor DoctorRepository {
    let directory: URL
    private struct CachedReport: Sendable {
        let modified: Date?
        let size: Int?
        let summary: IncidentSummary
    }
    private var cache: [String: CachedReport] = [:]

    init(directory: URL) { self.directory = directory }

    func read() -> DoctorSnapshot {
        var snapshot = DoctorSnapshot()
        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            snapshot.observation = try decoder.decode(Observation.self, from: Data(contentsOf: directory.appendingPathComponent("status.json")))
        } catch { snapshot.error = "Cannot read the doctor's observations. \(error.localizedDescription)" }
        let reportsDirectory = directory.appendingPathComponent("incidents", isDirectory: true)
        do {
            let files = try FileManager.default.contentsOfDirectory(at: reportsDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isSymbolicLinkKey])
            var present = Set<String>()
            for file in files.sorted(by: { $0.lastPathComponent > $1.lastPathComponent }) {
                guard file.lastPathComponent.range(of: #"^[0-9]{8}T[0-9]{6}-[a-f0-9]{16}\.json$"#, options: .regularExpression) != nil else { continue }
                do {
                    let values = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey, .isSymbolicLinkKey])
                    guard values.isSymbolicLink != true else { continue }
                    present.insert(file.lastPathComponent)
                    if let cached = cache[file.lastPathComponent], cached.modified == values.contentModificationDate, cached.size == values.fileSize {
                        snapshot.reports.append(cached.summary)
                        continue
                    }
                    let report = try Self.readReport(file)
                    guard let kind = report["kind"].text, let reason = report["reason"].text else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    guard kind != "app-update", report["key"].text?.hasPrefix("update:") != true else { continue }
                    let subject = report["evidence"]["run"]["title"].text ?? report["evidence"]["title"].text ?? report["evidence"]["name"].text
                    let title = findingTitle(kind: kind, evidence: report["evidence"], reason: reason)
                    let summary = IncidentSummary(id: file.lastPathComponent, key: report["key"].text ?? file.lastPathComponent,
                        title: title, subject: subject, kind: kind, reason: reason, threadId: report["thread_id"].text,
                        detectedAt: report["detected_at"].text, resolvedAt: report["resolved_at"].text, fileURL: file,
                        fingerprint: report["fingerprint"].text,
                        triage: try? Self.decodeMetadata(IncidentTriage.self, report["triage"]),
                        investigation: try? Self.decodeMetadata(InvestigationLink.self, report["investigation"]),
                        related: try? Self.decodeMetadata(RelatedAssessment.self, report["related"]), duplicateOf: report["duplicate_of"].text)
                    cache[file.lastPathComponent] = CachedReport(modified: values.contentModificationDate, size: values.fileSize, summary: summary)
                    snapshot.reports.append(summary)
                } catch { snapshot.reportErrors.append("\(file.lastPathComponent): \(error.localizedDescription)") }
            }
            cache = cache.filter { present.contains($0.key) }
        } catch { snapshot.reportErrors.append("Cannot read incident history. \(error.localizedDescription)") }
        return snapshot
    }

    static func decodeMetadata<T: Decodable>(_ type: T.Type, _ value: JSONValue) throws -> T {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(type, from: JSONEncoder().encode(value))
    }

    static func readReport(_ url: URL) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    }
}
