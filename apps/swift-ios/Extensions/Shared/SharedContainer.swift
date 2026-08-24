import Foundation

struct T3SharedContainerConfiguration: Equatable, Sendable {
    let appGroupID: String
    let urlScheme: String
    let buildChannel: String?

    init?(infoDictionary: [String: Any]?) {
        guard let appGroupID = Self.value(named: "T3AppGroupIdentifier", in: infoDictionary),
              let urlScheme = Self.value(named: "T3URLScheme", in: infoDictionary),
              Self.matches(appGroupID, pattern: #"^group\.[A-Za-z0-9.-]+$"#),
              Self.matches(urlScheme, pattern: #"^[a-z][a-z0-9+.-]*$"#),
              let buildChannel = Self.optionalBuildChannel(in: infoDictionary)
        else {
            return nil
        }
        self.appGroupID = appGroupID
        self.urlScheme = urlScheme
        self.buildChannel = buildChannel
    }

    static var current: T3SharedContainerConfiguration {
        guard let configuration = T3SharedContainerConfiguration(
            infoDictionary: Bundle.main.infoDictionary
        ) else {
            preconditionFailure("T3 shared-container build identity is missing from Info.plist")
        }
        return configuration
    }

    func routeURL(host: String, queryItems: [URLQueryItem] = []) -> URL? {
        var components = URLComponents()
        components.scheme = urlScheme
        components.host = host
        components.queryItems = queryItems
        return components.url
    }

    private static func value(named name: String, in infoDictionary: [String: Any]?) -> String? {
        guard let value = infoDictionary?[name] as? String,
              !value.isEmpty,
              value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.contains("$(")
        else {
            return nil
        }
        return value
    }

    private static func optionalBuildChannel(in infoDictionary: [String: Any]?) -> String?? {
        guard let rawValue = infoDictionary?["T3BuildChannel"] else { return .some(nil) }
        guard let value = rawValue as? String else { return nil }
        if value.isEmpty { return .some(nil) }
        guard let exactValue = self.value(named: "T3BuildChannel", in: infoDictionary),
              matches(exactValue, pattern: #"^[a-z][a-z0-9-]*$"#)
        else {
            return nil
        }
        return .some(exactValue)
    }

    private static func matches(_ value: String, pattern: String) -> Bool {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return false }
        return expression.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
        ) != nil
    }
}

enum T3SharedContainer {
    static let configuration = T3SharedContainerConfiguration.current
    static let appGroupID = configuration.appGroupID
    static let urlScheme = configuration.urlScheme

    static var rootURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        )
    }
}
