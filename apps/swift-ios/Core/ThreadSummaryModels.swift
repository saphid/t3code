import Foundation

public struct ThreadSummaryTimeline: Codable, Equatable, Sendable {
    public let entries: [ThreadSummaryTimelineEntry]
}

public struct ThreadSummaryTimelineEntry: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public let fromTurn: Int
    public let toTurn: Int
    public let fromCompletedAt: String
    public let toCompletedAt: String
    public let summary: String
    public let promptVersion: String
    public let model: String
}
