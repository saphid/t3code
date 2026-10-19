import AppKit
import SwiftUI

enum DoctorPage: String, CaseIterable, Identifiable {
    case watching = "Watching now", providers = "Providers", updates = "App updates", incidents = "Incident history"
    var id: Self { self }
    var symbol: String {
        switch self {
        case .watching: "waveform.path.ecg"
        case .providers: "server.rack"
        case .updates: "arrow.down.app"
        case .incidents: "clock.arrow.circlepath"
        }
    }
}

@MainActor
final class DoctorStore: ObservableObject {
    @Published var snapshot = DoctorSnapshot()
    @Published var refreshing = false
    @Published var page: DoctorPage? = .watching
    @Published var investigationBusy: String?
    @Published var investigationResults: [String: InvestigationResult] = [:]
    @Published var handlingErrors: [String: String] = [:]
    let directory: URL
    private let repository: DoctorRepository
    private var observationTask: Task<Void, Never>?

    init() {
        directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/state/t3-doctor", isDirectory: true)
        repository = DoctorRepository(directory: directory)
        observationTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { break }
                await self?.refresh()
                do { try await Task.sleep(for: .seconds(5)) } catch { break }
            }
        }
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        snapshot = await repository.read()
        refreshing = false
    }

    var observation: Observation? { snapshot.observation }
    var health: (title: String, message: String, color: Color, symbol: String) {
        if let error = snapshot.error { return ("Doctor unavailable", error, .red, "exclamationmark.triangle") }
        guard let observation else { return ("Reading observations", "Connecting to the local doctor.", .secondary, "ellipsis.circle") }
        if observation.unavailable { return ("Cannot inspect T3", "The doctor could not read T3 state. Review the current finding.", .red, "exclamationmark.triangle") }
        if observation.isStale(at: snapshot.readAt) { return ("Observations are stale", "The doctor has stopped providing fresh observations. Shown activity may be out of date.", .orange, "clock.badge.exclamationmark") }
        if observation.attention > 0 { return ("Needs attention", "\(observation.attention) conditions need attention. Review the findings and captured evidence.", .orange, "exclamationmark.bubble") }
        if !(observation.providerErrors ?? []).isEmpty || !(observation.updateErrors ?? []).isEmpty {
            return ("Some checks unavailable", "Provider or release checks could not complete. See their sections for details.", .orange, "exclamationmark.triangle")
        }
        if !snapshot.reportErrors.isEmpty { return ("Some reports unavailable", "The incident history may be incomplete. Some reports could not be read.", .orange, "doc.badge.ellipsis") }
        if observation.server?.state != "reachable" { return ("Server status unknown", "The doctor cannot confirm that T3 is reachable.", .orange, "network.slash") }
        if observation.handled > 0 { return ("Findings are tracked", "\(observation.handled) conditions are still observed but assigned, in progress, or dismissed.", .teal, "checklist") }
        return ("Doctor is watching", "No suspected stalls in the latest observation.", .mint, "checkmark.seal")
    }

    func revealReports() { NSWorkspace.shared.open(directory.appendingPathComponent("incidents", isDirectory: true)) }

    func investigate(key: String, finding: String?, report: String?) {
        guard investigationBusy == nil else { return }
        investigationBusy = key
        let output = directory
        Task {
            do {
                investigationResults[key] = try await Task.detached {
                    try InvestigationRunner.run(output: output, finding: finding, report: report)
                }.value
            } catch {
                investigationResults[key] = InvestigationResult(threadId: nil, title: nil, projectTitle: nil,
                    stage: nil, reused: nil, error: "Could not start the investigation: \(error.localizedDescription)")
            }
            investigationBusy = nil
            await refresh()
        }
    }

    func setHandling(fingerprint: String, status: String, assignee: String, note: String) {
        guard investigationBusy == nil else { return }
        investigationBusy = "handling:" + fingerprint
        let output = directory
        Task {
            do {
                let result = try await Task.detached {
                    try InvestigationRunner.run(output: output, finding: nil, report: nil,
                        handling: ["--fingerprint", fingerprint, "--status", status, "--assignee", assignee, "--note", note])
                }.value
                handlingErrors[fingerprint] = result.error
            } catch { handlingErrors[fingerprint] = error.localizedDescription }
            investigationBusy = nil
            await refresh()
        }
    }

    func checkRelated(fingerprint: String, reuse: String? = nil, detach: Bool = false) {
        guard investigationBusy == nil else { return }
        investigationBusy = "related:" + fingerprint
        let output = directory
        var arguments = ["--fingerprint", fingerprint]
        if let reuse { arguments += ["--reuse", reuse] }
        if detach { arguments += ["--detach"] }
        let request = arguments
        Task {
            do {
                let result = try await Task.detached {
                    try InvestigationRunner.run(output: output, finding: nil, report: nil, related: request)
                }.value
                handlingErrors[fingerprint] = result.error
            } catch { handlingErrors[fingerprint] = error.localizedDescription }
            investigationBusy = nil
            await refresh()
        }
    }

    func openT3() {
        let config = try? JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: directory.appendingPathComponent("checks.json")))
        if let path = config?["desktop_app"].text { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
    }
}

