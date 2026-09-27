import Foundation
import Testing
@testable import T3Code

@Suite("Native event log")
struct NativeEventLogTests {
    @Test("Rotation keeps recent lines in order within the size limit")
    func rotationKeepsRecentLinesInOrder() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "t3-event-log-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = NativeEventLog(directory: directory, maximumFileBytes: 400)
        for index in 0..<40 {
            log.record("test", "event \(index)")
        }
        let lines = await log.contents().split(separator: "\n").map(String.init)
        let numbers = lines.compactMap { $0.split(separator: " ").last.flatMap { Int($0) } }
        #expect(numbers.last == 39)
        #expect(numbers == numbers.sorted())
        #expect(numbers.count < 40, "Old lines rotate out once both files are full.")
        let current = try Data(contentsOf: log.currentURL)
        #expect(current.count <= 400)
        #expect(lines.allSatisfy { $0.contains(" [test] event ") })
    }

    @Test("Clearing removes both files")
    func clearingRemovesBothFiles() async {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "t3-event-log-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let log = NativeEventLog(directory: directory, maximumFileBytes: 200)
        for index in 0..<20 {
            log.record("test", "event \(index)")
        }
        await log.clear()
        #expect(await log.contents().isEmpty)
        log.record("test", "after clear")
        #expect(await log.contents().contains("after clear"))
    }
}
