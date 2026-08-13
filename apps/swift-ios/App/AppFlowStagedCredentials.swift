#if DEBUG
import Foundation

struct AppFlowStagedCredentials: Decodable {
    static let enableArgument = "-app-flow-staged-credentials"
    static let fileName = ".t3-app-flow-credentials.json"

    let server: String
    let token: String

    static func consumeIfRequested() -> Self? {
        guard ProcessInfo.processInfo.arguments.contains(enableArgument),
              let caches = FileManager.default.urls(
                  for: .cachesDirectory,
                  in: .userDomainMask
              ).first
        else {
            return nil
        }

        let file = caches.appendingPathComponent(fileName, isDirectory: false)
        defer { try? FileManager.default.removeItem(at: file) }
        guard let data = try? Data(contentsOf: file),
              let credentials = try? JSONDecoder().decode(Self.self, from: data),
              !credentials.server.isEmpty,
              credentials.token.count >= 8
        else {
            return nil
        }
        return credentials
    }
}
#endif
