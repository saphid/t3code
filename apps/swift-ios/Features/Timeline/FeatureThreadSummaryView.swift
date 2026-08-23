import SwiftUI

struct FeatureThreadSummaryView: View {
    let client: any FeatureClient
    let thread: FeatureThread

    @State private var timeline: FeatureThreadSummaryTimeline?
    @State private var error: Error?

    var body: some View {
        Group {
            if let timeline {
                if timeline.entries.isEmpty {
                    ContentUnavailableView(
                        "No completed turns",
                        systemImage: "text.bubble",
                        description: Text("A summary appears after this task completes a turn.")
                    )
                } else {
                    List(timeline.entries) { entry in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(entry.rangeLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(T3Colors.textSecondary)
                            Text(entry.summary)
                                .font(.body)
                                .foregroundStyle(T3Colors.textPrimary)
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 6)
                    }
                    .listStyle(.plain)
                }
            } else if let error {
                ContentUnavailableView(
                    "Summary unavailable",
                    systemImage: "exclamationmark.bubble",
                    description: Text(error.localizedDescription)
                )
            } else {
                ProgressView("Summarizing completed turns…")
            }
        }
        .navigationTitle("Summary timeline")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: thread.id) {
            do {
                timeline = try await client.threadSummaryTimeline(id: thread.id)
            } catch is CancellationError {
                return
            } catch {
                self.error = error
            }
        }
    }
}

extension ThreadSummaryTimelineEntry {
    var rangeLabel: String {
        let turns = fromTurn == toTurn ? "Turn \(fromTurn)" : "Turns \(fromTurn)–\(toTurn)"
        let start = Self.date(fromCompletedAt)
        let end = Self.date(toCompletedAt)
        guard let start else { return turns }
        if let end, !Calendar.current.isDate(start, inSameDayAs: end) {
            return "\(turns) · \(start.formatted(date: .abbreviated, time: .omitted))–\(end.formatted(date: .abbreviated, time: .omitted))"
        }
        return "\(turns) · \(start.formatted(date: .abbreviated, time: .omitted))"
    }

    private static func date(_ value: String) -> Date? {
        if let date = try? Date(
            value,
            strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        ) {
            return date
        }
        return try? Date(value, strategy: Date.ISO8601FormatStyle())
    }
}