@main
struct DoctorApp: App {
    @StateObject private var store = DoctorStore()
    @AppStorage("appearance") private var appearance = "dark"

    var body: some Scene {
        Window("T3 Doctor", id: "doctor") {
            DoctorWindow(store: store, appearance: $appearance)
                .preferredColorScheme(appearance == "system" ? nil : appearance == "light" ? .light : .dark)
                .onAppear { applyAppearance() }
                .onChange(of: appearance) { _, _ in applyAppearance() }
        }
        .defaultSize(width: 1180, height: 780)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Refresh observations") { Task { await store.refresh() } }.keyboardShortcut("r")
                Button("Show reports in Finder") { store.revealReports() }.keyboardShortcut("r", modifiers: [.command, .shift])
            }
            CommandMenu("Appearance") { appearancePicker }
        }

        MenuBarExtra("T3 Doctor", systemImage: store.health.symbol) {
            DoctorMenu(store: store)
            Divider()
            appearancePicker
            Divider()
            Button("Quit T3 Doctor") { NSApplication.shared.terminate(nil) }.keyboardShortcut("q")
        }
    }

    private var appearancePicker: some View {
        Picker("Appearance", selection: $appearance) {
            Text("Dark").tag("dark")
            Text("Light").tag("light")
            Text("Follow system").tag("system")
        }
    }

    private func applyAppearance() {
        NSApp.appearance = appearance == "system" ? nil : NSAppearance(named: appearance == "light" ? .aqua : .darkAqua)
    }
}

struct DoctorMenu: View {
    @ObservedObject var store: DoctorStore
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(store.health.title)
        Text("\(store.observation?.runs.count ?? 0) watched runs · \(store.snapshot.reports.count) saved incidents")
        Divider()
        Button("Open T3 Doctor") {
            openWindow(id: "doctor")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button("Refresh") { Task { await store.refresh() } }
        Button("Show reports in Finder") { store.revealReports() }
    }
}

