enum FeatureToolErrorPresentation: Equatable {
    case none
    case unavailable(message: String)
    case inline(message: String)

    static func resolve(errorMessage: String?, retainsContent: Bool) -> Self {
        guard let errorMessage else { return .none }
        return retainsContent
            ? .inline(message: errorMessage)
            : .unavailable(message: errorMessage)
    }

    static func message(for error: Error, taskIsCancelled: Bool) -> String? {
        guard !taskIsCancelled, !(error is CancellationError) else { return nil }
        return error.localizedDescription
    }

    var inlineMessage: String? {
        guard case let .inline(message) = self else { return nil }
        return message
    }

    var unavailableMessage: String? {
        guard case let .unavailable(message) = self else { return nil }
        return message
    }
}
