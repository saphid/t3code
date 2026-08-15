import Foundation
import SwiftUI

@main
@MainActor
struct T3CodeApp: App {
    @UIApplicationDelegateAdaptor(T3PlatformAppDelegate.self) private var appDelegate
    @State private var model: FeatureRootModel
    @State private var themeRuntime = T3ThemeRuntime.shared
    private let draftStore: FeatureComposerDraftStore

    init() {
        #if DEBUG
        if AppFlowFixtureLaunch.isEnabled {
            if AppFlowFixtureLaunch.scenario == .themeCatalog,
               ProcessInfo.processInfo.environment["T3_APP_FLOW_THEME_RESET"] == "1"
            {
                try? T3ThemeRuntime.shared.removeInstalledTheme(id: "fixture-night")
                T3ThemeRuntime.shared.selectBoth(themeID: "t3-code")
                T3ThemeRuntime.shared.setAppearance(.system)
            }
            let fixtureID = UUID().uuidString
            let fixtureClient = AppFlowFixtureClient(scenario: AppFlowFixtureLaunch.scenario)
            draftStore = FeatureComposerDraftStore(
                fileURL: FileManager.default.temporaryDirectory
                    .appendingPathComponent("t3-app-flow-\(fixtureID)-drafts.json")
            )
            let fixtureModel = FeatureRootModel(
                client: fixtureClient,
                outboxStore: FeatureOutboxStore(
                    fileURL: FileManager.default.temporaryDirectory
                        .appendingPathComponent("t3-app-flow-\(fixtureID)-outbox.json")
                )
            )
            fixtureClient.waitUntilLiveUpdateIsApplied = { [weak fixtureModel] threadID in
                guard let fixtureModel else { return }
                while fixtureModel.details[threadID]?.messages.contains(where: {
                    $0.id == "fixture-live-update"
                }) != true {
                    await Task.yield()
                }
            }
            if AppFlowFixtureLaunch.scenario == .streamApproval {
                BuildTestingVerdictStore.clear(for: .appFlowApprovalFixture)
            }
            if AppFlowFixtureLaunch.scenario == .widgetNewTask {
                let fallbackURL = URL(
                    string: "\(PlatformRoute.nativeScheme)://new-task"
                )!
                PlatformRouteMailbox.shared.put(
                    try! PlatformDeepLinkParser.parse(fallbackURL)
                )
            }
            if AppFlowFixtureLaunch.scenario == .pullRequests {
                PlatformRouteMailbox.shared.put(
                    .project(
                        environmentID: "fixture-environment",
                        projectID: "fixture-project"
                    )
                )
            }
            _model = State(initialValue: fixtureModel)
            return
        }
        #endif

        draftStore = .shared
        let client = NativeFeatureClient()
        let model = FeatureRootModel(client: client)
        _model = State(initialValue: model)
        PlatformCloudDeliveryCoordinator.shared.install(
            controller: client.t3ConnectController
        )
        PlatformBackgroundRefreshCoordinator.shared.install { [weak model] in
            guard let model else { return false }
            return await model.refreshInBackground()
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView {
                PlatformRootView(model: model, draftStore: draftStore)
            }
            .environment(themeRuntime)
        }
    }
}
