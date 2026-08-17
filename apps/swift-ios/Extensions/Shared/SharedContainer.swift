import Foundation

enum T3SharedContainer {
    #if DEBUG
    static let appGroupID = "group.com.alxs.t3code.typed-swiftui.dev"
    static let urlScheme = "t3code-swiftui"
    #else
    static let appGroupID = "group.com.t3tools.t3code.swiftui"
    static let urlScheme = "t3code-swiftui"
    #endif

    static var rootURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        )
    }
}
