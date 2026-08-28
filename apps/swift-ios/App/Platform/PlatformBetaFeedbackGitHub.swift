import Foundation
import Security

struct PlatformBetaFeedbackGitHubConfiguration: Equatable, Sendable {
    var repository: String
    var feedbackBranch: String
    var token: String

    var validationMessage: String? {
        let repositoryParts = repository.split(separator: "/", omittingEmptySubsequences: false)
        guard repositoryParts.count == 2,
              repositoryParts.allSatisfy({ Self.isValidPathComponent(String($0)) }) else {
            return "Enter a repository as owner/name."
        }
        guard Self.isValidPathComponent(feedbackBranch) else {
            return "Enter the existing branch used for feedback images."
        }
        if ["main", "master"].contains(feedbackBranch.lowercased()) {
            return "Use a dedicated non-default branch for feedback images."
        }
        guard token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return "Enter a fine-grained GitHub token with Issues and Contents write access."
        }
        return nil
    }

    private static func isValidPathComponent(_ value: String) -> Bool {
        guard value.isEmpty == false,
              value != ".",
              value != ".." else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || ["-", "_", "."].contains(Character($0))
        }
    }
}

struct PlatformBetaFeedbackGitHubIssue: Identifiable, Equatable, Sendable {
    var id: Int { number }
    let number: Int
    let title: String
    let url: URL
}

enum PlatformBetaFeedbackGitHubSubmission: Equatable, Sendable {
    case create(title: String)
    case update(issueNumber: Int, title: String)
}

struct PlatformBetaFeedbackGitHubUpload: Equatable, Sendable {
    let url: URL
    let path: String
    let sha: String
}