struct DoctorWindow: View {
    @ObservedObject var store: DoctorStore
    @Binding var appearance: String

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 10) {
                    Image(systemName: "cross.case.fill").font(.system(size: 29)).foregroundStyle(.mint)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("T3 Doctor").font(.headline)
                        Text("LOCAL MONITOR").font(.system(size: 9, weight: .semibold)).tracking(1.3).foregroundStyle(.secondary)
                    }
                }.padding(.horizontal, 15).padding(.top, 22)
                List(DoctorPage.allCases, selection: $store.page) { page in
                    Label(page.rawValue, systemImage: page.symbol).tag(page).padding(.vertical, 5)
                }.listStyle(.sidebar)
                VStack(alignment: .leading, spacing: 10) {
                    Label("On this Mac", systemImage: "desktopcomputer")
                    Text("The doctor keeps watching when this window is closed.")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(16)
            }
            .navigationSplitViewColumnWidth(min: 195, ideal: 215, max: 260)
        } detail: {
            VStack(alignment: .leading, spacing: 0) {
                header.padding(24)
                Divider()
                switch store.page ?? .watching {
                case .incidents: IncidentBrowser(store: store)
                case .providers: ProvidersBrowser(store: store)
                case .updates: UpdatesBrowser(store: store)
                case .watching: RunsBrowser(store: store)
                }
                Divider()
                HStack {
                    Label("Observes only", systemImage: "eye").foregroundStyle(.secondary)
                    Spacer()
                    Text("Doctor checks every \(elapsed(store.observation?.monitoring?.interval ?? 30))")
                    Text("·")
                    Text("Quiet threshold \(elapsed(store.observation?.monitoring?.quiet ?? 900))")
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 12)
            }
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(minWidth: 960, minHeight: 630)
        .toolbar {
            ToolbarItemGroup {
                Picker("Appearance", selection: $appearance) {
                    Label("Dark", systemImage: "moon.fill").tag("dark")
                    Label("Light", systemImage: "sun.max.fill").tag("light")
                    Label("System", systemImage: "circle.lefthalf.filled").tag("system")
                }.pickerStyle(.menu).frame(width: 100).help("Choose the app's appearance")
                Button { Task { await store.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .disabled(store.refreshing).help("Refresh saved observations")
                Button { store.revealReports() } label: { Label("Reports", systemImage: "folder") }.help("Show reports in Finder")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.page?.rawValue ?? "Watching now").font(.system(size: 27, weight: .semibold))
                    Text("Your agents, their progress, and the evidence when work stalls.").foregroundStyle(.secondary)
                }
                Spacer(minLength: 15)
                if let date = parseDate(store.observation?.checkedAt) {
                    VStack(alignment: .trailing, spacing: 5) {
                        Text("LAST OBSERVED").font(.system(size: 9, weight: .medium)).tracking(1).foregroundStyle(.secondary)
                        Text(date, format: .dateTime.hour().minute().second()).font(.system(.caption, design: .monospaced))
                    }
                }
            }
            HStack(spacing: 12) {
                Image(systemName: store.health.symbol).font(.title2).foregroundStyle(store.health.color)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.health.title).font(.subheadline.weight(.semibold))
                    Text(store.health.message).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }.padding(14).background(store.health.color.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 12) {
                Metric(title: "Watched runs", value: validObservation ? "\(store.observation?.runs.count ?? 0)" : "?", symbol: "waveform.path.ecg")
                Metric(title: "Waiting", value: validObservation ? "\(store.observation?.waiting.count ?? 0)" : "?", symbol: "hourglass")
                Metric(title: "Needs attention", value: "\(store.observation?.attention ?? 0)", symbol: "exclamationmark.bubble")
                Metric(title: "Handled", value: "\(store.observation?.handled ?? 0)", symbol: "checklist")
                Metric(title: "Saved incidents", value: "\(store.snapshot.reports.count)", symbol: "doc.text.magnifyingglass")
            }
            if (store.observation?.attention ?? 0) > 0 {
                InvestigateButton(store: store, title: "Investigate findings needing attention")
            }
        }
    }
    private var validObservation: Bool { store.observation != nil && store.observation?.unavailable != true }
}

struct Metric: View {
    let title: String
    let value: String
    let symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text(title).font(.caption).foregroundStyle(.secondary); Spacer(); Image(systemName: symbol).foregroundStyle(.secondary) }
            Text(value).font(.system(size: 29, weight: .medium, design: .rounded)).monospacedDigit()
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.07)))
    }
}

