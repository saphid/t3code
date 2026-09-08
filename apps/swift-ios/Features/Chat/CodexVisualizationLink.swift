import Foundation

/// A host-file reference, resolved by the thread's environment only after a tap.
struct CodexVisualizationLink: Equatable, Sendable {
    let path: String

    init?(path: String) {
        guard !path.isEmpty, path.utf8.count <= 4_096,
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              path.lowercased().hasSuffix(".html") || path.lowercased().hasSuffix(".htm") else {
            return nil
        }
        let windowsDrive = path.range(of: #"^[A-Za-z]:[\\/]"#, options: .regularExpression) != nil
        if !windowsDrive,
           path.range(of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#, options: .regularExpression) != nil {
            return nil
        }
        self.path = path
    }

    init?(payload: Data) {
        struct Payload: Decodable { let path: String }
        guard let value = try? JSONDecoder().decode(Payload.self, from: payload) else { return nil }
        self.init(path: value.path)
    }

    var url: URL? {
        var components = URLComponents()
        components.scheme = "t3code"
        components.host = "visualization"
        components.path = "/open"
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url
    }

    static func parse(_ url: URL) -> Self? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "t3code", components.host == "visualization",
              components.path == "/open", components.user == nil, components.password == nil,
              components.port == nil, components.fragment == nil,
              let items = components.queryItems, items.count == 1,
              items[0].name == "path", let path = items[0].value else { return nil }
        return Self(path: path)
    }

    static func isBrowserURL(_ url: URL) -> Bool {
        (url.scheme == "https" || url.scheme == "http") && url.host?.isEmpty == false
            && url.user == nil && url.password == nil
    }

    @MainActor
    func resolveBrowserURL(
        threadID: String,
        resolve: @MainActor (String, String) async throws -> URL
    ) async throws -> URL {
        try Task.checkCancellation()
        let resolved = try await resolve(threadID, path)
        try Task.checkCancellation()
        guard Self.isBrowserURL(resolved) else { throw URLError(.unsupportedURL) }
        return resolved
    }
}
