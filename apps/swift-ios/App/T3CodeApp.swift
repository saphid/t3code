import Foundation
import SwiftUI

@main
@MainActor
struct T3CodeApp: App {
    @UIApplicationDelegateAdaptor(T3PlatformAppDelegate.self) private var appDelegate
    @State private var model: FeatureRootModel
    private let draftStore: FeatureComposerDraftStore

    init() {
        #if DEBUG
        if AppFlowFixtureLaunch.isEnabled {
            let fixtureID = UUID().uuidString
            draftStore = FeatureComposerDraftStore(
                fileURL: FileManager.default.temporaryDirectory
                    .appendingPathComponent("t3-app-flow-\(fixtureID)-drafts.json")
            )
            _model = State(
                initialValue: FeatureRootModel(
                    client: AppFlowFixtureClient(scenario: AppFlowFixtureLaunch.scenario),
                    outboxStore: FeatureOutboxStore(
                        fileURL: FileManager.default.temporaryDirectory
                            .appendingPathComponent("t3-app-flow-\(fixtureID)-outbox.json")
                    )
                )
            )
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
        }
    }
}
