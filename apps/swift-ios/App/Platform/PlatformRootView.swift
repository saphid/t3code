import SwiftUI

struct PlatformRootView: View {
    @SwiftUI.Environment(\.scenePhase) private var scenePhase
    @Bindable private var model: FeatureRootModel

    @State private var navigationRequest: FeatureWorkspaceNavigationRequest?
    @State private var pendingRoute: PlatformRoute?
    @State private var previousThreadStates: [String: FeatureThreadState]?
    @State private var lastNotificationPreference: Bool?
    @State private var incomingShareCoordinator = PlatformIncomingShareCoordinator()
    @State private var incomingShareNeedsProject = false
    @State private var importedShareProjectID: String?
    @State private var recentThreadsPersistenceTask: Task<Void, Never>?
    @State private var betaFeedbackDraft: PlatformBetaFeedbackDraft?
    @State private var betaFeedbackCleanupID: String?
    @State private var pendingBetaFeedbackDraft = PlatformBetaFeedbackPendingDraftState()
    #if DEBUG
    @State private var didRunBetaFeedbackDemo = false
    #endif

    init(model: FeatureRootModel) {
        self.model = model
    }

    var body: some View {
        FeatureRootView(
            model: model,
            navigationRequest: navigationRequest,
            onNavigationRequestConsumed: { requestID in
                guard navigationRequest?.id == requestID else { return }
                navigationRequest = nil
            }
        )
        .environment(\.openURL, OpenURLAction { url in
            // Links tapped inside the app (message Markdown above all) would
            // otherwise leave for Safari or be rejected by an unregistered
            // scheme, so keep the ones this device can already show.
            guard let route = PlatformInAppLinkRouter.route(for: url, in: model.snapshot) else {
                return .systemAction
            }
            handle(route)
            return .handled
        })
        .onOpenURL { url in
            handle(url: url, letOnboardingConfirmConnection: true)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL else { return }
            handle(url: url, letOnboardingConfirmConnection: false)
        }
        .onReceive(NotificationCenter.default.publisher(for: .platformRouteReceived)) { note in
            guard let route = note.userInfo?["route"] as? PlatformRoute else { return }
            _ = PlatformRouteMailbox.shared.take()
            handle(route)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            beginBetaFeedbackFromScreenshot()
        }
        .onReceive(NotificationCenter.default.publisher(for: .platformBetaFeedbackResponse)) { note in
            guard let draftID = PlatformBetaFeedbackNotificationPayload.draftID(
                from: note.userInfo ?? [:]
            ) else { return }
            let text = note.userInfo?["text"] as? String ?? ""
            Task { @MainActor in
                await presentBetaFeedbackResponse(draftID: draftID, fallbackText: text)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .platformBetaFeedbackCancelled)) { note in
            guard let draftID = PlatformBetaFeedbackNotificationPayload.draftID(
                from: note.userInfo ?? [:]
            ) else { return }
            pendingBetaFeedbackDraft.clear(ifMatching: draftID)
        }
        .onReceive(NotificationCenter.default.publisher(for: .t3ConnectSessionChanged)) { note in
            guard let capability = model.client as? any T3ConnectCapable,
                  let controller = note.object as? T3ConnectController,
                  controller === capability.t3ConnectController else { return }
            let previousAccountID = note.userInfo?["previousAccountID"] as? String
            let accountID = note.userInfo?["accountID"] as? String
            guard Self.shouldRemoveManagedEnvironments(
                previousAccountID: previousAccountID,
                accountID: accountID,
                isSigningOut: model.isSigningOutT3Connect
            ) else { return }
            Task { @MainActor in
                guard !model.isSigningOutT3Connect else { return }
                await model.removeManagedEnvironmentsAfterAccountChange()
            }
        }
        .onChange(of: model.isLoading, initial: true) { _, isLoading in
            guard !isLoading else { return }
            processThreadChanges()
            synchronizeNotificationPreference()
            synchronizeCloudDelivery()
            consumePendingRouteIfPossible()
            consumeMailboxRouteIfAvailable()
            refreshIncomingShares()
        }
        .onChange(of: model.homePresentationRevision) { _, _ in
            processThreadChanges()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                consumeMailboxRouteIfAvailable()
                synchronizeNotificationPreference()
                synchronizeCloudDelivery()
                refreshIncomingShares()
            } else if phase == .background {
                PlatformBackgroundRefreshCoordinator.shared.schedule()
            }
        }
        .onChange(of: model.snapshot.settings.notificationsEnabled) { _, _ in
            synchronizeNotificationPreference()
            synchronizeCloudDelivery()
        }
        .onChange(of: model.snapshot.settings.liveActivitiesEnabled) { _, _ in
            synchronizeAgentAwareness()
            synchronizeCloudDelivery()
        }
        .onChange(of: model.snapshot.projects.map(\.id)) { _, _ in
            refreshIncomingShares()
        }
        .sheet(item: presentedIncomingShare, onDismiss: openImportedShareDraft) { envelope in
            PlatformIncomingShareDestinationSheet(
                envelope: envelope,
                projects: incomingShareProjects,
                environments: model.snapshot.environments,
                isImporting: incomingShareCoordinator.isImporting,
                onCancel: incomingShareCoordinator.dismissDestination,
                onSelect: importIncomingShare(into:)
            )
        }
        .sheet(item: $betaFeedbackDraft, onDismiss: finishDismissedBetaFeedback) { draft in
            PlatformBetaFeedbackSheet(
                draft: draft,
                projects: betaFeedbackProjects,
                threads: betaFeedbackThreads,
                onCancel: { finishBetaFeedback(draftID: draft.id) },
                onSave: saveBetaFeedback,
                onPersist: persistBetaFeedback,
                onCreateTask: createBetaFeedbackFixingTask,
                onFollowUp: followUpBetaFeedbackFixingTask,
                onFinished: { finishBetaFeedback(draftID: draft.id) }
            )
        }
        .alert("Create a project to continue", isPresented: $incomingShareNeedsProject) {
            Button("Not now", role: .cancel) {}
            Button("Create project") {
                navigationRequest = FeatureWorkspaceNavigationRequest(
                    destination: .newTask(projectID: nil)
                )
            }
        } message: {
            Text("Your share is saved. Connect an environment and create a project to finish importing it.")
        }
        .task {
            await PlatformBetaFeedbackStore.shared.pruneExpired()
            if PlatformBetaFeedbackPolicy.isEnabled,
               let responded = try? await PlatformBetaFeedbackStore.shared.loadNextRespondedDraft() {
                betaFeedbackCleanupID = responded.id
                betaFeedbackDraft = responded
            } else if PlatformBetaFeedbackPolicy.isEnabled,
                      let saved = try? await PlatformBetaFeedbackStore.shared.loadNextResumableDraft() {
                betaFeedbackCleanupID = saved.id
                betaFeedbackDraft = saved
            }
            #if DEBUG
            guard !didRunBetaFeedbackDemo,
                  ProcessInfo.processInfo.arguments.contains("--t3-beta-feedback-demo") else { return }
            didRunBetaFeedbackDemo = true
            await Task.yield()
            beginBetaFeedbackFromScreenshot(forceInApp: true)
            #endif
        }
    }

    static func shouldRemoveManagedEnvironments(
        previousAccountID: String?,
        accountID: String?,
        isSigningOut: Bool
    ) -> Bool {
        guard !isSigningOut, let previousAccountID else { return false }
        return previousAccountID != accountID
    }

    private var incomingShareProjects: [FeatureProject] {
        DailyUXCreationContext.projects(in: model.snapshot).sorted {
            if $0.name.localizedStandardCompare($1.name) == .orderedSame {
                return $0.environmentID < $1.environmentID
            }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }

    private var betaFeedbackProjects: [FeatureProject] {
        let projects = DailyUXCreationContext.projects(in: model.snapshot).sorted {
            $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        #if DEBUG
        if Self.shouldUseBetaFeedbackDemoDestinations(
            arguments: ProcessInfo.processInfo.arguments,
            hasProjects: projects.isEmpty == false
        ) {
            return [FeatureProject(
                id: "beta-feedback-demo-project",
                environmentID: "beta-feedback-demo-environment",
                name: "Issue 143 evidence project",
                path: "/beta-feedback-evidence"
            )]
        }
        #endif
        return projects
    }

    private var betaFeedbackThreads: [FeatureThread] {
        let projectIDs = Set(betaFeedbackProjects.map(\.id))
        let threads = model.snapshot.threads.filter {
            $0.isArchived == false && projectIDs.contains($0.projectID)
        }.sorted { $0.updatedAt > $1.updatedAt }
        #if DEBUG
        if threads.isEmpty,
           let project = betaFeedbackProjects.first,
           project.id == "beta-feedback-demo-project",
           ProcessInfo.processInfo.arguments.contains("--t3-beta-feedback-demo-destinations") {
            return [FeatureThread(
                id: "beta-feedback-demo-thread",
                projectID: project.id,
                environmentID: project.environmentID,
                title: "Issue 143 fixing thread",
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            )]
        }
        #endif
        return threads
    }

    #if DEBUG
    static func shouldUseBetaFeedbackDemoDestinations(
        arguments: [String],
        hasProjects: Bool
    ) -> Bool {
        hasProjects == false && arguments.contains("--t3-beta-feedback-demo-destinations")
    }
    #endif

    private var presentedIncomingShare: Binding<T3IncomingShareEnvelope?> {
        Binding(
            get: {
                guard !incomingShareProjects.isEmpty else { return nil }
                return incomingShareCoordinator.pendingEnvelope
            },
            set: { value in
                guard value == nil, importedShareProjectID == nil else { return }
                incomingShareCoordinator.dismissDestination()
            }
        )
    }

    private var shouldShowWorkspace: Bool {
        FeatureRootPresentation.showsWorkspace(
            snapshot: model.snapshot,
            isManagingConnections: model.isManagingConnections
        )
    }

    private func handle(url: URL, letOnboardingConfirmConnection: Bool) {
        do {
            let route = try PlatformDeepLinkParser.parse(url)
            if case .connection = route,
               letOnboardingConfirmConnection,
               !shouldShowWorkspace {
                // ConnectionOnboardingView owns the confirmation UI for cold pairing links.
                return
            }
            handle(route)
        } catch {
            model.errorMessage = error.localizedDescription
        }
    }

    private func handle(_ route: PlatformRoute) {
        guard !model.isLoading else {
            pendingRoute = route
            return
        }
        Task { @MainActor in
            await consume(route)
        }
    }

    private func consumePendingRouteIfPossible() {
        guard let route = pendingRoute else { return }
        pendingRoute = nil
        handle(route)
    }

    private func consumeMailboxRouteIfAvailable() {
        guard !model.isLoading, let route = PlatformRouteMailbox.shared.take() else { return }
        handle(route)
    }

    private func synchronizeNotificationPreference() {
        guard !model.isLoading else { return }
        let preference = model.snapshot.settings.notificationsEnabled
        let previous = lastNotificationPreference
        lastNotificationPreference = preference

        Task {
            let authorized: Bool
            if preference, previous == false {
                // The model changes only after Settings is explicitly saved.
                authorized = await PlatformNotificationService.shared.requestAuthorization()
            } else {
                authorized = await PlatformNotificationService.shared.synchronize(enabled: preference)
            }
            guard preference, !authorized, model.snapshot.settings.notificationsEnabled else {
                return
            }

            // Keep the app toggle honest when authorization is absent or revoked.
            var settings = model.snapshot.settings
            settings.notificationsEnabled = false
            await model.saveSettings(settings)
        }
    }

    private func synchronizeCloudDelivery() {
        guard !model.isLoading else { return }
        PlatformCloudDeliveryCoordinator.shared.synchronize(
            settings: model.snapshot.settings
        )
    }

    private func beginBetaFeedbackFromScreenshot(forceInApp: Bool = false) {
        guard PlatformBetaFeedbackPolicy.isEnabled,
              betaFeedbackDraft == nil,
              let screenshot = PlatformBetaFeedbackScreenshotCapture.capture() else { return }
        let device = UIDevice.current
        let diagnostics = PlatformBetaFeedbackDiagnostics(
            build: .current,
            deviceModel: device.model,
            operatingSystem: "\(device.systemName) \(device.systemVersion)",
            localeIdentifier: Locale.current.identifier,
            environments: model.snapshot.environments
        )
        var draft = PlatformBetaFeedbackDraft(
            screenshotJPEG: screenshot,
            diagnostics: diagnostics
        )
        if let supersededID = pendingBetaFeedbackDraft.replace(with: draft.id) {
            PlatformNotificationService.shared.removeBetaFeedbackNotification(draftID: supersededID)
            Task { await PlatformBetaFeedbackStore.shared.remove(id: supersededID) }
        }

        Task { @MainActor in
            do {
                try await PlatformBetaFeedbackStore.shared.save(draft)
            } catch {
                guard pendingBetaFeedbackDraft.id == draft.id else {
                    await PlatformBetaFeedbackStore.shared.remove(id: draft.id)
                    return
                }
                draft.notificationWasUnavailable = true
                betaFeedbackCleanupID = draft.id
                betaFeedbackDraft = draft
                return
            }
            guard pendingBetaFeedbackDraft.id == draft.id else {
                await PlatformBetaFeedbackStore.shared.remove(id: draft.id)
                return
            }
            let scheduled = forceInApp
                ? false
                : await PlatformNotificationService.shared.scheduleBetaFeedback(draftID: draft.id)
            guard pendingBetaFeedbackDraft.id == draft.id else {
                PlatformNotificationService.shared.removeBetaFeedbackNotification(draftID: draft.id)
                await PlatformBetaFeedbackStore.shared.remove(id: draft.id)
                return
            }
            let path = PlatformBetaFeedbackPolicy.presentationPath(
                channel: .current,
                distribution: .current,
                testFlightEnabled: PlatformBetaFeedbackPolicy.testFlightEnabled,
                notificationsAvailable: scheduled
            )
            guard path != .notificationReply else { return }
            draft.notificationWasUnavailable = true
            betaFeedbackCleanupID = draft.id
            betaFeedbackDraft = draft
        }
    }

    private func presentBetaFeedbackResponse(
        draftID: String,
        fallbackText: String
    ) async {
        guard PlatformBetaFeedbackPolicy.isEnabled, betaFeedbackDraft == nil else { return }
        let responded = try? await PlatformBetaFeedbackStore.shared.loadRespondedDraft(
            draftID: draftID
        )
        var loaded = responded
        if loaded == nil {
            loaded = try? await PlatformBetaFeedbackStore.shared.load(
                id: draftID,
                description: fallbackText
            )
        }
        guard var draft = loaded else { return }
        draft.notificationWasUnavailable = false
        betaFeedbackCleanupID = draft.id
        betaFeedbackDraft = draft
    }

    private func finishDismissedBetaFeedback() {
        guard let draftID = betaFeedbackCleanupID else { return }
        finishBetaFeedback(draftID: draftID)
    }

    private func finishBetaFeedback(draftID: String) {
        betaFeedbackDraft = nil
        betaFeedbackCleanupID = nil
        pendingBetaFeedbackDraft.clear(ifMatching: draftID)
        PlatformNotificationService.shared.removeBetaFeedbackNotification(draftID: draftID)
        Task { await PlatformBetaFeedbackStore.shared.remove(id: draftID) }
    }

    private func saveBetaFeedback(_ draft: PlatformBetaFeedbackDraft) async throws {
        try await PlatformBetaFeedbackStore.shared.saveForLater(draft)
        pendingBetaFeedbackDraft.clear(ifMatching: draft.id)
        betaFeedbackCleanupID = nil
        betaFeedbackDraft = nil
    }

    private func persistBetaFeedback(_ draft: PlatformBetaFeedbackDraft) async throws {
        try await PlatformBetaFeedbackStore.shared.saveForLater(draft)
    }

    private func createBetaFeedbackFixingTask(
        projectID: String,
        report: String,
        screenshotJPEG: Data
    ) async throws -> Bool {
        let request = try PlatformBetaFeedbackT3Handoff.newTask(
            projectID: projectID,
            report: report,
            screenshotJPEG: screenshotJPEG
        )
        guard let thread = await model.startTask(request) else { return false }
        navigationRequest = FeatureWorkspaceNavigationRequest(destination: .thread(id: thread.id))
        return true
    }

    private func followUpBetaFeedbackFixingTask(
        threadID: String,
        report: String,
        screenshotJPEG: Data
    ) async throws -> Bool {
        let submission = try PlatformBetaFeedbackT3Handoff.followUp(
            threadID: threadID,
            report: report,
            screenshotJPEG: screenshotJPEG
        )
        guard await model.sendMessage(submission) else { return false }
        navigationRequest = FeatureWorkspaceNavigationRequest(destination: .thread(id: threadID))
        return true
    }

    private func refreshIncomingShares() {
        guard !model.isLoading else { return }
        let hasProjects = !incomingShareProjects.isEmpty
        Task { @MainActor in
            if await incomingShareCoordinator.refresh(hasProjects: hasProjects) {
                incomingShareNeedsProject = true
            }
        }
    }

    private func importIncomingShare(into project: FeatureProject) {
        guard !incomingShareCoordinator.isImporting else { return }
        importedShareProjectID = project.id
        Task { @MainActor in
            do {
                try await incomingShareCoordinator.importPending(
                    into: project,
                    draftKey: FeatureComposerDraftStore.newTaskKey(
                        project: project,
                        in: model.snapshot
                    )
                )
            } catch {
                importedShareProjectID = nil
                model.errorMessage = error.localizedDescription
            }
        }
    }

    private func openImportedShareDraft() {
        guard let projectID = importedShareProjectID else { return }
        importedShareProjectID = nil
        navigationRequest = FeatureWorkspaceNavigationRequest(
            destination: .newTask(projectID: projectID)
        )
        PlatformHapticEngine.shared.emit(
            .success,
            enabled: model.snapshot.settings.hapticsEnabled
        )
    }

    @MainActor
    private func consume(_ route: PlatformRoute) async {
        switch route {
        case let .connection(endpoint, token):
            if await model.pair(endpoint: endpoint, token: token) {
                PlatformHapticEngine.shared.emit(
                    .success,
                    enabled: model.snapshot.settings.hapticsEnabled
                )
            }
        case let .environment(id):
            guard await enableEnvironmentIfNeeded(id) else { return }
            PlatformHapticEngine.shared.selection(
                enabled: model.snapshot.settings.hapticsEnabled
            )
        case let .thread(environmentID, threadID):
            guard await enableEnvironmentIfNeeded(environmentID),
                  let thread = PlatformRouteResolver.thread(
                      in: model.snapshot,
                      environmentID: environmentID,
                      id: threadID
                  )
            else {
                if model.errorMessage == nil { model.errorMessage = "That thread is not available on this device." }
                return
            }
            navigationRequest = FeatureWorkspaceNavigationRequest(
                destination: .thread(id: thread.id)
            )
            PlatformHapticEngine.shared.selection(
                enabled: model.snapshot.settings.hapticsEnabled
            )
        case let .project(environmentID, projectID):
            guard await enableEnvironmentIfNeeded(environmentID),
                  let project = PlatformRouteResolver.project(
                      in: model.snapshot,
                      environmentID: environmentID,
                      id: projectID
                  )
            else {
                if model.errorMessage == nil { model.errorMessage = "That project is not available on this device." }
                return
            }
            navigationRequest = FeatureWorkspaceNavigationRequest(
                destination: .project(id: project.id)
            )
            PlatformHapticEngine.shared.selection(
                enabled: model.snapshot.settings.hapticsEnabled
            )
        case let .newTask(environmentID, projectID):
            guard await enableEnvironmentIfNeeded(environmentID) else { return }
            let resolvedProject = projectID.flatMap {
                PlatformRouteResolver.project(
                    in: model.snapshot,
                    environmentID: environmentID,
                    id: $0
                )
            }
            if projectID != nil, resolvedProject == nil {
                model.errorMessage = "That project is not available on this device."
                return
            }
            navigationRequest = FeatureWorkspaceNavigationRequest(
                destination: .newTask(projectID: resolvedProject?.id)
            )
            PlatformHapticEngine.shared.selection(
                enabled: model.snapshot.settings.hapticsEnabled
            )
        }
    }

    @MainActor
    private func enableEnvironmentIfNeeded(_ id: String?) async -> Bool {
        guard let id else { return true }
        guard let environment = model.snapshot.environments.first(where: { $0.id == id }) else {
            model.errorMessage = "That environment is not saved on this device."
            return false
        }
        guard !environment.isEnabled else { return true }
        return await model.setEnvironmentEnabled(id, enabled: true)
    }

    /// Home revisions are coalesced by FeatureRootModel, so this performs one
    /// bounded scan per meaningful snapshot change rather than on every render.
    private func processThreadChanges() {
        let current = model.snapshot.threads.reduce(into: [String: FeatureThreadState]()) {
            $0[$1.id] = $1.state
        }
        let signals = PlatformThreadTransitionClassifier.signals(
            previous: previousThreadStates,
            current: model.snapshot.threads
        )
        previousThreadStates = current
        recentThreadsPersistenceTask?.cancel()
        let threads = model.snapshot.threads
        recentThreadsPersistenceTask = Task.detached(priority: .utility) {
            guard !Task.isCancelled else { return }
            PlatformRecentThreadStore.shared.update(from: threads)
        }
        synchronizeAgentAwareness()

        for signal in signals {
            if scenePhase == .active {
                PlatformHapticEngine.shared.emit(
                    signal.kind,
                    enabled: model.snapshot.settings.hapticsEnabled
                )
            } else if model.snapshot.settings.notificationsEnabled {
                Task { await PlatformNotificationService.shared.schedule(signal) }
            }
        }
    }

    private func synchronizeAgentAwareness() {
        PlatformAgentAwarenessCoordinator.shared.synchronize(
            snapshot: model.snapshot,
            liveActivitiesEnabled: model.snapshot.settings.liveActivitiesEnabled
        )
    }
}
