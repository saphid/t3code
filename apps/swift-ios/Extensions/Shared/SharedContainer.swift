import Foundation

enum T3SharedContainer {
    #if DEBUG
    static let appGroupID = "group.com.t3tools.t3code.swiftui.dev"
    private static let compiledURLScheme = "t3code-swiftui-dev"
    #else
    static let appGroupID = "group.com.t3tools.t3code.swiftui"
    private static let compiledURLScheme = "t3code-swiftui"
    #endif

    /// An extension can only open the app it ships inside, so every link it
    /// builds uses the scheme its own build channel configured.
    static var urlScheme: String {
        configuredURLScheme(Bundle.main.infoDictionary)
    }

    /// A configured scheme counts only when it can form this build's own link;
    /// an unset or unsubstituted setting falls back to the compiled channel.
    static func configuredURLScheme(_ info: [String: Any]?) -> String {
        guard let value = info?["T3CodeURLScheme"] as? String,
              newTaskURL(scheme: value).scheme?.lowercased() == value.lowercased()
        else {
            return compiledURLScheme
        }
        return value
    }

    /// The fallback destination for widget surfaces that have no task to open.
    static var newTaskURL: URL {
        newTaskURL(scheme: urlScheme)
    }

    static func newTaskURL(scheme: String) -> URL {
        guard !scheme.isEmpty, let url = URL(string: "\(scheme)://new-task") else {
            return compiledNewTaskURL
        }
        return url
    }

    static var rootURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        )
    }

    private static let compiledNewTaskURL = URL(string: "\(compiledURLScheme)://new-task")!
}
