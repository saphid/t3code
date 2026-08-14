#if DEBUG
import Foundation

enum AppFlowFixtureScenario: String {
    case workspace
    case onboarding
    case recovery
    case permissionsDenied = "permissions-denied"
    case longLived = "long-lived"
    case streamApproval = "stream-approval"
    case liveUpdateRace = "live-update-race"
    case coldBoot = "cold-boot"
    case personalConnect = "personal-connect"
}

enum AppFlowFixtureLaunch {
    static let enableArgument = "-app-flow-fixture"
    static let scenarioArgument = "-app-flow-scenario"
    static let scenarioEnvironment = "T3_APP_FLOW_FIXTURE_SCENARIO"
    static let personalConnectResetEnvironment = "T3_APP_FLOW_PERSONAL_CONNECT_RESET"

    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains(enableArgument)
            || ProcessInfo.processInfo.environment[scenarioEnvironment] != nil
    }

    static var scenario: AppFlowFixtureScenario {
        if let rawValue = ProcessInfo.processInfo.environment[scenarioEnvironment],
           let scenario = AppFlowFixtureScenario(rawValue: rawValue) {
            return scenario
        }
        let arguments = ProcessInfo.processInfo.arguments
        guard let marker = arguments.firstIndex(of: scenarioArgument),
              arguments.indices.contains(marker + 1),
              let scenario = AppFlowFixtureScenario(rawValue: arguments[marker + 1]) else {
            return .workspace
        }
        return scenario
    }
}

/// Deterministic in-process adapter for XCUITest journeys. It exercises the
/// production SwiftUI hierarchy while keeping credentials, network timing, and
/// live user data outside the routine regression verdict.
@MainActor
final class AppFlowFixtureClient: FeatureClient, FeatureProjectCreationClient {
    private let stream: AsyncStream<FeatureEvent>
    private let continuation: AsyncStream<FeatureEvent>.Continuation
    private var snapshot: FeatureSnapshot
    private var details: [String: FeatureThreadDetail]
    private let scenario: AppFlowFixtureScenario
    private var didRunInitialLiveUpdateRace = false
    private var coldBootMetadataTask: Task<Void, Never>?
    private var didStartColdBootMetadata = false
    var waitUntilLiveUpdateIsApplied: (@MainActor (String) async -> Void)?

    private static let personalConnectPairedKey = "T3AppFlowFixturePersonalConnectPaired"

    init(scenario: AppFlowFixtureScenario) {
        self.scenario = scenario
        let pair = AsyncStream<FeatureEvent>.makeStream(
            bufferingPolicy: .bufferingNewest(16)
        )
        stream = pair.stream
        continuation = pair.continuation

        switch scenario {
        case .workspace, .streamApproval, .liveUpdateRace:
            snapshot = Self.workspaceSnapshot
            details = Self.threadDetails
        case .onboarding:
            snapshot = FeatureSnapshot()
            details = [:]
        case .recovery:
            snapshot = Self.recoverySnapshot
            details = Self.threadDetails
        case .permissionsDenied:
            snapshot = Self.permissionsDeniedSnapshot
            details = Self.threadDetails
        case .longLived:
            snapshot = Self.longLivedSnapshot
            details = Self.threadDetails.merging(Self.longLivedThreadDetails) { _, latest in latest }
        case .coldBoot:
            snapshot = Self.longLivedSnapshot
            details = Self.threadDetails.merging(Self.longLivedThreadDetails) { _, latest in latest }
        case .personalConnect:
            if ProcessInfo.processInfo.environment[
                AppFlowFixtureLaunch.personalConnectResetEnvironment
            ] == "1" {
                UserDefaults.standard.removeObject(forKey: Self.personalConnectPairedKey)
            }
            if UserDefaults.standard.bool(forKey: Self.personalConnectPairedKey) {
                snapshot = Self.workspaceSnapshot
                details = Self.threadDetails
            } else {
                snapshot = FeatureSnapshot()
                details = [:]
            }
        }
    }

    deinit {
        coldBootMetadataTask?.cancel()
        continuation.finish()
    }

