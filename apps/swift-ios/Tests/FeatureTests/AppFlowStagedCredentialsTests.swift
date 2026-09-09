#if DEBUG
import Foundation
import Testing
@testable import T3Code

@Suite("Staged diagnostic credentials")
struct AppFlowStagedCredentialsTests {
    @Test
    func privateFileIsConsumedAndDeleted() throws {
        let file = try stagedFile(permissions: 0o600)
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let credentials = AppFlowStagedCredentials.consume(at: file)
        #expect(credentials?.server == "http://127.0.0.1:3773")
        #expect(credentials?.token == "fixture-code")
        #expect(!FileManager.default.fileExists(atPath: file.path))
        #expect(AppFlowStagedCredentials.consume(at: file) == nil)
    }

    @Test(arguments: [0o644, 0o666])
    func broadlyReadableFileIsRejectedAndDeleted(permissions: Int) throws {
        let file = try stagedFile(permissions: permissions)
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        #expect(AppFlowStagedCredentials.consume(at: file) == nil)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    @Test
    func malformedFileIsDeleted() throws {
        let file = try stagedFile(permissions: 0o600)
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try Data("{}".utf8).write(to: file)
        #expect(AppFlowStagedCredentials.consume(at: file) == nil)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    private func stagedFile(permissions: Int) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("t3-staged-credentials-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent(AppFlowStagedCredentials.fileName)
        let data = try JSONSerialization.data(withJSONObject: [
            "server": "http://127.0.0.1:3773", "token": "fixture-code"
        ])
        try data.write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: permissions], ofItemAtPath: file.path)
        return file
    }
}
#endif