struct StatusPill: View {
    let text: String
    var color: Color = .secondary
    var body: some View {
        HStack(spacing: 5) { Circle().fill(color).frame(width: 5, height: 5); Text(text).font(.system(size: 10, weight: .medium)) }
            .padding(.horizontal, 8).padding(.vertical, 5).background(color.opacity(0.1), in: Capsule())
    }
}

struct RunsBrowser: View {
    @ObservedObject var store: DoctorStore
    @State private var query = ""
    @State private var selection: String?
    private var runs: [WatchedRun] {
        (store.observation?.runs ?? []).filter { query.isEmpty || "\($0.displayTitle) \($0.displayProvider) \($0.threadId)".localizedCaseInsensitiveContains(query) }
            .sorted { ($0.quietSeconds ?? 0) > ($1.quietSeconds ?? 0) }
    }
    private var selected: WatchedRun? { store.observation?.runs.first { $0.id == selection } }
    private func isWaiting(_ run: WatchedRun) -> Bool { store.observation?.waiting.contains { $0.id == run.id } == true }
    private func hasFinding(_ run: WatchedRun) -> Bool { store.observation?.currentFindings.contains { $0.matches(run) } == true }

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Search threads or providers", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 16).padding(.top, 16)
                if runs.isEmpty {
                    ContentUnavailableView(store.observation == nil || store.observation?.unavailable == true ? "Observations unavailable" : query.isEmpty ? "No active runs" : "No matching threads",
                        systemImage: "waveform.path.ecg", description: Text(query.isEmpty ? "New work appears here when the doctor observes it." : "Try another thread title or provider."))
                } else {
                    Table(runs, selection: $selection) {
                        TableColumn("Thread") { run in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(run.displayTitle).fontWeight(.medium).lineLimit(2)
                                Text(run.displayProvider).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 8)
                        }.width(min: 175, ideal: 250)
                        TableColumn("State") { run in
                            StatusPill(text: hasFinding(run) ? "Suspected stall" : isWaiting(run) ? "Waiting" : (run.status ?? "active").capitalized,
                                color: hasFinding(run) ? .orange : isWaiting(run) ? .secondary : .mint)
                        }.width(110)
                        TableColumn("Quiet for") { run in Text(isWaiting(run) ? "Waiting" : elapsed(run.quietSeconds)).font(.system(.caption, design: .monospaced)) }.width(75)
                    }.tableStyle(.inset(alternatesRowBackgrounds: true))
                }
                Text("\(runs.count) observed runs · Updates automatically").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 17).padding(.bottom, 14)
            }.frame(minWidth: 450)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let selected {
                        Text(selected.displayTitle).font(.title3.weight(.semibold)).textSelection(.enabled)
                        StatusPill(text: isWaiting(selected) ? "Waiting" : (selected.status ?? "active").capitalized, color: isWaiting(selected) ? .secondary : .mint)
                        DetailField(label: "Provider", value: selected.displayProvider)
                        DetailField(label: "Last progress", value: formattedDate(selected.lastProgressAt))
                        DetailField(label: "Requested", value: formattedDate(selected.requestedAt ?? selected.updatedAt))
                        if isWaiting(selected) { Text(selected.waitingReason).foregroundStyle(.secondary) }
                        DetailField(label: "Thread ID", value: selected.threadId, monospaced: true)
                        DetailField(label: "Run / turn ID", value: selected.runId ?? selected.activeTurnId ?? "Not recorded", monospaced: true)
                        ForEach(store.observation?.currentFindings.filter { $0.matches(selected) } ?? []) { finding in
                            FindingCard(store: store, finding: finding, confirmed: store.observation?.incidents?[finding.key]?.report != nil)
                                .id(finding.fingerprint ?? finding.key)
                        }
                        Text("Silence is a suspected stall. A long tool call may still be working.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Label("Run details", systemImage: "sidebar.right").font(.headline)
                        Text("Select a thread to inspect its progress and waiting reason.").foregroundStyle(.secondary)
                    }
                    if selected == nil, let observation = store.observation {
                        ForEach(observation.currentFindings) { finding in
                            FindingCard(store: store, finding: finding, confirmed: observation.incidents?[finding.key]?.report != nil)
                                .id(finding.fingerprint ?? finding.key)
                        }
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minWidth: 250, idealWidth: 290, maxWidth: 440)
        }
    }
}

