import SwiftUI

struct ProviderSettingsView: View {
    @Bindable var model: FeatureRootModel
    @State private var inFlightProviderIDs: Set<String> = []
    @State private var isRefreshing = false
    @State private var errorMessage: String?
    @State private var maintenanceTask: Task<Void, Never>?

    var body: some View {
        List {
            if sections.isEmpty {
                ContentUnavailableView(
                    "No providers",
                    systemImage: "shippingbox",
                    description: Text("Connect an environment to inspect its provider versions.")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(sections) { section in
                    Section(section.environmentName) {
                        ForEach(section.rows) { row in
                            ProviderMaintenanceRowView(
                                row: row,
                                isLocallyUpdating: inFlightProviderIDs.contains(row.id),
                                isMaintenanceBusy: isRefreshing || !inFlightProviderIDs.isEmpty,
                                onUpdate: { update(row) }
                            )
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(T3Colors.background)
        .navigationTitle("Providers")
        .navigationBarTitleDisplayMode(.inline)
        .t3NavigationChrome()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    refresh()
                } label: {
                    if isRefreshing {
                        ProgressView()
                    } else {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
                .disabled(isRefreshing || !inFlightProviderIDs.isEmpty || sections.isEmpty)
                .accessibilityLabel(isRefreshing ? "Refreshing providers" : "Refresh providers")
                .accessibilityHint("Refreshes installed provider versions")
            }
        }
        .alert(
            "Provider maintenance failed",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Something went wrong.")
        }
        .onDisappear {
            maintenanceTask?.cancel()
            maintenanceTask = nil
        }
    }

    private var sections: [ProviderMaintenanceSection] {
        ProviderSettingsPresentation.sections(in: model.snapshot)
    }

    private func update(_ row: ProviderMaintenanceRow) {
        guard row.canAct, inFlightProviderIDs.isEmpty, !isRefreshing else { return }
        inFlightProviderIDs.insert(row.id)
        maintenanceTask = Task {
            let succeeded = await model.updateProvider(
                environmentID: row.environmentID,
                providerID: row.provider.id,
                driver: row.provider.driver
            )
            inFlightProviderIDs.remove(row.id)
            if !succeeded, !Task.isCancelled {
                errorMessage = model.errorMessage ?? "The provider update did not complete."
            }
            maintenanceTask = nil
        }
    }

    private func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        let rows = sections.flatMap(\.rows).filter(\.isEnvironmentOnline)
        maintenanceTask = Task {
            var allSucceeded = true
            for row in rows {
                guard !Task.isCancelled else { break }
                let succeeded = await model.refreshProvider(
                    environmentID: row.environmentID,
                    providerID: row.provider.id
                )
                allSucceeded = allSucceeded && succeeded
            }
            isRefreshing = false
            if !allSucceeded, !Task.isCancelled {
                errorMessage = model.errorMessage ?? "Some provider versions could not be refreshed."
            }
            maintenanceTask = nil
        }
    }
}

private struct ProviderMaintenanceRowView: View {
    let row: ProviderMaintenanceRow
    let isLocallyUpdating: Bool
    let isMaintenanceBusy: Bool
    let onUpdate: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ProviderIcon(
                driver: row.provider.driver,
                providerID: row.provider.id,
                fallbackName: row.provider.name,
                size: 30
            )
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(row.provider.name)
                        .font(T3Typography.homeTitle)
                        .foregroundStyle(T3Colors.textPrimary)
                    Spacer(minLength: 8)
                    Text(isLocallyUpdating ? "Updating" : row.status)
                        .font(T3Typography.status)
                        .foregroundStyle(statusColor)
                }
                if let version = row.provider.version {
                    Text("Version \(version)")
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                }
                if let detail = row.detail, !detail.isEmpty {
                    Text(detail)
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let output = row.output, !output.isEmpty {
                    Text(output)
                        .font(T3Typography.tool)
                        .foregroundStyle(T3Colors.textTertiary)
                        .lineLimit(4)
                        .textSelection(.enabled)
                }
                if let actionTitle = row.actionTitle {
                    Button(actionTitle, action: onUpdate)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(!row.canAct || isMaintenanceBusy)
                        .accessibilityHint("Runs the allowlisted provider update command")
                }
            }
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("provider-maintenance-\(row.id)")
    }

    private var statusColor: Color {
        if isLocallyUpdating { return T3Colors.statusRunning }
        return switch row.tone {
        case .neutral: T3Colors.textTertiary
        case .progress: T3Colors.statusRunning
        case .success: T3Colors.success
        case .warning: T3Colors.warning
        case .failure: T3Colors.danger
        }
    }
}
