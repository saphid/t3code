import Foundation
import Testing
@testable import T3Code

@Suite("Personal fleet pairing")
struct PersonalFleetPairingTests {
    @Test
    func requestsBrokerLinkWithoutCachingAndAcceptsMatchingOrigin() async throws {
        let host = try testHost()
        let transport = PersonalFleetPairingTransport(
            body: #"{"pairingUrl":"https://pairing.example:4001/pair#token=PAIR-ONCE"}"#,
            status: 200
        )
        let service = PersonalFleetPairingService(transport: transport)

        let pairingURL = try await service.pairingURL(for: host)

        #expect(
            pairingURL == "https://pairing.example:4001/pair#token=PAIR-ONCE"
        )
        let requests = await transport.requests
        let request = try #require(requests.first)
        #expect(request.url?.path == "/__t3/mobile-pair")
        #expect(request.httpMethod == "GET")
        #expect(request.cachePolicy == .reloadIgnoringLocalAndRemoteCacheData)
        #expect(request.timeoutInterval == 15)
    }

    @Test(arguments: [
        #"{"pairingUrl":"https://attacker.example/#token=PAIR-ONCE"}"#,
        #"{"pairingUrl":"http://pairing.example:4001/pair#token=PAIR-ONCE"}"#,
        #"{"pairingUrl":"https://pairing.example:4001/pair#other=PAIR-ONCE"}"#,
        #"{"pairingUrl":"https://pairing.example:4001/pair#code=&token=PAIR-ONCE"}"#,
        #"{"pairingUrl":"https://pairing.example:4001/admin#token=PAIR-ONCE"}"#,
        #"{"pairingUrl":"https://pairing.example:4001/pair?leak=yes#token=PAIR-ONCE"}"#,
    ])
    func rejectsPairingLinksOutsideTheSelectedHostBoundary(_ body: String) async throws {
        let host = try testHost()
        let service = PersonalFleetPairingService(
            transport: PersonalFleetPairingTransport(body: body, status: 200)
        )

        await #expect(throws: PersonalFleetPairingError.invalidResponse(host: host.label)) {
            try await service.pairingURL(for: host)
        }
    }

    @Test
    func reportsBrokerStatusWithoutParsingItsBody() async throws {
        let host = try testHost()
        let service = PersonalFleetPairingService(
            transport: PersonalFleetPairingTransport(body: "not JSON", status: 403)
        )

        await #expect(throws: PersonalFleetPairingError.unavailable(host: host.label, status: 403)) {
            try await service.pairingURL(for: host)
        }
    }

    @Test
    func acceptsDeployedBrokerRootPath() async throws {
        let host = try testHost()
        let service = PersonalFleetPairingService(
            transport: PersonalFleetPairingTransport(
                body: #"{"pairingUrl":"https://pairing.example:4001/#token=PAIR-ONCE"}"#,
                status: 200
            )
        )

        let pairingURL = try await service.pairingURL(for: host)

        #expect(pairingURL == "https://pairing.example:4001/#token=PAIR-ONCE")
    }

    @Test
    func keepsThePrivateFleetExplicitAndStable() {
        #if T3_PERSONAL_CONNECT
        #expect(PersonalFleetPairingHost.all.map(\.id) == [
            "macbook-pro",
            "macbook-air",
            "lxso1",
            "lxso2",
            "lxso3",
            "nursedroid",
        ])
        #expect(PersonalFleetPairingHost.all.map(\.httpsBaseURL.absoluteString) == [
            "https://alexs-macbook-pro-1.tail4e5636.ts.net:4001",
            "https://alexs-macbook-air.tail4e5636.ts.net:4001",
            "https://lxso1.tail4e5636.ts.net:4001",
            "https://lxso2.tail4e5636.ts.net",
            "https://lxso3.tail4e5636.ts.net:4001",
            "https://nursedroid.tail4e5636.ts.net",
        ])
        #else
        #expect(PersonalFleetPairingHost.all.isEmpty)
        #endif
    }

    @Test(arguments: [
        #"{"pairingUrl":"https://user:password@pairing.example:4001/pair#token=PAIR-ONCE"}"#,
        #"{"pairingUrl":"https://pairing.example:9999/pair#token=PAIR-ONCE"}"#,
    ])
    func rejectsUserInfoAndUnexpectedPorts(_ body: String) async throws {
        let host = try testHost()
        let service = PersonalFleetPairingService(
            transport: PersonalFleetPairingTransport(body: body, status: 200)
        )

        await #expect(throws: PersonalFleetPairingError.invalidResponse(host: host.label)) {
            try await service.pairingURL(for: host)
        }
    }

    @Test
    func acceptsExplicitDefaultHTTPSPort() async throws {
        let httpsBaseURL = try #require(URL(string: "https://default-port.example"))
        let host = PersonalFleetPairingHost(
            id: "default-port",
            label: "Default Port",
            httpsBaseURL: httpsBaseURL
        )
        let service = PersonalFleetPairingService(
            transport: PersonalFleetPairingTransport(
                body: #"{"pairingUrl":"https://default-port.example:443/pair#token=PAIR-ONCE"}"#,
                status: 200
            )
        )

        let pairingURL = try await service.pairingURL(for: host)

        #expect(pairingURL.contains("token=PAIR-ONCE"))
    }

    private func testHost() throws -> PersonalFleetPairingHost {
        let httpsBaseURL = try #require(
            URL(string: "https://pairing.example:4001")
        )
        return PersonalFleetPairingHost(
            id: "test-host",
            label: "Test Host",
            httpsBaseURL: httpsBaseURL
        )
    }
}

private actor PersonalFleetPairingTransport: HTTPTransport {
    private let body: String
    private let status: Int
    private(set) var requests: [URLRequest] = []

    init(body: String, status: Int) {
        self.body = body
        self.status = status
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(body.utf8), response)
    }
}
