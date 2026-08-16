import SwiftUI

struct PullRequestDetailView: View {
    @Bindable var model: PullRequestInboxModel
    let entry: PullRequestListEntry

    var body: some View {
        Group {
            if model.isLoadingDetail, model.selectedDetail == nil {
                ProgressView("Loading pull request…")
            } else if let detail = model.selectedDetail,
                      detail.projectId == entry.projectId,
                      detail.repository == entry.repository,
                      detail.number == entry.number {
                VStack(spacing: 0) {
                    Picker("Detail", selection: $model.selectedTab) {
                        ForEach(PullRequestInboxModel.DetailTab.allCases) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding()

                    switch model.selectedTab {
                    case .summary:
                        PullRequestSummaryView(detail: detail)
                    case .timeline:
                        PullRequestTimelineView(
                            activity: model.selectedActivity,
                            items: model.timelineItems,
                            errorMessage: model.activityError,
                            retry: retryActivity
                        )
                    }
                }
            } else if let detailError = model.detailError {
                ContentUnavailableView {
                    Label("Couldn’t load pull request", systemImage: "exclamationmark.circle")
                } description: {
                    Text(detailError)
                } actions: {
                    Button("Try again") { Task { await model.loadDetail(for: entry) } }
                }
            } else {
                ProgressView("Loading pull request…")
            }
        }
        .background(T3Colors.background)
        .navigationTitle("#\(entry.number)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: entry.id) { await model.loadDetail(for: entry) }
        .refreshable { await model.loadDetail(for: entry, refresh: true) }
    }

    private func retryActivity() {
        Task { await model.retryActivity(for: entry) }
    }
}
