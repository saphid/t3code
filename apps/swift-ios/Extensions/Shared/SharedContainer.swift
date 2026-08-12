import Foundation

enum T3SharedContainer {
    static var defaultAppGroupID: String {
        let channel = (Bundle.main.object(forInfoDictionaryKey: "T3BuildChannel") as? String)?
            .lowercased()
        return switch channel {
        case "dev": "group.com.saphid.t3code.swiftui.dev"
        case "test": "group.com.alxs.t3code.typed-swiftui.dev"
        case "debug": "group.com.t3tools.t3code.swiftui.dev"
        default: "group.com.t3tools.t3code.swiftui"
        }
    }

    static var urlScheme: String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "T3CodeURLScheme") as? String,
              !value.isEmpty,
              !value.hasPrefix("$(")
        else {
            let channel = (Bundle.main.object(forInfoDictionaryKey: "T3BuildChannel") as? String)?
                .lowercased()
            return switch channel {
            case "dev": "t3code-swiftui-personal-dev"
            case "test": "t3code-swiftui-personal"
            case "debug": "t3code-swiftui-dev"
            default: "t3code-swiftui"
            }
        }
        return value
    }

    static var appGroupID: String {
        configuredAppGroupID(
            Bundle.main.object(forInfoDictionaryKey: "T3CodeAppGroupIdentifier") as? String
        )
    }

    static func configuredAppGroupID(_ value: String?) -> String {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.hasPrefix("group."),
              value.count > "group.".count else {
            return defaultAppGroupID
        }
        return value
    }

    static var rootURL: URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupID
        )
    }
}
