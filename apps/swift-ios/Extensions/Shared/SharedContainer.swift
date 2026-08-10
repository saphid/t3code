import Foundation

enum T3SharedContainer {
    #if DEBUG
    static let appGroupID = "group.com.alxs.t3code.typed-swiftui.dev"
    static let urlScheme = "t3code-typed-swiftui-dev"
    #else
    static let appGroupID = "group.com.alxs.t3code.typed-swiftui"
    static let urlScheme = "t3code-typed-swiftui"
    #endif

    static var rootURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        )
    }
}