struct PlatformBetaFeedbackGitHubGateway: Sendable {
    var uploadScreenshot: @Sendable (
        _ screenshotJPEG: Data,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> PlatformBetaFeedbackGitHubUpload
    var deleteScreenshot: @Sendable (
        _ upload: PlatformBetaFeedbackGitHubUpload,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> Void
    var createIssue: @Sendable (
        _ title: String,
        _ body: String,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> PlatformBetaFeedbackGitHubIssue
    var addComment: @Sendable (
        _ issueNumber: Int,
        _ body: String,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> URL

    func submit(
        _ submission: PlatformBetaFeedbackGitHubSubmission,
        report: String,
        screenshotJPEG: Data,
        configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> PlatformBetaFeedbackGitHubIssue {
        if let validationMessage = configuration.validationMessage {
            throw PlatformBetaFeedbackGitHubError.invalidConfiguration(validationMessage)
        }
        let validatedSubmission: PlatformBetaFeedbackGitHubSubmission
        switch submission {
        case let .create(title):
            let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmedTitle.isEmpty == false else {
                throw PlatformBetaFeedbackGitHubError.invalidConfiguration("Enter an issue title.")
            }
            validatedSubmission = .create(title: String(trimmedTitle.prefix(120)))
        case let .update(issueNumber, title):
            guard issueNumber > 0 else {
                throw PlatformBetaFeedbackGitHubError.invalidConfiguration("Choose an existing issue.")
            }
            validatedSubmission = .update(issueNumber: issueNumber, title: title)
        }

        let reportBody = report.trimmingCharacters(in: .whitespacesAndNewlines)
        switch validatedSubmission {
        case let .create(title):
            let issue = try await createIssue(title, reportBody, configuration)
            do {
                _ = try await attachScreenshot(
                    to: issue.number,
                    screenshotJPEG: screenshotJPEG,
                    configuration: configuration
                )
                return issue
            } catch {
                throw PlatformBetaFeedbackGitHubError.attachmentFailed(
                    issueURL: issue.url,
                    message: error.localizedDescription
                )
            }
        case let .update(issueNumber, title):
            let reportURL = try await addComment(issueNumber, reportBody, configuration)
            do {
                let commentURL = try await attachScreenshot(
                    to: issueNumber,
                    screenshotJPEG: screenshotJPEG,
                    configuration: configuration
                )
                return PlatformBetaFeedbackGitHubIssue(
                    number: issueNumber,
                    title: title,
                    url: commentURL
                )
            } catch {
                throw PlatformBetaFeedbackGitHubError.attachmentFailed(
                    issueURL: reportURL,
                    message: error.localizedDescription
                )
            }
        }
    }

    private func attachScreenshot(
        to issueNumber: Int,
        screenshotJPEG: Data,
        configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> URL {
        let upload = try await uploadScreenshot(screenshotJPEG, configuration)
        do {
            return try await addComment(
                issueNumber,
                Self.screenshotBody(url: upload.url),
                configuration
            )
        } catch {
            let submissionError = error
            let rollback = Task.detached {
                try await deleteScreenshot(upload, configuration)
            }
            do {
                try await rollback.value
            } catch {
                throw PlatformBetaFeedbackGitHubError.rollbackFailed(screenshotURL: upload.url)
            }
            throw submissionError
        }
    }

    private static func screenshotBody(url: URL) -> String {
        """
        Annotated screenshot
        [Open the exact annotated beta feedback screenshot](\(url.absoluteString))
        """
    }
}

enum PlatformBetaFeedbackGitHubError: LocalizedError, Sendable {
    case invalidConfiguration(String)
    case invalidResponse
    case requestFailed(status: Int, message: String)
    case attachmentFailed(issueURL: URL, message: String)
    case rollbackFailed(screenshotURL: URL)

    var errorDescription: String? {
        switch self {
        case let .invalidConfiguration(message):
            message
        case .invalidResponse:
            "GitHub returned an unreadable response. The report is still saved here."
        case let .requestFailed(status, message):
            "GitHub returned \(status): \(message) The report is still saved here."
        case let .attachmentFailed(issueURL, message):
            "The report was posted at \(issueURL.absoluteString), but the screenshot was not attached: \(message) The report is still saved here."
        case let .rollbackFailed(screenshotURL):
            "GitHub did not attach the screenshot and could not remove its branch upload at \(screenshotURL.absoluteString). The report is still saved here."
        }
    }
}

struct PlatformBetaFeedbackGitHubAPI: Sendable {
    struct Transport: Sendable {
        var send: @Sendable (URLRequest) async throws -> (Data, Int)

        static let live = Self(send: { request in
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw PlatformBetaFeedbackGitHubError.invalidResponse
            }
            return (data, response.statusCode)
        })
    }

    private struct IssueResponse: Decodable {
        let number: Int
        let title: String
        let htmlURL: URL
        let pullRequest: PullRequestMarker?

        private enum CodingKeys: String, CodingKey {
            case number
            case title
            case htmlURL = "html_url"
            case pullRequest = "pull_request"
        }
    }

    private struct PullRequestMarker: Decodable {}

    private struct CommentResponse: Decodable {
        let htmlURL: URL

        private enum CodingKeys: String, CodingKey {
            case htmlURL = "html_url"
        }
    }

    private struct UploadResponse: Decodable {
        struct Content: Decodable {
            let htmlURL: URL
            let sha: String

            private enum CodingKeys: String, CodingKey {
                case htmlURL = "html_url"
                case sha
            }
        }

        let content: Content
    }

    private struct ErrorResponse: Decodable {
        let message: String
    }

    private let transport: Transport

    init(transport: Transport = .live) {
        self.transport = transport
    }

    var gateway: PlatformBetaFeedbackGitHubGateway {
        PlatformBetaFeedbackGitHubGateway(
            uploadScreenshot: { [self] data, configuration in
                try await uploadScreenshot(data, configuration)
            },
            deleteScreenshot: { [self] upload, configuration in
                try await deleteScreenshot(upload, configuration)
            },
            createIssue: { [self] title, body, configuration in
                try await createIssue(title, body, configuration)
            },
            addComment: { [self] issueNumber, body, configuration in
                try await addComment(issueNumber, body, configuration)
            }
        )
    }

    func listOpenIssues(
        configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> [PlatformBetaFeedbackGitHubIssue] {
        let request = try request(
            path: "repos/\(configuration.repository)/issues?state=open&per_page=100",
            method: "GET",
            body: Optional<String>.none,
            configuration: configuration
        )
        let responses: [IssueResponse] = try await send(request)
        return responses.compactMap { issue in
            guard issue.pullRequest == nil else { return nil }
            return PlatformBetaFeedbackGitHubIssue(
                number: issue.number,
                title: issue.title,
                url: issue.htmlURL
            )
        }
    }

    private func uploadScreenshot(
        _ screenshotJPEG: Data,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> PlatformBetaFeedbackGitHubUpload {
        let path = ".t3-feedback/\(UUID().uuidString.lowercased()).jpg"
        struct UploadBody: Encodable {
            let message: String
            let content: String
            let branch: String
        }
        let body = UploadBody(
            message: "chore: add beta feedback screenshot",
            content: screenshotJPEG.base64EncodedString(),
            branch: configuration.feedbackBranch
        )
        let request = try request(
            path: "repos/\(configuration.repository)/contents/\(path)",
            method: "PUT",
            body: body,
            configuration: configuration
        )
        let response: UploadResponse = try await send(request)
        guard var components = URLComponents(url: response.content.htmlURL, resolvingAgainstBaseURL: false) else {
            throw PlatformBetaFeedbackGitHubError.invalidResponse
        }
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "raw", value: "1"))
        components.queryItems = queryItems
        guard let url = components.url else {
            throw PlatformBetaFeedbackGitHubError.invalidResponse
        }
        return PlatformBetaFeedbackGitHubUpload(
            url: url,
            path: path,
            sha: response.content.sha
        )
    }

    private func deleteScreenshot(
        _ upload: PlatformBetaFeedbackGitHubUpload,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws {
        struct DeleteBody: Encodable {
            let message: String
            let sha: String
            let branch: String
        }
        let request = try request(
            path: "repos/\(configuration.repository)/contents/\(upload.path)",
            method: "DELETE",
            body: DeleteBody(
                message: "chore: remove unattached beta feedback screenshot",
                sha: upload.sha,
                branch: configuration.feedbackBranch
            ),
            configuration: configuration
        )
        try await sendWithoutResponse(request)
    }

    private func createIssue(
        _ title: String,
        _ body: String,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> PlatformBetaFeedbackGitHubIssue {
        struct CreateBody: Encodable {
            let title: String
            let body: String
        }
        let request = try request(
            path: "repos/\(configuration.repository)/issues",
            method: "POST",
            body: CreateBody(title: title, body: body),
            configuration: configuration
        )
        let response: IssueResponse = try await send(request)
        return PlatformBetaFeedbackGitHubIssue(
            number: response.number,
            title: response.title,
            url: response.htmlURL
        )
    }

    private func addComment(
        _ issueNumber: Int,
        _ body: String,
        _ configuration: PlatformBetaFeedbackGitHubConfiguration
    ) async throws -> URL {
        struct CommentBody: Encodable {
            let body: String
        }
        let request = try request(
            path: "repos/\(configuration.repository)/issues/\(issueNumber)/comments",
            method: "POST",
            body: CommentBody(body: body),
            configuration: configuration
        )
        let response: CommentResponse = try await send(request)
        return response.htmlURL
    }

    private func request<Body: Encodable>(
        path: String,
        method: String,
        body: Body?,
        configuration: PlatformBetaFeedbackGitHubConfiguration
    ) throws -> URLRequest {
        guard let url = URL(string: "https://api.github.com/\(path)") else {
            throw PlatformBetaFeedbackGitHubError.invalidConfiguration("The GitHub repository is invalid.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, status) = try await transport.send(request)
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).message)
                ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw PlatformBetaFeedbackGitHubError.requestFailed(status: status, message: message)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw PlatformBetaFeedbackGitHubError.invalidResponse
        }
    }

    private func sendWithoutResponse(_ request: URLRequest) async throws {
        let (data, status) = try await transport.send(request)
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).message)
                ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw PlatformBetaFeedbackGitHubError.requestFailed(status: status, message: message)
        }
    }
}

actor PlatformBetaFeedbackGitHubConfigurationStore {
    static let shared = PlatformBetaFeedbackGitHubConfigurationStore()

    private let defaults: UserDefaults
    private let service = "com.t3tools.t3code.swiftui.beta-feedback-github"
    private let account = "fine-grained-token"
    private let repositoryKey = "swift-ios.beta-feedback.github-repository.v1"
    private let branchKey = "swift-ios.beta-feedback.github-branch.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() throws -> PlatformBetaFeedbackGitHubConfiguration {
        PlatformBetaFeedbackGitHubConfiguration(
            repository: defaults.string(forKey: repositoryKey) ?? "",
            feedbackBranch: defaults.string(forKey: branchKey) ?? "t3-feedback",
            token: try readToken() ?? ""
        )
    }

    func save(_ configuration: PlatformBetaFeedbackGitHubConfiguration) throws {
        defaults.set(configuration.repository, forKey: repositoryKey)
        defaults.set(configuration.feedbackBranch, forKey: branchKey)
        try writeToken(configuration.token)
    }

    private func readToken() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }
        guard let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw CredentialStoreError.invalidData
        }
        return token
    }

    private func writeToken(_ token: String) throws {
        let data = Data(token.utf8)
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var insertion = lookup
            attributes.forEach { insertion[$0.key] = $0.value }
            let status = SecItemAdd(insertion as CFDictionary, nil)
            guard status == errSecSuccess else { throw CredentialStoreError.keychain(status) }
        } else if updateStatus != errSecSuccess {
            throw CredentialStoreError.keychain(updateStatus)
        }
    }
}
