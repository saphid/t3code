enum AutomaticTitleSettingsPolicy {
    static func fallbackProviders(
        primary: FeatureSelection?,
        providers: [FeatureProvider]
    ) -> [FeatureProvider] {
        guard let primary else { return [] }
        return providers.filter { $0.id != primary.providerID }
    }

    static func preferredFallback(
        primary: FeatureSelection?,
        providers: [FeatureProvider]
    ) -> FeatureSelection? {
        DailyUXModelOptions.preferredSelection(
            in: fallbackProviders(primary: primary, providers: providers)
        )
    }

    static func isValid(primary: FeatureSelection?, fallback: FeatureSelection?) -> Bool {
        guard let primary else { return false }
        return fallback?.providerID != primary.providerID
    }

    static func providerStateMessage(
        selection: FeatureSelection,
        providers: [FeatureProvider],
        role: String
    ) -> String? {
        guard let provider = providers.first(where: { $0.id == selection.providerID }) else {
            return "The configured \(role) provider was removed. Choose another model."
        }
        guard provider.isAvailable else {
            return "The configured \(role) provider is unavailable. Reconnect it or choose another model."
        }
        guard provider.models.contains(where: { $0.id == selection.modelID }) else {
            return "The configured \(role) model is unavailable. Choose another model."
        }
        return nil
    }
}
