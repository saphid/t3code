import SwiftUI

struct PullRequestListContent: View {
    @Bindable var model: PullRequestInboxModel

    var body: some View {
        List {
            Section {
                Picker("Involvement", selection: $model.involvement) {
                    Text("All").tag(PullRequestInvolvement.all)
                    Text("Reviewing").tag(PullRequestInvolvement.reviewing)
                    Text("Authored").tag(PullRequestInvolvement.authored)
                }
                .pickerStyle(.segmented)

                Picker("State", selection: $model.state) {
                    Text("Open").tag(PullRequestListState.open)
                    Text("Closed").tag(PullRequestListState.closed)
                    Text("Merged").tag(PullRequestListState.merged)
                    Text("All").tag(PullRequestListState.all)
                }
                .pickerStyle(.menu)

                HStack {
                    Menu {
                        Button("All projects") { model.selectedProjectID = nil }
                        ForEach(model.projectOptions, id: \.id) { project in
                            Button(project.title) { model.selectedProjectID = project.id }
                        }
                    } label: {
                        Label(selectedProjectTitle, systemImage: "folder")
                    }

                    Spacer()

                    Menu {
                        Button("All hosts") { model.selectedHost = nil }
                        ForEach(model.hostOptions, id: \.self) { host in
                            Button(host) { model.selectedHost = host }
                        }
                    } label: {
                        Label(model.selectedHost ?? "All hosts", systemImage: "network")
                    }
                }
                .font(T3Typography.supporting)
            }
            .listRowBackground(T3Colors.surface)

            if let listError = model.listError, !model.entries.isEmpty {
                Section {
                    Label(listError, systemImage: "exclamationmark.triangle")
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.warning)
                }
            }

            ForEach(model.groups) { group in
                Section(group.title) {
                    ForEach(group.entries) { entry in
                        NavigationLink(value: model.route(for: entry)) {
                            PullRequestRowView(entry: entry, stat: model.stat(for: entry))
                        }
                        .accessibilityIdentifier("pull-request-row-\(entry.id)")
                    }
                }
            }

            if !model.projectErrors.isEmpty {
                Section("Some projects could not load") {
                    ForEach(model.projectErrors) { error in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(error.projectTitle)
                                .font(T3Typography.threadBody)
                            Text(error.message)
                                .font(T3Typography.supporting)
                                .foregroundStyle(T3Colors.textSecondary)
                        }
                    }
                }
            }

            if model.canLoadMore {
                Section {
                    Button("Load more", systemImage: "arrow.down.circle") {
                        Task { await model.load(reset: false) }
                    }
                    .disabled(model.isLoadingMore)
                    .frame(maxWidth: .infinity)
                }
            } else if model.isTruncated {
                Section {
                    Label(
                        "More results exist on the host, but this page has no continuation cursor.",
                        systemImage: "exclamationmark.circle"
                    )
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                }
            }
        }
        .overlay {
            if model.isLoading, model.entries.isEmpty {
                ProgressView("Loading pull requests…")
            } else if let listError = model.listError, model.entries.isEmpty {
                ContentUnavailableView {
                    Label("Couldn’t load pull requests", systemImage: "exclamationmark.circle")
                } description: {
                    Text(listError)
                } actions: {
                    Button("Try again") { Task { await model.load() } }
                }
            } else if !model.isLoading, model.entries.isEmpty {
                if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ContentUnavailableView("No pull requests", systemImage: "arrow.triangle.pull")
                } else {
                    ContentUnavailableView.search
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .searchable(text: $model.query, prompt: "Search pull requests")
        .refreshable { await model.load() }
        .task(id: model.filterKey) {
            guard model.loadedFilterKey != model.filterKey else { return }
            do {
                try await Task.sleep(for: .milliseconds(250))
                await model.load()
            } catch {
                return
            }
        }
    }

    private var selectedProjectTitle: String {
        guard let selectedProjectID = model.selectedProjectID else { return "All projects" }
        return model.knownProjects[selectedProjectID] ?? "Selected project"
    }
}
