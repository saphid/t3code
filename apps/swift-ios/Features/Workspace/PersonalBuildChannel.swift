import SwiftUI

enum PersonalBuildChannel: String, Equatable {
    case upstream
    case debug
    case dev
    case test

    init(info: [String: Any]?) {
        let value = (info?["T3BuildChannel"] as? String)?.lowercased()
        self = PersonalBuildChannel(rawValue: value ?? "") ?? .upstream
    }

    static let current = PersonalBuildChannel(info: Bundle.main.infoDictionary)

    var titleSuffix: String? {
        switch self {
        case .upstream: nil
        case .debug: "Debug"
        case .dev: "Dev"
        case .test: "Test"
        }
    }

    var color: Color {
        switch self {
        case .upstream: T3Colors.textSecondary
        case .debug: .orange
        case .dev: .orange
        case .test: .purple
        }
    }

    var showsBuildIdentity: Bool { self != .upstream }
}
