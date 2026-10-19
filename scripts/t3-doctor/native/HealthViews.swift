import AppKit
import SwiftUI

func healthColor(_ state: String) -> Color {
    switch state {
    case "ready", "current": .mint
    case "error": .red
    case "warning", "update_available", "stale": .orange
    default: .secondary
    }
}

func healthLabel(_ state: String) -> String {
    switch state {
    case "update_available": "Update available"
    case "release_available": "Different channel"
    case "stale": "Unverified"
    default: state.capitalized
    }
}

struct ProvidersBrowser: View {
    @ObservedObject var store: DoctorStore
    @State private var selection: String?
    @State private var showDisabled = false
    private var providers: [ProviderHealth] {
        (store.observation?.providers ?? []).filter { showDisabled || $0.enabled }
    }
    private var selected: ProviderHealth? { providers.first { $0.id == selection } }

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Configured providers").font(.headline)
                    Spacer()
                    Toggle("Show disabled", isOn: $showDisabled).toggleStyle(.checkbox)
                }.padding(16)
                if providers.isEmpty {
                    ContentUnavailableView("No provider observations", systemImage: "server.rack",
                        description: Text("Provider checks appear after the doctor's next scan."))
                } else {
                    Table(providers, selection: $selection) {
                        TableColumn("Provider") { provider in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(provider.name).fontWeight(.medium).lineLimit(2)
                                Text(provider.driver).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 8)
                        }.width(min: 170, ideal: 230)
                        TableColumn("Health") { provider in
                            StatusPill(text: healthLabel(provider.state), color: healthColor(provider.state))
                        }.width(100)
                        TableColumn("Runs") { provider in Text("\(provider.activeRuns ?? 0)").monospacedDigit() }.width(40)
                    }.tableStyle(.inset(alternatesRowBackgrounds: true))
                }
                ForEach(store.observation?.providerErrors ?? [], id: \.self) { error in
                    Text(error).font(.caption).foregroundStyle(.orange).textSelection(.enabled).padding(.horizontal, 16)
                }
                Text("Readiness comes from T3 diagnostics. Executable availability is checked directly.")
                    .font(.caption).foregroundStyle(.secondary).padding(16)
            }.frame(minWidth: 430)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let provider = selected {
                        Text(provider.name).font(.title3.weight(.semibold))
                        StatusPill(text: healthLabel(provider.state), color: healthColor(provider.state))
                        Text(provider.message).font(.callout).textSelection(.enabled)
                        if let finding = store.observation?.currentFindings.first(where: { $0.key == "provider:" + provider.id }) {
                            IncidentActions(store: store, fingerprint: finding.fingerprint, triage: finding.triage, investigation: finding.investigation, related: finding.related, duplicateOf: finding.duplicateOf, finding: finding.key)
                        }
                        DetailField(label: "Version", value: provider.version ?? "Unknown")
                        DetailField(label: "Authentication", value: provider.auth.capitalized)
                        DetailField(label: "Configured executable", value: provider.binaryFound.map { $0 ? "Available" : "Missing or not executable" } ?? "Using T3's installation result")
                        DetailField(label: "T3 diagnostic timestamp", value: formattedDate(provider.checkedAt))
                        DetailField(label: "Doctor observed", value: formattedDate(provider.observedAt))
                        DetailField(label: "Instance ID", value: provider.id, monospaced: true)
                        Text("Diagnostics older than 15 minutes are unverified. An unknown authentication result does not prove an outage.")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Label("Provider details", systemImage: "server.rack").font(.headline)
                        Text("Select a provider to see authentication, installed version, and the reason for its current health state.").foregroundStyle(.secondary)
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minWidth: 260, idealWidth: 310, maxWidth: 430)
        }
    }
}

struct UpdatesBrowser: View {
    @ObservedObject var store: DoctorStore
    @State private var requestMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("T3 Code versions").font(.headline)
                        Text("Published releases are checked hourly. Updates are never installed automatically.").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Check now", systemImage: "arrow.clockwise") {
                        do {
                            try Data().write(to: store.directory.appendingPathComponent("check-updates.request"), options: .atomic)
                            requestMessage = "Requested. The doctor will check on its next scan."
                        } catch { requestMessage = error.localizedDescription }
                    }
                }
                if let requestMessage { Text(requestMessage).font(.caption).foregroundStyle(.secondary) }
                ForEach(store.observation?.updates ?? []) { update in
                    VStack(alignment: .leading, spacing: 17) {
                        HStack {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(update.statusTitle).font(.title3.weight(.semibold))
                                Text(update.name).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusPill(text: update.commitStatus == "diverged" ? "Different history" : healthLabel(update.state), color: update.state == "current" ? .mint : .secondary)
                        }
                        Text(update.message).foregroundStyle(.secondary)
                        HStack(alignment: .top, spacing: 30) {
                            DetailField(label: "Installed version", value: update.installedVersion ?? "Unknown", monospaced: true).frame(maxWidth: .infinity, alignment: .leading)
                            DetailField(label: "Latest published version", value: update.latestVersion ?? "Unknown", monospaced: true).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        HStack(alignment: .top, spacing: 30) {
                            DetailField(label: "Release source", value: [update.repository, update.channel].compactMap { $0 }.joined(separator: " · ")).frame(maxWidth: .infinity, alignment: .leading)
                            DetailField(label: "Last successful check", value: formattedDate(update.checkedAt)).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        HStack(alignment: .top, spacing: 30) {
                            DetailField(label: "Releases", value: update.releaseDistance).frame(maxWidth: .infinity, alignment: .leading)
                            DetailField(label: "Commits", value: update.commitDistance).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let note = update.releaseDistanceNote { Text(note).font(.caption).foregroundStyle(.secondary) }
                        if let note = update.commitDistanceNote { Text(note).font(.caption).foregroundStyle(.secondary) }
                        if update.commitStatus == "diverged" {
                            Text("Both builds contain commits the other does not. These are history counts, not a count of missing fixes.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if let commit = update.sourceCommit { DetailField(label: "Installed source commit", value: commit, monospaced: true) }
                        if let path = update.path { DetailField(label: "Installed location", value: path, monospaced: true) }
                        HStack {
                            Text("Next check: \(formattedDate(update.nextCheckAt))").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            if let comparison = update.comparisonUrl, let url = URL(string: comparison), url.scheme == "https", url.host == "github.com" {
                                Button("Compare source", systemImage: "arrow.triangle.branch") { NSWorkspace.shared.open(url) }
                            }
                            if let urlString = update.releaseUrl, let url = URL(string: urlString), url.scheme == "https", url.host == "github.com" {
                                Button("View release", systemImage: "arrow.up.right.square") { NSWorkspace.shared.open(url) }
                            }
                        }
                    }.padding(20).background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
                }
                if FileManager.default.fileExists(atPath: store.directory.appendingPathComponent("update-history").path) {
                    Button("Previous update reports", systemImage: "folder") {
                        NSWorkspace.shared.open(store.directory.appendingPathComponent("update-history"))
                    }.help("Saved version observations and their earlier investigation links.")
                }
                ForEach(store.observation?.updateErrors ?? [], id: \.self) { error in
                    Text(error).foregroundStyle(.orange).textSelection(.enabled)
                }
                if store.observation?.updates == nil && (store.observation?.updateErrors ?? []).isEmpty {
                    ContentUnavailableView("Waiting for a release check", systemImage: "arrow.down.app", description: Text("The doctor will supply version details on its next scan."))
                }
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