struct FindingCard: View {
    @ObservedObject var store: DoctorStore
    let finding: Finding
    let confirmed: Bool
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { expanded.toggle() } label: {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .frame(width: 12).padding(.top, 3)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(finding.title).font(.headline).lineLimit(2)
                        if let subject = finding.subject { Text(subject).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        StatusPill(text: finding.triage?.label ?? (confirmed ? "Confirmed" : "Awaiting confirmation"),
                                   color: finding.triage?.needsAttention == false ? .teal : .orange)
                    }
                    Spacer(minLength: 0)
                    Text(expanded ? "Hide" : "Show").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(finding.title)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .help(expanded ? "Collapse this incident" : "Expand this incident")
            if expanded {
                VStack(alignment: .leading, spacing: 10) {
                    Divider()
                    StatusPill(text: confirmed ? "Confirmed" : "Awaiting confirmation", color: .orange)
                    Text(finding.reason).font(.caption).textSelection(.enabled)
                    if let evidence = finding.evidence { ReadableEvidence(kind: finding.kind, evidence: evidence) }
                    IncidentActions(store: store, fingerprint: finding.fingerprint, triage: finding.triage, investigation: finding.investigation, related: finding.related, duplicateOf: finding.duplicateOf, finding: finding.key)
                }.padding(.top, 12)
            }
        }.padding(12).background(.orange.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct DetailField: View {
    let label: String
    let value: String
    var monospaced = false
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(.system(size: 9, weight: .medium)).tracking(0.7).foregroundStyle(.secondary)
            Text(value).font(monospaced ? .system(size: 10, design: .monospaced) : .system(size: 12)).textSelection(.enabled)
        }
    }
}

func formattedDate(_ value: String?) -> String {
    guard let date = parseDate(value) else { return "Not recorded" }
    return date.formatted(date: .abbreviated, time: .standard)
}

