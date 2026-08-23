import Foundation
import UIKit

struct ThreadMetadataCopyContext: Equatable, Sendable {
    let projectName: String?
    let environmentName: String?
    let environmentID: String?

    init(
        projectName: String?,
        environmentName: String?,
        environmentID: String? = nil
    ) {
        self.projectName = projectName
        self.environmentName = environmentName
        self.environmentID = environmentID
    }
}

struct ThreadMetadataCopyPayload: Equatable, Sendable {
    let text: String
    let confirmation = "Thread metadata copied"
}

enum ThreadMetadataCopyModel {
    static func payload(
        for thread: FeatureThread,
        context: ThreadMetadataCopyContext
    ) -> ThreadMetadataCopyPayload? {
        var lines: [String] = []

        append("Thread", value: thread.title, to: &lines)
        append("Thread ID", value: nonEmpty(thread.wireID) ?? nonEmpty(thread.id), to: &lines)
        append("Project", value: context.projectName, to: &lines)
        append("Branch", value: thread.branch, to: &lines)
        append("Environment", value: context.environmentName, to: &lines)

        let environmentID = nonEmpty(thread.environmentID) ?? nonEmpty(context.environmentID)
        if let url = threadURL(environmentID: environmentID, threadID: nonEmpty(thread.wireID)) {
            append("URL", value: url, to: &lines)
        }

        guard !lines.isEmpty else { return nil }
        return ThreadMetadataCopyPayload(text: lines.joined(separator: "\n"))
    }

    private static func append(_ label: String, value: String?, to lines: inout [String]) {
        guard let value = nonEmpty(value) else { return }
        lines.append("\(label): \(value)")
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func threadURL(environmentID: String?, threadID: String?) -> String? {
        guard let environmentID,
              let threadID,
              let encodedEnvironmentID = pathSegment(environmentID),
              let encodedThreadID = pathSegment(threadID) else {
            return nil
        }

        var components = URLComponents()
        components.scheme = "https"
        components.host = "app.t3.codes"
        components.percentEncodedPath = "/\(encodedEnvironmentID)/\(encodedThreadID)"
        return components.url?.absoluteString
    }

    private static func pathSegment(_ value: String) -> String? {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        return value.addingPercentEncoding(withAllowedCharacters: allowed)
    }
}

@MainActor
enum ThreadMetadataClipboard {
    static func copy(_ payload: ThreadMetadataCopyPayload) {
        UIPasteboard.general.string = payload.text
        UIAccessibility.post(notification: .announcement, argument: payload.confirmation)
    }
}
