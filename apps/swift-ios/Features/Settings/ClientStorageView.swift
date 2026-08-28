import SwiftUI

public struct ClientStorageView: View {
    private enum Confirmation: Equatable {
        case environment(id: String, name: String, size: String)
        case all(size: String)

        var title: String {
            switch self {
            case let .environment(_, name, _): "Clear cache for \(name)?"
            case let .all(size): "Clear \(size) of client caches?"
            }
        }

        var message: String {
            switch self {
            case .environment:
                "This removes offline threads, server metadata, and cached branches for this environment. The saved connection and credentials stay intact."
            case .all:
                "This removes offline data for every environment. Connections, credentials, account data, and app preferences stay intact."
            }
        }

        var buttonTitle: String {
            switch self {
            case .environment: "Clear Cache"
            case .all: "Clear All Caches"
            }
        }

        var scope: FeatureClientCache.Scope {
            switch self {
            case let .environment(id, _, _): .environment(id)
            case .all: .all
            }
        }
    }

    @Bindable private var rootModel: FeatureRootModel
    @State private var storageModel: ClientStorageViewModel
    @State private var confirmation: Confirmation?

    public init(model: FeatureRootModel) {
        rootModel = model
        _storageModel = State(initialValue: ClientStorageViewModel(client: model.client))
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                cacheSection
                actionSection
            }
            .padding(.vertical, 24)
        }
        .refreshable { await storageModel.load() }
        .background(T3Colors.background)
        .navigationTitle("Client Storage")
        .navigationBarTitleDisplayMode(.inline)
        .t3NavigationChrome()
        .task { await storageModel.load() }
        .alert(
            confirmation?.title ?? "Clear client cache?",
            isPresented: Binding(
                get: { confirmation != nil },
                set: { if !$0 { confirmation = nil } }
            )
        ) {
            Button(confirmation?.buttonTitle ?? "Clear", role: .destructive) {
                clearConfirmedCache()
            }
            Button("Cancel", role: .cancel) { confirmation = nil }
        } message: {
            Text(confirmation?.message ?? "")
        }
    }

    @ViewBuilder
    private var cacheSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Environment caches")
            switch storageModel.state {
            case .loading:
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Inspecting cached data…")
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 48)
                .accessibilityIdentifier("client-storage-loading")
            case .unavailable:
                ContentUnavailableView {
                    Label("Storage unavailable", systemImage: "exclamationmark.triangle")
                } description: {
                    Text("Restart the app and try again.")
                } actions: {
                    Button("Try Again") { Task { await storageModel.load() } }
                }
                .accessibilityIdentifier("client-storage-unavailable")
            case let .loaded(summary) where summary.environments.isEmpty:
                ContentUnavailableView {
                    Label("No cached data", systemImage: "checkmark.circle")
                } description: {
                    Text("Offline cache records will appear here after environments are used.")
                }
                .accessibilityIdentifier("client-storage-empty")
            case let .loaded(summary):
                let environments = sortedEnvironments(summary)
                LazyVStack(spacing: 0) {
                    ForEach(environments) { environment in
                        environmentRow(environment)
                        if environment.id != environments.last?.id {
                            settingsDivider
                        }
                    }
                }
                .accessibilityIdentifier("client-storage-populated")
            }
        }
    }

    @ViewBuilder
    private var actionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Actions")
            Button(role: .destructive, action: confirmClearAll) {
                HStack(spacing: 12) {
                    Image(systemName: "trash")
                        .frame(width: 22)
                        .accessibilityHidden(true)
                    Text(clearAllLabel)
                        .font(T3Typography.threadBody)
                    Spacer(minLength: 12)
                    if storageModel.clearingScope == .all {
                        ProgressView()
                    }
                }
                .foregroundStyle(T3Colors.danger)
                .padding(.horizontal, 20)
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(storageModel.clearingScope != nil || canClearAll == false)
            .accessibilityIdentifier("client-storage-clear-all")

            Text("Clearing caches never removes environment connections, credentials, account data, or appearance preferences.")
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textTertiary)
                .padding(.horizontal, 20)

            if let errorMessage = storageModel.errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.danger)
                    .padding(.horizontal, 20)
                    .accessibilityIdentifier("client-storage-clear-error")
            }
        }
    }

    private func environmentRow(
        _ environment: FeatureClientCache.EnvironmentSummary
    ) -> some View {
        let name = environmentName(for: environment.environmentID)
        let scope = FeatureClientCache.Scope.environment(environment.environmentID)
        return HStack(spacing: 12) {
            Image(systemName: "desktopcomputer")
                .foregroundStyle(T3Colors.textSecondary)
                .frame(width: 22)
                .accessibilityHidden(true)
            Text(name)
                .font(T3Typography.threadBody)
                .foregroundStyle(T3Colors.textPrimary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button("Clear \(Self.formatBytes(environment.payloadBytes))", role: .destructive) {
                confirmation = .environment(
                    id: environment.environmentID,
                    name: name,
                    size: Self.formatBytes(environment.payloadBytes)
                )
            }
            .disabled(storageModel.clearingScope != nil)
            .overlay {
                if storageModel.clearingScope == scope {
                    ProgressView()
                }
            }
            .opacity(storageModel.clearingScope == scope ? 0.4 : 1)
            .accessibilityLabel("Clear cache for \(name)")
            .accessibilityValue(Self.formatBytes(environment.payloadBytes))
            .accessibilityIdentifier("client-storage-clear-\(environment.environmentID)")
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 56)
        .accessibilityElement(children: .contain)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(T3Typography.navigationTitle)
            .foregroundStyle(T3Colors.textPrimary)
            .padding(.horizontal, 20)
            .accessibilityAddTraits(.isHeader)
    }

    private var settingsDivider: some View {
        Divider()
            .overlay(T3Colors.separator)
            .padding(.horizontal, 20)
    }

    private var canClearAll: Bool {
        guard let summary = storageModel.summary else { return false }
        return summary.recordCount > 0
    }

    private var clearAllLabel: String {
        guard let summary = storageModel.summary, summary.recordCount > 0 else {
            return "Clear All Caches"
        }
        if storageModel.clearingScope == .all {
            return "Clearing All Caches…"
        }
        return "Clear All Caches (\(Self.formatBytes(summary.payloadBytes)))"
    }

    private func sortedEnvironments(
        _ summary: FeatureClientCache.Summary
    ) -> [FeatureClientCache.EnvironmentSummary] {
        summary.environments.sorted {
            environmentName(for: $0.environmentID).localizedStandardCompare(
                environmentName(for: $1.environmentID)
            ) == .orderedAscending
        }
    }

    private func environmentName(for id: String) -> String {
        rootModel.snapshot.environments.first(where: { $0.id == id })?.name ?? id
    }

    private func confirmClearAll() {
        guard let summary = storageModel.summary, summary.recordCount > 0 else { return }
        confirmation = .all(size: Self.formatBytes(summary.payloadBytes))
    }

    private func clearConfirmedCache() {
        guard let scope = confirmation?.scope else { return }
        confirmation = nil
        Task { await storageModel.clear(scope) }
    }

    static func formatBytes(_ bytes: Int) -> String {
        if bytes < 1_024 { return "\(bytes) B" }
        let kilobytes = Double(bytes) / 1_024
        if bytes < 1_048_576 {
            let digits = bytes < 10_240 ? 1 : 0
            return "\(kilobytes.formatted(.number.precision(.fractionLength(digits)))) KB"
        }
        let megabytes = Double(bytes) / 1_048_576
        let digits = bytes < 10_485_760 ? 1 : 0
        return "\(megabytes.formatted(.number.precision(.fractionLength(digits)))) MB"
    }
}
