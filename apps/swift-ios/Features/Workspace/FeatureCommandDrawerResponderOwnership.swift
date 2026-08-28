import UIKit

/// A responder the drawer may return focus to after it gives up ownership.
///
/// The protocol keeps the ownership decision testable without a live keyboard.
/// UIKit responders use the conformance below in the running app.
@MainActor
protocol FeatureCommandDrawerRestorableResponder: AnyObject {
    var canRestoreCommandDrawerFocus: Bool { get }
    @discardableResult func restoreCommandDrawerFocus() -> Bool
}

extension UIResponder: FeatureCommandDrawerRestorableResponder {
    var canRestoreCommandDrawerFocus: Bool {
        guard canBecomeFirstResponder || isFirstResponder else { return false }
        guard let view = commandDrawerRestorationView else { return false }
        guard let window = view.window,
              !window.isHidden,
              window.alpha > 0.01,
              window.isUserInteractionEnabled else { return false }

        var ancestor: UIView? = view
        while let candidate = ancestor {
            guard !candidate.isHidden,
                  candidate.alpha > 0.01,
                  candidate.isUserInteractionEnabled else { return false }
            if let control = candidate as? UIControl, !control.isEnabled {
                return false
            }
            ancestor = candidate.superview
        }
        return true
    }

    private var commandDrawerRestorationView: UIView? {
        if let view = self as? UIView { return view }
        if let viewController = self as? UIViewController {
            return viewController.viewIfLoaded
        }

        var candidate = next
        while let responder = candidate {
            if let view = responder as? UIView { return view }
            if let viewController = responder as? UIViewController {
                return viewController.viewIfLoaded
            }
            candidate = responder.next
        }
        return nil
    }

    @discardableResult
    func restoreCommandDrawerFocus() -> Bool {
        becomeFirstResponder()
    }
}

/// Owns the responder handoff for one drawer presentation lifecycle.
///
/// The prior responder is captured once, before drawer search takes focus. A
/// short abandoned pull restores it. A completed open keeps the ownership
/// token until the drawer closes, then restores the same responder only if the
/// view still belongs to a visible window.
@MainActor
final class FeatureCommandDrawerResponderOwnership {
    private weak var priorResponder: (any FeatureCommandDrawerRestorableResponder)?
    private(set) var ownsFocusTransfer = false

    func begin(from responder: (any FeatureCommandDrawerRestorableResponder)?) {
        guard !ownsFocusTransfer else { return }
        priorResponder = responder
        ownsFocusTransfer = true
    }

    /// Keeps ownership while open. Settling closed ends the lifecycle and
    /// restores the responder that owned focus before the pull.
    @discardableResult
    func settle(open: Bool) -> Bool {
        guard !open else { return false }
        return finish(restoringPrior: true)
    }

    /// A recognizer cancellation returns to the rest state it began from. A
    /// cancelled opening pull restores the prior responder; cancelling a close
    /// keeps the drawer's existing ownership token.
    @discardableResult
    func cancel(returningToOpen open: Bool) -> Bool {
        settle(open: open)
    }

    /// Selection can close the drawer while navigating elsewhere. That path
    /// explicitly declines restoration so an old composer cannot steal focus
    /// from the destination.
    @discardableResult
    func close(restoringPrior: Bool = true) -> Bool {
        finish(restoringPrior: restoringPrior)
    }

    @discardableResult
    private func finish(restoringPrior: Bool) -> Bool {
        guard ownsFocusTransfer else { return false }
        let responder = priorResponder
        priorResponder = nil
        ownsFocusTransfer = false
        guard restoringPrior,
              let responder,
              responder.canRestoreCommandDrawerFocus else {
            return false
        }
        return responder.restoreCommandDrawerFocus()
    }
}

@MainActor
private final class FeatureCommandDrawerResponderProbe: NSObject {
    weak var responder: UIResponder?
}

private extension UIResponder {
    @objc func captureCommandDrawerFirstResponder(
        _ probe: FeatureCommandDrawerResponderProbe
    ) {
        probe.responder = self
    }
}

enum FeatureCommandDrawerResponderLookup {
    /// Finds the exact UIKit responder before drawer search asks for focus.
    /// The responder chain answers this directly, avoiding a synchronous walk
    /// over a long transcript's full UIKit view tree.
    @MainActor
    static func firstResponder(in window: UIWindow?) -> UIResponder? {
        guard let window else { return nil }
        let probe = FeatureCommandDrawerResponderProbe()
        UIApplication.shared.sendAction(
            #selector(UIResponder.captureCommandDrawerFirstResponder(_:)),
            to: nil,
            from: probe,
            for: nil
        )
        guard let responder = probe.responder,
              owningWindow(of: responder) === window else { return nil }
        return responder
    }

    @MainActor
    private static func owningWindow(of responder: UIResponder) -> UIWindow? {
        if let window = responder as? UIWindow { return window }
        if let view = responder as? UIView { return view.window }
        if let viewController = responder as? UIViewController {
            return viewController.viewIfLoaded?.window
        }

        var next = responder.next
        while let candidate = next {
            if let window = candidate as? UIWindow { return window }
            if let view = candidate as? UIView, let window = view.window { return window }
            next = candidate.next
        }
        return nil
    }
}
