import Foundation

public struct PersonalFleetPairingHost: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let httpsBaseURL: URL

    public init(id: String, label: String, httpsBaseURL: URL) {
        self.id = id
        self.label = label
        self.httpsBaseURL = httpsBaseURL
    }

    private init(id: String, label: String, httpsBase: String) {
        guard let httpsBaseURL = URL(string: httpsBase) else {
            preconditionFailure("Invalid personal fleet URL for \(id)")
        }
        self.init(id: id, label: label, httpsBaseURL: httpsBaseURL)
    }

    #if T3_PERSONAL_CONNECT
    public static let all: [PersonalFleetPairingHost] = [
        PersonalFleetPairingHost(
            id: "macbook-pro",
            label: "MacBook Pro",
            httpsBase: "https://alexs-macbook-pro-1.tail4e5636.ts.net:4001"
        ),
        PersonalFleetPairingHost(
            id: "macbook-air",
            label: "MacBook Air",
            httpsBase: "https://alexs-macbook-air.tail4e5636.ts.net:4001"
        ),
        PersonalFleetPairingHost(
            id: "lxso1",
            label: "LXSO1",
            httpsBase: "https://lxso1.tail4e5636.ts.net:4001"
        ),
        PersonalFleetPairingHost(
            id: "lxso2",
            label: "LXSO2",
            httpsBase: "https://lxso2.tail4e5636.ts.net"
        ),
        PersonalFleetPairingHost(
            id: "lxso3",
            label: "LXSO3",
            httpsBase: "https://lxso3.tail4e5636.ts.net:4001"
        ),
        PersonalFleetPairingHost(
            id: "nursedroid",
            label: "NurseDroid",
            httpsBase: "https://nursedroid.tail4e5636.ts.net"
        ),
    ]
    #else
    public static let all: [PersonalFleetPairingHost] = []
    #endif
}
