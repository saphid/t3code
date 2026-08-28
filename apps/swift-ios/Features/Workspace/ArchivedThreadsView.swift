import SwiftUI

struct ArchivedThreadsView: View {
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @Bindable var model: FeatureRootModel
    let onOpen: (String) -> Void

    @AppStorage(ArchivedThreadPreferences.searchQueryKey) private var searchQuery = ""
    @AppStorage(ArchivedThreadPreferences.sortOrderKey) private var sortOrderRawValue =
        ArchivedThreadSortOrder.newest.rawValue
    @State private var deletingThread: FeatureThread?

    var body: some View {
        Group {
            if list.groups.isEmpty {
                emptyState
            } else {
                archivedList
            }
        }
        .background(T3Colors.background)
        .navigationTitle("Archived threads")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchQuery, prompt: "Search archived threads")
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Done") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                sortMenu
            }
        }
        .alert(
            "Delete thread?",
            isPresented: Binding(
                get: { deletingThread != nil },
                set: { if !$0 { deletingThread = nil } }
            ),
            presenting: deletingThread
        ) { thread in
            Button("Delete", role: .destructive) {
                deletingThread = nil
                Task { await model.deleteThread(thread.id) }
            }
            Button("Cancel", role: .cancel) { deletingThread = nil }
        } message: { thread in
            Text("\"\(thread.title)\" and its terminal history will be permanently deleted.")
        }
    }

    private var list: ArchivedThreadList {
        ArchivedThreadList(
            snapshot: model.snapshot,
            query: searchQuery,
            sortOrder: sortOrder
        )
    }

    private var sortOrder: ArchivedThreadSortOrder {
        ArchivedThreadPreferences.sortOrder(from: sortOrderRawValue)
    }

    private var archivedList: some View {
        List {
            ForEach(list.groups) { group in
                Section {
                    ForEach(group.threads) { thread in
                        archivedRow(thread)
                    }
                } header: {
                    projectHeader(group.project)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("archived-thread-list")
    }

    private var emptyState: some View {
        ContentUnavailableView(
            list.totalArchivedCount == 0 ? "No archived threads" : "No matching threads",
            systemImage: list.totalArchivedCount == 0 ? "archivebox" : "magnifyingglass",
            description: Text(
                list.totalArchivedCount == 0
                    ? "Threads you archive will appear here."
                    : "Try another search or clear the search field."
            )
        )
        .accessibilityIdentifier(
            list.totalArchivedCount == 0
                ? "archived-empty-state"
                : "archived-search-empty-state"
        )
    }

    private var sortMenu: some View {
        Menu("Sort archived threads", systemImage: "arrow.up.arrow.down") {
            ForEach(ArchivedThreadSortOrder.allCases) { order in
                Button {
                    sortOrderRawValue = order.rawValue
                } label: {
                    if order == sortOrder {
                        Label(order.label, systemImage: "checkmark")
                    } else {
                        Text(order.label)
                    }
                }
            }
        }
        .labelStyle(.iconOnly)
        .accessibilityValue(sortOrder.label)
        .accessibilityIdentifier("archived-sort-order")
    }

    private func projectHeader(_ project: FeatureProject) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "folder")
                .accessibilityHidden(true)
            Text(project.name)
                .lineLimit(1)
            Spacer(minLength: 8)
            if let environment = model.snapshot.environments.first(where: {
                $0.id == project.environmentID
            }) {
                Text(environment.name)
                    .lineLimit(1)
            }
        }
        .font(T3Typography.homeMetadata.weight(.semibold))
        .foregroundStyle(T3Colors.textSecondary)
        .textCase(nil)
    }

    private func archivedRow(_ thread: FeatureThread) -> some View {
        Button {
            onOpen(thread.id)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "archivebox.fill")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(T3Colors.textTertiary)
                    .frame(width: 34, height: 34)
                    .background(T3Colors.input, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(thread.title)
                        .font(T3Typography.homeTitle)
                        .foregroundStyle(T3Colors.textPrimary)
                        .lineLimit(1)
                    if let branch = thread.branch, !branch.isEmpty {
                        Label(branch, systemImage: "arrow.triangle.branch")
                            .font(T3Typography.homeMetadata.monospaced())
                            .foregroundStyle(T3Colors.textTertiary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(ArchivedThreadList.archiveDate(thread), style: .relative)
                    .font(T3Typography.homeMetadata)
                    .foregroundStyle(T3Colors.textTertiary)
                    .monospacedDigit()
            }
            .frame(minHeight: 50)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("archived-thread-\(thread.id)")
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                deletingThread = thread
            } label: {
                Label("Delete", systemImage: "trash")
            }
            Button {
                restore(thread)
            } label: {
                Label("Restore", systemImage: "arrow.uturn.backward")
            }
            .tint(.blue)
        }
        .contextMenu {
            Button {
                restore(thread)
            } label: {
                Label("Restore", systemImage: "arrow.uturn.backward")
            }
            Button(role: .destructive) {
                deletingThread = thread
            } label: {
                Label("Delete thread", systemImage: "trash")
            }
        }
    }

    private func restore(_ thread: FeatureThread) {
        Task { await model.setArchived(thread.id, archived: false) }
    }
}
