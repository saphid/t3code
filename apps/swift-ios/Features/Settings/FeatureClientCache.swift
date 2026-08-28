import Foundation

public enum FeatureClientCache {
    public enum Kind: String, Sendable, Equatable, Hashable {
        case threads
        case serverMetadata
        case branches
    }

    public struct Record: Sendable, Equatable {
        public let environmentID: String
        public let kind: Kind
        public let recordCount: Int
        public let payloadBytes: Int

        public init(
            environmentID: String,
            kind: Kind,
            recordCount: Int = 1,
            payloadBytes: Int
        ) {
            self.environmentID = environmentID
            self.kind = kind
            self.recordCount = recordCount
            self.payloadBytes = payloadBytes
        }
    }

    public struct EnvironmentSummary: Identifiable, Sendable, Equatable {
        public let environmentID: String
        public let recordCount: Int
        public let payloadBytes: Int
        public let countsByKind: [Kind: Int]

        public var id: String { environmentID }
    }

    public struct Summary: Sendable, Equatable {
        public let recordCount: Int
        public let payloadBytes: Int
        public let environments: [EnvironmentSummary]

        public init(records: [Record]) {
            var grouped: [String: (count: Int, bytes: Int, kinds: [Kind: Int])] = [:]
            var totalCount = 0
            var totalBytes = 0

            for record in records {
                totalCount += record.recordCount
                totalBytes += record.payloadBytes
                var environment = grouped[record.environmentID] ?? (0, 0, [:])
                environment.count += record.recordCount
                environment.bytes += record.payloadBytes
                environment.kinds[record.kind, default: 0] += record.recordCount
                grouped[record.environmentID] = environment
            }

            recordCount = totalCount
            payloadBytes = totalBytes
            environments = grouped.map { environmentID, value in
                EnvironmentSummary(
                    environmentID: environmentID,
                    recordCount: value.count,
                    payloadBytes: value.bytes,
                    countsByKind: value.kinds
                )
            }
            .sorted { $0.environmentID < $1.environmentID }
        }
    }

    public enum Scope: Sendable, Equatable {
        case environment(String)
        case all
    }

    public static func environmentIDs(
        for scope: Scope,
        among cachedEnvironmentIDs: Set<String>
    ) -> Set<String> {
        switch scope {
        case let .environment(environmentID): [environmentID]
        case .all: cachedEnvironmentIDs
        }
    }
}
