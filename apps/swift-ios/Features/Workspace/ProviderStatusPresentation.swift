struct ProviderStatusPresentation: Equatable, Sendable {
    let providerID: String
    let title: String
    let message: String
    let systemImage: String
    let canRetry: Bool

    static func primary(in providers: [FeatureProvider]) -> ProviderStatusPresentation? {
        let preferredReadiness: Set<FeatureProviderReadiness> = [
            .timeout,
            .missingBinary,
            .incompatibleVersion,
        ]
        if let preferred = providers.first(where: {
            $0.readiness.map(preferredReadiness.contains) == true
        }) {
            return presentation(for: preferred)
        }
        return providers.lazy.compactMap(presentation(for:)).first
    }

    private static func presentation(
        for provider: FeatureProvider
    ) -> ProviderStatusPresentation? {
        let readiness = provider.readiness ?? (provider.isAvailable ? .ready : .failed)
        guard readiness != .ready else { return nil }

        let fallbackMessage: String
        let title: String
        let systemImage: String
        let canRetry: Bool
        switch readiness {
        case .checking:
            title = "Checking \(provider.name)"
            fallbackMessage = "Waiting for the provider check to finish."
            systemImage = "hourglass"
            canRetry = false
        case .timeout:
            title = "\(provider.name) check timed out"
            fallbackMessage = "Check the configured binary or wrapper, then retry."
            systemImage = "clock.badge.exclamationmark"
            canRetry = true
        case .missingBinary:
            title = "\(provider.name) isn't installed"
            fallbackMessage = "Install the provider or correct its configured binary path."
            systemImage = "questionmark.folder"
            canRetry = true
        case .incompatibleVersion:
            title = "\(provider.name) needs an update"
            fallbackMessage = "Update the provider to a supported version, then retry."
            systemImage = "arrow.up.circle"
            canRetry = true
        case .failed:
            title = "\(provider.name) check failed"
            fallbackMessage = "Review the provider error, then retry."
            systemImage = "exclamationmark.triangle"
            canRetry = true
        case .ready:
            return nil
        }

        return ProviderStatusPresentation(
            providerID: provider.id,
            title: title,
            message: provider.statusMessage ?? fallbackMessage,
            systemImage: systemImage,
            canRetry: canRetry
        )
    }
}