    func initialSnapshot() async throws -> FeatureSnapshot {
        startColdBootMetadataIfNeeded()
        return snapshot
    }

    func events() -> AsyncStream<FeatureEvent> {
        stream
    }

    func pair(endpoint _: String, token _: String?) async throws {
        snapshot = Self.workspaceSnapshot
        details = Self.threadDetails
        if scenario == .personalConnect {
            UserDefaults.standard.set(true, forKey: Self.personalConnectPairedKey)
        }
        continuation.yield(.snapshot(snapshot))
    }

    private func startColdBootMetadataIfNeeded() {
        guard scenario == .coldBoot, !didStartColdBootMetadata else { return }
        didStartColdBootMetadata = true
        coldBootMetadataTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(for: .milliseconds(100))
            } catch {
                return
            }
            guard let markerIndex = snapshot.threads.firstIndex(where: {
                $0.id == "fixture-history-24"
            }) else { return }
            snapshot.threads[markerIndex].title =
                "Long-lived project history item 24 · metadata ready"
            continuation.yield(.snapshot(snapshot))

            do {
                try await Task.sleep(for: .milliseconds(150))
            } catch {
                return
            }
            for batch in 1 ... 24 {
                guard !Task.isCancelled else { return }
                let threadIndex = 2 + ((batch - 1) % Self.longLivedThreads.count)
                snapshot.threads[threadIndex].preview =
                    "Cold-boot metadata batch \(batch) loaded without replacing the row."
                continuation.yield(.snapshot(snapshot))
                do {
                    try await Task.sleep(for: .milliseconds(80))
                } catch {
                    return
                }
            }
        }
    }

    func createThread(
        projectID: String,
        title: String?,
        selection: FeatureSelection?
    ) async throws -> FeatureThread {
        let thread = FeatureThread(
            id: "fixture-created",
            projectID: projectID,
            environmentID: "fixture-environment",
            environmentName: "Fixture Mac",
            title: title ?? "New app-flow thread",
            branch: "personal/swiftui-feature/app-flow-regression-tests",
            worktreePath: "/workspace/t3code",
            providerID: selection?.providerID ?? "codex",
            providerName: "Codex",
            modelID: selection?.modelID ?? "gpt-5.6-sol"
        )
        snapshot.threads.insert(thread, at: 0)
        details[thread.id] = FeatureThreadDetail(thread: thread)
        continuation.yield(.snapshot(snapshot))
        return thread
    }

    func listWorkspaceBranches(
        projectID _: String,
        refresh _: Bool
    ) async throws -> [FeatureWorkspaceBranch] {
        [
            FeatureWorkspaceBranch(name: "main", isCurrent: true, isDefault: true),
            FeatureWorkspaceBranch(
                name: "personal/swiftui-feature/app-flow-regression-tests",
                worktreePath: "/workspace/t3code"
            ),
        ]
    }

    func addProject(environmentID _: String, path _: String) async throws {}

    func browseProjectFolders(
        environmentID _: String,
        partialPath _: String
    ) async throws -> FilesystemBrowseResult {
        FilesystemBrowseResult(
            parentPath: "~/",
            entries: [
                FilesystemBrowseEntry(name: "projects", fullPath: "~/projects"),
                FilesystemBrowseEntry(name: "t3code", fullPath: "~/t3code"),
            ]
        )
    }

    func discoverProjectSources(
        environmentID _: String
    ) async throws -> SourceControlDiscoveryResult {
        SourceControlDiscoveryResult(versionControlSystems: [], sourceControlProviders: [])
    }

    func lookupProjectRepository(
        environmentID _: String,
        provider: SourceControlProviderKind,
        repository: String
    ) async throws -> SourceControlRepositoryInfo {
        SourceControlRepositoryInfo(
            provider: provider,
            nameWithOwner: repository,
            url: "https://fixture.invalid/\(repository)",
            sshUrl: "git@fixture.invalid:\(repository).git"
        )
    }

    func cloneProjectRepository(
        environmentID _: String,
        remoteURL: String,
        destinationPath: String
    ) async throws -> SourceControlCloneResult {
        SourceControlCloneResult(
            cwd: destinationPath,
            remoteUrl: remoteURL,
            repository: nil
        )
    }

    func renameThread(id: String, title: String) async throws {
        updateThread(id: id) { $0.title = title }
    }

    func regenerateThreadTitle(id: String) async throws {
        updateThread(id: id) { $0.title = "Regenerated app-flow title" }
    }

    func setThreadArchived(id: String, archived: Bool) async throws {
        updateThread(id: id) { $0.isArchived = archived }
    }

    func setThreadSettled(id: String, settled: Bool) async throws {
        updateThread(id: id) { thread in
            thread.isSettled = settled
            thread.settledAt = settled ? .now : nil
        }
    }

    func setThreadSnoozed(id: String, until: Date?) async throws {
        updateThread(id: id) { thread in
            thread.snoozedUntil = until
            thread.snoozedAt = until == nil ? nil : .now
        }
    }

    func setThreadPinned(id: String, pinned: Bool) async throws {
        updateThread(id: id) { $0.pinnedAt = pinned ? .now : nil }
    }

    func deleteThread(id: String) async throws {
        snapshot.threads.removeAll { $0.id == id }
        details[id] = nil
        continuation.yield(.threadRemoved(id: id))
    }

    func loadThread(id: String) async throws -> FeatureThreadDetail {
        guard let detail = details[id] else {
            throw FeatureCapabilityUnavailable("Fixture thread \(id)")
        }
        if scenario == .liveUpdateRace,
           id == Self.mainThread.id,
           !didRunInitialLiveUpdateRace
        {
            didRunInitialLiveUpdateRace = true
            var liveDetail = detail
            liveDetail.messages.append(
                FeatureMessage(
                    id: "fixture-live-update",
                    role: .assistant,
                    text: "This live update arrived while initial history was still loading."
                )
            )
            details[id] = liveDetail
            continuation.yield(.detail(liveDetail))
            await waitUntilLiveUpdateIsApplied?(id)
            return detail
        }
        return detail
    }

    func sendMessage(
        threadID: String,
        text: String,
        selection _: FeatureSelection?
    ) async throws {
        try appendMessage(
            threadID: threadID,
            id: "fixture-message-\((details[threadID]?.messages.count ?? 0) + 1)",
            text: text
        )
    }

    func sendMessage(
        threadID: String,
        text: String,
        selection _: FeatureSelection?,
        attachments: [FeatureUploadAttachment],
        identity: FeatureSubmissionIdentity
    ) async throws {
        guard attachments.isEmpty else {
            throw FeatureCapabilityUnavailable("Fixture image attachments")
        }
        try appendMessage(threadID: threadID, id: identity.messageID, text: text)
    }

    private func appendMessage(threadID: String, id: String, text: String) throws {
        guard var detail = details[threadID] else {
            throw FeatureCapabilityUnavailable("Fixture thread \(threadID)")
        }
        detail.messages.append(
            FeatureMessage(
                id: id,
                role: .user,
                text: text
            )
        )
        details[threadID] = detail
        continuation.yield(.detail(detail))
    }

    func cancelTurn(threadID: String) async throws {
        updateThread(id: threadID) { $0.state = .idle }
    }

    func resolveApproval(id _: String, decision _: FeatureApprovalDecision) async throws {}

    func saveSettings(_ settings: FeatureSettings) async throws {
        snapshot.settings = settings
        continuation.yield(.snapshot(snapshot))
    }

    func listFiles(threadID _: String, path: String?) async throws -> [FeatureFileEntry] {
        if path == "Sources" {
            return [
                FeatureFileEntry(
                    path: "Sources/AppFlow.swift",
                    name: "AppFlow.swift",
                    kind: .file,
                    sizeBytes: 142
                ),
            ]
        }
        return [
            FeatureFileEntry(path: "Sources", name: "Sources", kind: .directory),
            FeatureFileEntry(path: "README.md", name: "README.md", kind: .file, sizeBytes: 96),
        ]
    }

    func readFile(threadID _: String, path: String) async throws -> FeatureFileContent {
        FeatureFileContent(
            path: path,
            text: "# App flow fixture\n\nDeterministic UI regression evidence.\n",
            language: path.hasSuffix(".swift") ? "swift" : "markdown"
        )
    }

    func loadReview(threadID _: String) async throws -> FeatureReview {
        FeatureReview(
            baseReference: "origin/personal/swiftui-dev",
            files: [
                FeatureReviewFile(
                    path: "apps/swift-ios/App/AppFlowFixtureClient.swift",
                    change: .added,
                    additions: 42,
                    deletions: 0
                ),
            ]
        )
    }

    func sourceControlStatus(threadID _: String) async throws -> FeatureSourceControlStatus {
        FeatureSourceControlStatus(
            branch: "personal/swiftui-feature/app-flow-regression-tests",
            upstream: "origin/personal/swiftui-dev",
            aheadCount: 1,
            files: [
                FeatureSourceControlFile(
                    path: "apps/swift-ios/App/AppFlowFixtureClient.swift",
                    state: .added,
                    isStaged: false
                ),
            ]
        )
    }

    func terminalSnapshot(
        threadID: String,
        terminalID: String
    ) async throws -> FeatureTerminalSnapshot {
        Self.terminal(threadID: threadID, terminalID: terminalID)
    }

    func terminalEvents(
        threadID: String,
        terminalID: String
    ) -> AsyncStream<FeatureTerminalSnapshot> {
        let value = Self.terminal(threadID: threadID, terminalID: terminalID)
        return AsyncStream { continuation in
            continuation.yield(value)
            continuation.finish()
        }
    }

    func terminalSessions(threadID: String) -> AsyncStream<[FeatureTerminalSnapshot]> {
        let value = Self.terminal(threadID: threadID, terminalID: "default")
        return AsyncStream { continuation in
            continuation.yield([value])
            continuation.finish()
        }
    }

    func openTerminal(
        threadID _: String,
        terminalID _: String,
        columns _: Int,
        rows _: Int
    ) async throws {}

    func writeTerminal(threadID _: String, terminalID _: String, data _: String) async throws {}

    func resizeTerminal(
        threadID _: String,
        terminalID _: String,
        columns _: Int,
        rows _: Int
    ) async throws {}

    func clearTerminal(threadID _: String, terminalID _: String) async throws {}
    func closeTerminal(threadID _: String, terminalID _: String) async throws {}

    private func updateThread(
        id: String,
        mutation: (inout FeatureThread) -> Void
    ) {
        guard let index = snapshot.threads.firstIndex(where: { $0.id == id }) else { return }
        mutation(&snapshot.threads[index])
        if var detail = details[id] {
            detail.thread = snapshot.threads[index]
            details[id] = detail
            continuation.yield(.detail(detail))
        }
        continuation.yield(.snapshot(snapshot))
    }

    private static func terminal(
        threadID: String,
        terminalID: String
    ) -> FeatureTerminalSnapshot {
        FeatureTerminalSnapshot(
            threadID: threadID,
            terminalID: terminalID,
            state: .running,
            title: "Fixture shell",
            workingDirectory: "/workspace/t3code",
            buffer: "$ git status --short\n M apps/swift-ios/App/T3CodeApp.swift\n",
            hasRunningSubprocess: false,
            updatedAt: "2026-08-13T06:00:00Z"
        )
    }

    private static let selection = FeatureSelection(
        providerID: "codex",
        modelID: "gpt-5.6-sol",
        options: [
            FeatureModelOptionSelection(id: "reasoning", value: .string("high")),
        ]
    )

    private static let mainThread = FeatureThread(
        id: "fixture-main",
        projectID: "fixture-project",
        environmentID: "fixture-environment",
        environmentName: "Fixture Mac",
        title: "App flow regression audit",
        preview: "Inventory menus and verify the happy paths.",
        branch: "personal/swiftui-feature/app-flow-regression-tests",
        worktreePath: "/workspace/t3code",
        providerID: "codex",
        providerName: "Codex",
        modelID: "gpt-5.6-sol",
        modelOptions: selection.options,
        supportsSettlement: true,
        supportsSnooze: true,
        supportsPinning: true,
        supportsTitleRegeneration: true
    )

    private static let workingThread = FeatureThread(
        id: "fixture-working",
        projectID: "fixture-project",
        environmentID: "fixture-environment",
        environmentName: "Fixture Mac",
        title: "Investigate slow menu response",
        preview: "Collecting deterministic evidence.",
        branch: "fix/slow-menu-response",
        worktreePath: "/workspace/t3code-slow-menu",
        state: .working,
        providerID: "codex",
        providerName: "Codex",
        modelID: "gpt-5.6-sol",
        supportsSettlement: true,
        supportsSnooze: true,
        supportsPinning: true,
        supportsTitleRegeneration: true,
        workingStartedAt: Date(timeIntervalSince1970: 1_786_590_000)
    )

    private static let skills = [
        FeatureProviderSkill(
            name: "accessibility-workflow-review",
            displayName: "Accessibility workflow review for compact mobile screens",
            shortDescription: "Checks readable labels, safe-area clearance, and one-finger interaction paths."
        ),
        FeatureProviderSkill(name: "app-flow-audit", displayName: "App flow audit"),
        FeatureProviderSkill(name: "build-hygiene", displayName: "Build hygiene"),
        FeatureProviderSkill(name: "code-review", displayName: "Code review"),
        FeatureProviderSkill(name: "diagnosing-bugs", displayName: "Diagnosing bugs"),
        FeatureProviderSkill(name: "ios-debugger-agent", displayName: "iOS debugger agent"),
        FeatureProviderSkill(name: "prepare-proof-media", displayName: "Prepare proof media"),
        FeatureProviderSkill(name: "release-checklist", displayName: "Release checklist"),
        FeatureProviderSkill(name: "research", displayName: "Research"),
        FeatureProviderSkill(name: "share-video-evidence", displayName: "Share video evidence"),
        FeatureProviderSkill(name: "swift-testing-pro", displayName: "Swift testing pro"),
        FeatureProviderSkill(name: "swiftui-pro", displayName: "SwiftUI pro"),
        FeatureProviderSkill(name: "test-t3-mobile", displayName: "Test T3 mobile"),
        FeatureProviderSkill(
            name: "zeta-release-proof-archive",
            displayName: "Zeta release proof archive and delivery receipt verification",
            shortDescription: "Collects the final annotated evidence and verifies its durable delivery receipt."
        ),
    ]

    private static let provider = FeatureProvider(
        id: "codex",
        name: "Codex",
        driver: "codex",
        models: [
            FeatureModel(
                id: "gpt-5.6-sol",
                name: "GPT-5.6 Sol",
                detail: "High-reasoning coding agent",
                supportsImages: true,
                supportsReasoning: true,
                isDefault: true,
                options: [
                    FeatureModelOptionDescriptor(
                        id: "reasoning",
                        label: "Reasoning",
                        kind: .select,
                        choices: [
                            FeatureModelOptionChoice(id: "medium", label: "Medium"),
                            FeatureModelOptionChoice(id: "high", label: "High", isDefault: true),
                        ],
                        defaultValue: .string("high")
                    ),
                ]
            ),
        ],
        skills: skills
    )

    private static let workspaceSnapshot = FeatureSnapshot(
        connection: FeatureConnection(
            state: .connected,
            environmentName: "Fixture Mac",
            endpoint: "http://fixture.invalid"
        ),
        environments: [
            FeatureEnvironment(
                id: "fixture-environment",
                name: "Fixture Mac",
                endpoint: "http://fixture.invalid",
                serverVersion: "fixture-1",
                isActive: true,
                connectionState: .connected
            ),
        ],
        projects: [
            FeatureProject(
                id: "fixture-project",
                environmentID: "fixture-environment",
                name: "T3 Code",
                path: "/workspace/t3code",
                threadCount: 2,
                defaultSelection: selection
            ),
        ],
        threads: [mainThread, workingThread],
        providersByEnvironment: ["fixture-environment": [provider]],
        preferencesByEnvironment: [
            "fixture-environment": FeatureEnvironmentPreferences(
                defaultWorkspaceMode: .local,
                newWorktreesStartFromOrigin: true
            ),
        ],
        settings: FeatureSettings(defaultSelection: selection)
    )

    private static var recoverySnapshot: FeatureSnapshot {
        var value = workspaceSnapshot
        value.connection = FeatureConnection(
            state: .reconnecting,
            environmentName: "Fixture Mac",
            endpoint: "http://fixture.invalid",
            detail: "Recovering the deterministic fixture connection"
        )
        value.environments[0].connectionState = .reconnecting
        value.environments[0].connectionDetail = "Retrying after a fixture transport interruption"
        return value
    }

    private static var permissionsDeniedSnapshot: FeatureSnapshot {
        var value = workspaceSnapshot
        value.settings = FeatureSettings(
            hapticsEnabled: false,
            notificationsEnabled: false,
            liveActivitiesEnabled: false,
            defaultSelection: selection
        )
        return value
    }

    private static var longLivedSnapshot: FeatureSnapshot {
        var value = workspaceSnapshot
        value.threads.append(contentsOf: longLivedThreads)
        value.projects[0].threadCount = value.threads.count
        return value
    }

    private static let longLivedThreads: [FeatureThread] = (1 ... 24).map { index in
        FeatureThread(
            id: "fixture-history-\(index)",
            projectID: "fixture-project",
            environmentID: "fixture-environment",
            environmentName: "Fixture Mac",
            title: "Long-lived project history item \(index)",
            preview: "Stable accumulated fixture history for search and scrolling coverage.",
            branch: "history/fixture-\(index)",
            worktreePath: "/workspace/t3code-history-\(index)",
            providerID: "codex",
            providerName: "Codex",
            modelID: "gpt-5.6-sol",
            supportsSettlement: true,
            supportsSnooze: true,
            supportsPinning: true,
            supportsTitleRegeneration: true
        )
    }

    private static let longLivedThreadDetails: [String: FeatureThreadDetail] =
        Dictionary(uniqueKeysWithValues: longLivedThreads.map { thread in
            (
                thread.id,
                FeatureThreadDetail(
                    thread: thread,
                    messages: [
                        FeatureMessage(
                            id: "message-\(thread.id)",
                            role: .assistant,
                            text: "Retained deterministic history for \(thread.title)."
                        ),
                    ]
                )
            )
        })

    private static let threadDetails: [String: FeatureThreadDetail] = [
        mainThread.id: FeatureThreadDetail(
            thread: mainThread,
            messages: [
                FeatureMessage(
                    id: "fixture-user",
                    role: .user,
                    text: "Audit every non-destructive happy path in the native app."
                ),
                FeatureMessage(
                    id: "fixture-assistant",
                    role: .assistant,
                    text: "Programmatic checks own the verdict. Screenshots explain visual failures."
                ),
            ]
        ),
        workingThread.id: FeatureThreadDetail(
            thread: workingThread,
            messages: [
                FeatureMessage(
                    id: "fixture-working-message",
                    role: .assistant,
                    text: "Inspecting the slow path now.",
                    state: .streaming
                ),
            ],
            activeSubagentCount: 1,
            backgroundWorkIsActive: true
        ),
    ]
}

struct AppFlowFixturePersonalFleetPairingRequester: PersonalFleetPairingRequesting {
    static let reachableHost = PersonalFleetPairingHost(
        id: "fixture-reachable",
        label: "Fixture Mac",
        httpsBaseURL: URL(string: "https://fixture-reachable.invalid")!
    )
    static let unavailableHost = PersonalFleetPairingHost(
        id: "fixture-unavailable",
        label: "Offline Fixture Mac",
        httpsBaseURL: URL(string: "https://fixture-unavailable.invalid")!
    )
    static let hosts = [reachableHost, unavailableHost]

    func pairingURL(for host: PersonalFleetPairingHost) async throws -> String {
        guard host.id == Self.reachableHost.id else {
            throw PersonalFleetPairingError.unavailable(host: host.label, status: 503)
        }
        return "t3code://connect?endpoint=http%3A%2F%2Ffixture.invalid&token=fixture-personal-code"
    }
}
#endif
