import AppKit
import SwiftUI

struct InvestigationResult: Decodable, Sendable {
    let threadId: String?
    let title: String?
    let projectTitle: String?
    let stage: String?
    let reused: Bool?
    let error: String?
    var threads: [InvestigationResult]? = nil
}

enum InvestigationRunner {
    static func run(output: URL, finding: String?, report: String?, handling: [String]? = nil, related: [String]? = nil) throws -> InvestigationResult {
        guard let resources = Bundle.main.resourceURL,
              let python = Bundle.main.object(forInfoDictionaryKey: "DoctorPython") as? String else {
            throw CocoaError(.fileNoSuchFile)
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: python)
        var arguments = ["-B", resources.appendingPathComponent("investigate.py").path,
                         "--output", output.path, "--config", resources.appendingPathComponent("investigation-config.json").path]
        if let handling {
            arguments = ["-B", resources.appendingPathComponent("incident_tracking.py").path, "--output", output.path] + handling
        }
        if let related {
            arguments = ["-B", resources.appendingPathComponent("related_incidents.py").path, "--output", output.path,
                         "--config", resources.appendingPathComponent("investigation-config.json").path] + related
        }
        if let finding { arguments += ["--finding", finding] }
        if let report { arguments += ["--report", report] }
        process.arguments = arguments
        let resultPipe = Pipe()
        process.standardOutput = resultPipe
        // The helper emits structured, redacted failures on stdout. Keep transport warnings separate.
        process.standardError = FileHandle.nullDevice
        try process.run()
        let result = resultPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(InvestigationResult.self, from: result)
    }
}

struct InvestigateButton: View {
    @ObservedObject var store: DoctorStore
    var finding: String?
    var report: String?
    var title = "Investigate in T3 Code"
    private var key: String { report ?? finding ?? "all" }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                store.investigate(key: key, finding: finding, report: report)
            } label: {
                Label(store.investigationBusy == key ? "Starting investigation…" : title,
                      systemImage: "stethoscope")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderedProminent)
            .tint(.teal)
            .disabled(store.investigationBusy != nil)
            .help("Creates a GLM 5.3 Flash thread in T3 Code Contrib with evidence and upstream, PR, and build checks.")
            if let result = store.investigationResults[key] {
                if let error = result.error {
                    Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled)
                } else {
                    ForEach(result.threads ?? [result], id: \.threadId) { thread in
                        if let threadId = thread.threadId {
                            Text(thread.reused == true ? "Using the existing investigation." : "Investigation sent to T3 Code.")
                                .font(.caption).foregroundStyle(.mint)
                            Text("\(thread.projectTitle ?? "T3 Code Contrib") · \(thread.title ?? "Diagnose")")
                                .font(.caption).textSelection(.enabled)
                            HStack {
                                Button("Open T3 Code") { store.openT3() }
                                Button("Copy thread ID") {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(threadId, forType: .string)
                        }
                    }.controlSize(.small)
                        }
                    }
                }
            }
        }
    }
}