struct IncidentBrowser: View {
    @ObservedObject var store: DoctorStore
    @State private var selection: String?
    @State private var filter = "all"
    private var reports: [IncidentSummary] {
        store.snapshot.reports.filter {
            filter == "all" || (filter == "attention" && $0.needsAttention) ||
            (filter == "handled" && !$0.resolved && !$0.needsAttention) || (filter == "resolved" && $0.resolved)
        }
    }
    private var selected: IncidentSummary? { store.snapshot.reports.first { $0.id == selection } }
    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Show", selection: $filter) {
                    Text("All incidents").tag("all")
                    Text("Needs attention").tag("attention")
                    Text("Handled").tag("handled")
                    Text("Cleared").tag("resolved")
                }.pickerStyle(.menu).padding(16)
                if reports.isEmpty {
                    ContentUnavailableView(store.snapshot.reports.isEmpty ? "No incidents captured" : "No matching incidents",
                        systemImage: "checkmark.shield", description: Text("Persistent conditions appear here with their captured evidence."))
                } else {
                    List(reports, selection: $selection) { report in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(report.title).fontWeight(.medium).lineLimit(2)
                            if let subject = report.subject { Text(subject).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            StatusPill(text: report.handlingLabel, color: report.needsAttention ? .orange : .teal)
                            Text(report.reason).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                            Text(formattedDate(report.detectedAt)).font(.caption2).foregroundStyle(.secondary)
                        }.padding(.vertical, 9).tag(report.id)
                    }
                }
                if !store.snapshot.reportErrors.isEmpty {
                    Text(store.snapshot.reportErrors.joined(separator: "\n")).font(.caption).foregroundStyle(.orange).textSelection(.enabled).padding(16)
                }
                Spacer(minLength: 0)
            }.frame(minWidth: 310, idealWidth: 380)
            if let selected { IncidentDetail(store: store, summary: selected).id(selected.id + (selected.resolvedAt ?? "")) }
            else {
                ContentUnavailableView("Captured evidence", systemImage: "doc.text.magnifyingglass", description: Text("Select an incident to read the saved state and log excerpts."))
                    .frame(minWidth: 350, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

struct IncidentDetail: View {
    @ObservedObject var store: DoctorStore
    let summary: IncidentSummary
    @State private var report: JSONValue?
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    Text(summary.title).font(.title3.weight(.semibold)).textSelection(.enabled)
                    Spacer()
                    Button { NSWorkspace.shared.activateFileViewerSelecting([summary.fileURL]) } label: { Image(systemName: "folder") }.help("Reveal this report in Finder")
                }
                if let subject = summary.subject { Text(subject).font(.subheadline).foregroundStyle(.secondary) }
                StatusPill(text: summary.resolved ? "Condition cleared" : "Condition still observed", color: summary.resolved ? .mint : .secondary)
                Text(summary.reason).textSelection(.enabled)
                IncidentActions(store: store, fingerprint: summary.fingerprint, triage: summary.triage, investigation: summary.investigation, related: summary.related, duplicateOf: summary.duplicateOf, report: summary.id)
                DetailField(label: "Detected", value: formattedDate(summary.detectedAt))
                DetailField(label: "Resolved", value: summary.resolved ? formattedDate(summary.resolvedAt) : "Still unresolved")
                if let id = summary.threadId { DetailField(label: "Affected thread ID", value: id, monospaced: true) }
                if let error { Text(error).foregroundStyle(.orange).textSelection(.enabled) }
                if let report {
                    Text(report["interpretation"].text ?? "Captured state is evidence for investigation. It does not prove a root cause.").font(.caption).foregroundStyle(.secondary)
                    if let resolution = report["resolution"].text { Text(resolution).font(.caption).foregroundStyle(.secondary) }
                    if let error = report["capture_error"].text { Text("Capture error: \(error)").foregroundStyle(.orange) }
                    ReadableEvidence(kind: summary.kind, evidence: report["evidence"])
                    ForEach(report["details"].fields.keys.sorted(), id: \.self) { key in
                        EvidenceRecords(title: key.replacingOccurrences(of: "_", with: " ").capitalized, records: report["details"][key].list)
                    }
                    ForEach(report["logs"].fields.keys.sorted(), id: \.self) { key in
                        EvidenceDisclosure(title: key, text: report["logs"][key].list.compactMap(\.text).joined(separator: "\n"))
                    }
                    if case .bool(let submitted) = report["notification"]["submitted"] {
                        DetailField(label: "Notification", value: report["notification"]["suppressed"].text ?? (submitted ? "Submitted to macOS" : "Could not submit to macOS"))
                    }
                }
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
        }.frame(minWidth: 350, maxWidth: .infinity)
        .task {
            let url = summary.fileURL
            do { report = try await Task.detached { try DoctorRepository.readReport(url) }.value }
            catch { self.error = "Cannot read the report: \(error.localizedDescription)" }
        }
    }
}

struct EvidenceDisclosure: View {
    let title: String
    let text: String
    @State private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 10) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right").frame(width: 12)
                    Text(title).font(.callout.weight(.semibold))
                    Spacer(minLength: 0)
                    Text(expanded ? "Hide" : "Show").font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal, 12).frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                ScrollView([.horizontal, .vertical]) {
                    Text(text).font(.system(size: 11, design: .monospaced)).textSelection(.enabled).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(height: min(300, max(80, CGFloat(text.split(separator: "\n", omittingEmptySubsequences: false).count) * 14 + 24)))
            }
        }.background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}
