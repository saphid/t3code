import SwiftUI

struct AutomaticTitleSettingsView: View {
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @Bindable var model: FeatureRootModel
    let environmentID: String
    let providers: [FeatureProvider]

    @State private var primary: FeatureSelection?
    @State private var fallback: FeatureSelection?
    @State private var isSaving = false
    @State private var saveErrorMessage: String?

    init(
        model: FeatureRootModel,
        environmentID: String,
        providers: [FeatureProvider],
        settings: FeatureAutomaticTitleSettings
    ) {
        self.model = model
        self.environmentID = environmentID
        self.providers = providers
        _primary = State(initialValue: settings.primary)
        _fallback = State(initialValue: settings.fallback)
    }

    var body: some View {
        List {
            Section {
                ProviderModelPicker(providers: providers, selection: $primary)
                if let primary,
                    let message = AutomaticTitleSettingsPolicy.providerStateMessage(
                        selection: primary,
                        providers: providers,
                        role: "primary"
                    )
                {
                    settingsWarning(message)
                }
            } header: {
                Text("Primary model")
            } footer: {
                Text("T3 Code uses this model first for automatic thread titles.")
            }

            Section {
                Toggle("Use backup model", isOn: fallbackEnabled)
                    .tint(T3Colors.success)
                    .disabled(fallback == nil && preferredFallback == nil)

                if fallback == nil && preferredFallback == nil {
                    Text("No backup model is available from another provider.")
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                }

                if fallback != nil {
                    ProviderModelPicker(
                        providers: fallbackProviders,
                        selection: $fallback
                    )
                    if let fallback,
                        let message = AutomaticTitleSettingsPolicy.providerStateMessage(
                            selection: fallback,
                            providers: providers,
                            role: "backup"
                        )
                    {
                        settingsWarning(message)
                    }
                }
            } header: {
                Text("Backup model")
            } footer: {
                Text(
                    "The backup runs once after an authentication, quota, rate-limit, availability, or provider failure. It must use a different provider."
                )
            }
        }
        .scrollContentBackground(.hidden)
        .background(T3Colors.background)
        .navigationTitle("Automatic titles")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? "Saving" : "Save", action: save)
                    .disabled(isSaving || canSave == false)
            }
        }
        .alert(
            "Couldn’t save automatic title settings",
            isPresented: Binding(
                get: { saveErrorMessage != nil },
                set: { if $0 == false { saveErrorMessage = nil } }
            )
        ) {
            Button("OK") { saveErrorMessage = nil }
        } message: {
            Text(saveErrorMessage ?? "Something went wrong.")
        }
        .onChange(of: primary) {
            guard fallback?.providerID == primary?.providerID else { return }
            fallback = nil
        }
    }

    private var fallbackProviders: [FeatureProvider] {
        AutomaticTitleSettingsPolicy.fallbackProviders(
            primary: primary,
            providers: providers
        )
    }

    private var fallbackEnabled: Binding<Bool> {
        Binding(
            get: { fallback != nil },
            set: { enabled in
                fallback = enabled ? preferredFallback : nil
            }
        )
    }

    private var preferredFallback: FeatureSelection? {
        AutomaticTitleSettingsPolicy.preferredFallback(
            primary: primary,
            providers: providers
        )
    }

    private var canSave: Bool {
        AutomaticTitleSettingsPolicy.isValid(primary: primary, fallback: fallback)
    }

    private func settingsWarning(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(T3Typography.supporting)
            .foregroundStyle(T3Colors.warning)
            .accessibilityLabel(message)
    }

    private func save() {
        guard let primary, canSave else { return }
        isSaving = true
        Task {
            let didSave = await model.saveAutomaticTitleSettings(
                environmentID: environmentID,
                settings: FeatureAutomaticTitleSettings(
                    primary: primary,
                    fallback: fallback
                )
            )
            isSaving = false
            if didSave {
                dismiss()
            } else {
                saveErrorMessage = "The environment did not accept the new model settings."
            }
        }
    }
}
