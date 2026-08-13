import SwiftUI

struct PullRequestInboxView: View {
    private let environments: [FeatureEnvironment]
    private let onSelectEnvironment: @MainActor (String) -> Void
    private let onNavigateBack: @MainActor () -> Void
    @State private var model: PullRequestInboxModel

    init(
        environment: FeatureEnvironment,
        environments: [FeatureEnvironment],
        client: any FeatureClient,
        onSelectEnvironment: @escaping @MainActor (String) -> Void,
        onNavigateBack: @escaping @MainActor () -> Void
    ) {
        self.environments = environments
        self.onSelectEnvironment = onSelectEnvironment
        self.onNavigateBack = onNavigateBack
        _model = State(
            initialValue: PullRequestInboxModel(
                scope: .init(environment: environment),
                client: .init(client: client)
            )
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.scope.capability {
                case .unknown:
                    ContentUnavailableView {
                        Label("Connecting to \(model.scope.environmentName)", systemImage: "network")
                    } description: {
                        Text("Pull-request support will appear after this environment reports its capabilities.")
                    }
                case .unavailable:
                    ContentUnavailableView {
                        Label("Pull requests unavailable", systemImage: "arrow.triangle.pull")
                    } description: {
                        Text("\(model.scope.environmentName) does not advertise pull-request workspace support. No compatibility probe was sent.")
                    }
                case .available:
                    PullRequestListContent(model: model)
                }
            }
            .background(T3Colors.background)
            .navigationTitle("Pull requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Tasks", systemImage: "chevron.left", action: onNavigateBack)
                }
                if environments.count > 1 {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu("Environment", systemImage: "server.rack") {
                            ForEach(environments) { environment in
                                Button {
                                    onSelectEnvironment(environment.id)
                                } label: {
                                    if environment.id == model.scope.environmentID {
                                        Label(environment.name, systemImage: "checkmark")
                                    } else {
                                        Text(environment.name)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationDestination(for: PullRequestInboxModel.Route.self) { route in
                PullRequestDetailView(model: model, entry: route.entry)
            }
            .t3NavigationChrome()
        }
    }
}
