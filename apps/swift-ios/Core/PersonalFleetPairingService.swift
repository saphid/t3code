import Foundation

public struct PersonalFleetPairingService: PersonalFleetPairingRequesting {
    public static let shared = PersonalFleetPairingService()

    private struct Response: Decodable {
        let pairingUrl: String
    }

    private let transport: any HTTPTransport

    public init(transport: any HTTPTransport = URLSessionHTTPTransport()) {
        self.transport = transport
    }

    public func pairingURL(for host: PersonalFleetPairingHost) async throws -> String {
        let endpoint = host.httpsBaseURL.appending(path: "__t3/mobile-pair")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 15
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            throw PersonalFleetPairingError.unavailable(
                host: host.label,
                status: response.statusCode
            )
        }
        guard let payload = try? JSONDecoder.t3.decode(Response.self, from: data),
              let pairingURL = URL(string: payload.pairingUrl),
              isValid(pairingURL, for: host)
        else {
            throw PersonalFleetPairingError.invalidResponse(host: host.label)
        }
        return pairingURL.absoluteString
    }

    private func isValid(_ pairingURL: URL, for host: PersonalFleetPairingHost) -> Bool {
        guard let pairing = URLComponents(url: pairingURL, resolvingAgainstBaseURL: false),
              let expected = URLComponents(
                  url: host.httpsBaseURL,
                  resolvingAgainstBaseURL: false
              ),
              pairing.scheme?.lowercased() == "https",
              pairing.scheme?.lowercased() == expected.scheme?.lowercased(),
              pairing.host?.lowercased() == expected.host?.lowercased(),
              effectivePort(pairing) == effectivePort(expected),
              pairing.user == nil,
              pairing.password == nil,
              isAcceptedPairingPath(pairing.path),
              pairing.query == nil,
              let fragment = pairing.percentEncodedFragment,
              let fragmentItems = URLComponents(string: "?\(fragment)")?.queryItems,
              fragmentItems.count == 1,
              let tokenItem = fragmentItems.first,
              tokenItem.name == "token",
              let token = tokenItem.value,
              !token.isEmpty
        else {
            return false
        }
        return true
    }

    private func effectivePort(_ components: URLComponents) -> Int? {
        if let port = components.port { return port }
        return components.scheme?.lowercased() == "https" ? 443 : nil
    }

    private func isAcceptedPairingPath(_ path: String) -> Bool {
        path.isEmpty || path == "/" || path == "/pair"
    }
}
