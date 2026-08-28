import Foundation

actor FeatureClientOfflineCacheStore {
    struct Entry: Codable, Sendable, Equatable {
        let environmentID: String
        var shell: OrchestrationShellSnapshot?
        var serverConfig: ServerConfigSnapshot?
        var archivedThreads: [FeatureThread]
        var threadDetails: [String: FeatureThreadDetail]
        var branchStatuses: [String: FeatureSourceControlStatus]

        init(
            environmentID: String,
            shell: OrchestrationShellSnapshot? = nil,
            serverConfig: ServerConfigSnapshot? = nil,
            archivedThreads: [FeatureThread] = [],
            threadDetails: [String: FeatureThreadDetail] = [:],
            branchStatuses: [String: FeatureSourceControlStatus] = [:]
        ) {
            self.environmentID = environmentID
            self.shell = shell
            self.serverConfig = serverConfig
            self.archivedThreads = archivedThreads
            self.threadDetails = threadDetails
            self.branchStatuses = branchStatuses
        }
    }

    private struct Document: Codable {
        var version = 1
        var entries: [String: Entry]
    }

    private let fileURL: URL
    private let fileManager: FileManager
    private var cachedDocument: Document?
    private var generations: [String: Int] = [:]

    init(fileURL: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let root = fileManager.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first!
            self.fileURL = root
                .appendingPathComponent("T3CodeSwift", isDirectory: true)
                .appendingPathComponent("offline-client-cache.json")
        }
    }

    func entries() throws -> [Entry] {
        Array(try loadDocument().entries.values)
            .sorted { $0.environmentID < $1.environmentID }
    }

    func summary() throws -> FeatureClientCache.Summary {
        let encoder = JSONEncoder.t3
        var records: [FeatureClientCache.Record] = []
        for entry in try entries() {
            if let shell = entry.shell {
                records.append(.init(
                    environmentID: entry.environmentID,
                    kind: .threads,
                    recordCount: max(shell.threads.count, 1),
                    payloadBytes: try encoder.encode(shell).count
                ))
            }
            if let serverConfig = entry.serverConfig {
                records.append(.init(
                    environmentID: entry.environmentID,
                    kind: .serverMetadata,
                    payloadBytes: try encoder.encode(serverConfig).count
                ))
            }
            if !entry.archivedThreads.isEmpty {
                records.append(.init(
                    environmentID: entry.environmentID,
                    kind: .threads,
                    recordCount: entry.archivedThreads.count,
                    payloadBytes: try encoder.encode(entry.archivedThreads).count
                ))
            }
            if !entry.threadDetails.isEmpty {
                records.append(.init(
                    environmentID: entry.environmentID,
                    kind: .threads,
                    recordCount: entry.threadDetails.count,
                    payloadBytes: try encoder.encode(entry.threadDetails).count
                ))
            }
            if !entry.branchStatuses.isEmpty {
                records.append(.init(
                    environmentID: entry.environmentID,
                    kind: .branches,
                    recordCount: entry.branchStatuses.count,
                    payloadBytes: try encoder.encode(entry.branchStatuses).count
                ))
            }
        }
        return FeatureClientCache.Summary(records: records)
    }

    func save(_ entry: Entry, generation: Int) throws {
        guard generations[entry.environmentID, default: 0] == generation else { return }
        var document = try loadDocument()
        document.entries[entry.environmentID] = entry
        try persist(document)
    }

    func remove(environmentIDs: Set<String>, generations next: [String: Int]) throws {
        var document = try loadDocument()
        for environmentID in environmentIDs {
            document.entries[environmentID] = nil
        }
        try persist(document)
        for (environmentID, generation) in next {
            generations[environmentID] = generation
        }
    }

    private func loadDocument() throws -> Document {
        if let cachedDocument { return cachedDocument }
        guard fileManager.fileExists(atPath: fileURL.path) else {
            let document = Document(entries: [:])
            cachedDocument = document
            return document
        }
        let document = try JSONDecoder.t3.decode(
            Document.self,
            from: Data(contentsOf: fileURL)
        )
        guard document.version == 1 else { throw CocoaError(.fileReadCorruptFile) }
        cachedDocument = document
        return document
    }

    private func persist(_ document: Document) throws {
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder.t3.encode(document).write(to: fileURL, options: .atomic)
        cachedDocument = document
    }
}