struct ReadableEvidence: View {
    let kind: String
    let evidence: JSONValue
    var body: some View {
        let summary = evidenceSummary(kind: kind, evidence: evidence)
        VStack(alignment: .leading, spacing: 16) {
            Text("What the doctor observed").font(.headline)
            ForEach(summary.facts) { fact in
                VStack(alignment: .leading, spacing: 4) {
                    Text(fact.label).font(.caption).foregroundStyle(.secondary)
                    Text(fact.value).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Divider()
            Text("What to check next").font(.subheadline.weight(.semibold))
            Text(summary.nextStep).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            if !evidence["sessions"].list.isEmpty {
                EvidenceRecords(title: "Provider sessions", records: evidence["sessions"].list)
            }
            if !evidence["unfinished_nodes"].list.isEmpty {
                EvidenceRecords(title: "Unfinished work", records: evidence["unfinished_nodes"].list)
            }
            EvidenceDisclosure(title: "Technical details", text: evidence.pretty)
        }
    }
}

struct EvidenceRecords: View {
    let title: String
    let records: [JSONValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.subheadline.weight(.semibold))
            if records.isEmpty { Text("None recorded").font(.caption).foregroundStyle(.secondary) }
            ForEach(Array(records.enumerated()), id: \.offset) { _, record in
                let payload = record["detail"].text.flatMap { try? JSONDecoder().decode(JSONValue.self, from: Data($0.utf8)) }
                VStack(alignment: .leading, spacing: 7) {
                    Text(payload?["title"].text ?? record["summary"].text ?? record["effect_type"].text ?? record["kind"].text ?? record["type"].text ?? record["provider"].text ?? "Activity")
                        .font(.callout.weight(.medium)).textSelection(.enabled)
                    if let state = record["status"].text { StatusPill(text: state.capitalized, color: state == "failed" || state == "error" ? .orange : .secondary) }
                    if let error = record["last_error"].text { Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled) }
                    if let input = payload?["input"], !input.fields.isEmpty || input.text != nil {
                        Text(String(input.pretty.prefix(600))).font(.system(size: 11, design: .monospaced)).textSelection(.enabled)
                    }
                    if let date = record["updated_at"].text ?? record["created_at"].text ?? record["started_at"].text {
                        Text(formattedDate(date)).font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(11).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

struct IncidentActions: View {
    @ObservedObject var store: DoctorStore
    let fingerprint: String?
    let triage: IncidentTriage?
    let investigation: InvestigationLink?
    let related: RelatedAssessment?
    let duplicateOf: String?
    var finding: String?
    var report: String?
    @State private var assignee = ""
    @State private var note = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let fingerprint {
                HStack {
                    StatusPill(text: triage?.label ?? "Needs attention", color: triage?.needsAttention == false ? .teal : .orange)
                    Spacer(minLength: 4)
                    Menu("Set status") {
                        Button("Needs attention") { save("needs_attention", fingerprint) }
                        Button("In progress") { save("in_progress", fingerprint) }
                        Button("Dismissed") { save("dismissed", fingerprint) }
                    }.menuStyle(.borderlessButton)
                }
                TextField("Owner or assignee", text: $assignee).textFieldStyle(.roundedBorder)
                TextField("Note, optional", text: $note).textFieldStyle(.roundedBorder)
                Button("Assign") { save("assigned", fingerprint) }
                    .disabled(assignee.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let error = store.handlingErrors[fingerprint] { Text(error).font(.caption).foregroundStyle(.orange) }
                Text("Handling status does not change the observed condition.").font(.caption).foregroundStyle(.secondary)
                if let investigation, let threadId = investigation.threadId {
                    Divider()
                    Text(investigation.stage == "verified" ? "Linked investigation" : "Investigation submission pending").font(.subheadline.weight(.semibold))
                    Text(investigation.title ?? "T3 investigation").font(.caption).textSelection(.enabled)
                    Text(threadId).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                    HStack {
                        Button("Open T3 Code") { store.openT3() }
                        Button("Copy thread ID") { copy(threadId) }
                    }.controlSize(.small)
                }
                if duplicateOf != nil {
                    Button("Unlink reused investigation") { store.checkRelated(fingerprint: fingerprint, detach: true) }
                        .help("Returns this incident to Needs attention and preserves the other investigation.")
                }
                Divider()
                Button(store.investigationBusy == "related:" + fingerprint ? "Checking related investigations…" : "Check related investigations with Jev") {
                    store.checkRelated(fingerprint: fingerprint)
                }.controlSize(.small)
                Text("Compares redacted incident summaries with TypeSafe.").font(.caption).foregroundStyle(.secondary)
                if let related {
                    if related.matches.isEmpty {
                        Text(related.compared == 0 ? "No other investigations to compare." : "No strong matches among \(related.compared) incidents.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(related.matches) { match in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(match.title).font(.caption.weight(.semibold)).textSelection(.enabled)
                            Text(match.reason).font(.caption).foregroundStyle(.secondary).lineLimit(4)
                            Text("Jev match score: \(match.score, format: .number.precision(.fractionLength(2)))").font(.caption)
                            if investigation == nil {
                                Button("Reuse this investigation") { store.checkRelated(fingerprint: fingerprint, reuse: match.fingerprint) }
                                    .controlSize(.small)
                            } else {
                                Button("Copy suggested thread ID") { copy(match.threadId) }.controlSize(.small)
                            }
                        }.padding(9).background(.teal.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                    }
                    Text("Checked \(formattedDate(related.checkedAt))").font(.caption2).foregroundStyle(.secondary)
                }
                Menu("Copy tracking details") {
                    Button("Incident fingerprint") { copy(fingerprint) }
                    if let hash = investigation?.promptSha256 { Button("Investigation prompt fingerprint") { copy(hash) } }
                }.controlSize(.small)
            }
            if investigation?.stage != "verified" {
                InvestigateButton(store: store, finding: finding, report: report,
                                  title: investigation == nil ? "Investigate in T3 Code" : "Retry investigation")
            }
        }
        .disabled(store.investigationBusy != nil)
        .task(id: triage?.updatedAt) {
            assignee = triage?.assignee ?? ""
            note = triage?.note ?? ""
        }
    }
    private func save(_ status: String, _ fingerprint: String) {
        store.setHandling(fingerprint: fingerprint, status: status, assignee: assignee, note: note)
    }
    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
