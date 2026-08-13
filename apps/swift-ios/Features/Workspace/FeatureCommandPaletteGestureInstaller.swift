import SwiftUI
import UIKit

struct FeatureCommandPaletteGestureInstaller: UIViewRepresentable {
    let onChanged: (CGFloat) -> Void
    let onEnded: (Bool) -> Void

    func makeUIView(context _: Context) -> InstallerView {
        InstallerView(onChanged: onChanged, onEnded: onEnded)
    }

    func updateUIView(_ view: InstallerView, context _: Context) {
        view.configure(onChanged: onChanged, onEnded: onEnded)
    }

    static func dismantleUIView(_ view: InstallerView, coordinator _: Void) {
        view.uninstallGesture()
    }

    final class InstallerView: UIView {
        private var onChanged: (CGFloat) -> Void
        private var onEnded: (Bool) -> Void
        private weak var gestureHost: UIView?
        private var panGesture: UIPanGestureRecognizer?
        private var gestureDelegate: GestureDelegate?

        init(
            onChanged: @escaping (CGFloat) -> Void,
            onEnded: @escaping (Bool) -> Void
        ) {
            self.onChanged = onChanged
            self.onEnded = onEnded
            super.init(frame: .zero)
            isUserInteractionEnabled = false
        }

        @available(*, unavailable)
        required init?(coder _: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            installGestureIfPossible()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            installGestureIfPossible()
        }

        func configure(
            onChanged: @escaping (CGFloat) -> Void,
            onEnded: @escaping (Bool) -> Void
        ) {
            self.onChanged = onChanged
            self.onEnded = onEnded
            installGestureIfPossible()
        }

        func uninstallGesture() {
            if let panGesture, let gestureHost {
                gestureHost.removeGestureRecognizer(panGesture)
            }
            panGesture = nil
            gestureDelegate = nil
            gestureHost = nil
        }

        private func installGestureIfPossible() {
            guard let host = window?.rootViewController?.view else {
                uninstallGesture()
                return
            }
            guard gestureHost !== host else { return }

            uninstallGesture()
            let panGesture = UIPanGestureRecognizer(
                target: self,
                action: #selector(handlePan(_:))
            )
            let gestureDelegate = GestureDelegate(owner: self)
            panGesture.delegate = gestureDelegate
            panGesture.cancelsTouchesInView = false
            panGesture.delaysTouchesBegan = false
            panGesture.maximumNumberOfTouches = 1
            host.addGestureRecognizer(panGesture)
            gestureHost = host
            self.panGesture = panGesture
            self.gestureDelegate = gestureDelegate
        }

        @objc private func handlePan(_ gesture: UIPanGestureRecognizer) {
            guard let gestureHost else { return }
            let translation = gesture.translation(in: gestureHost)
            let translationSize = CGSize(width: translation.x, height: translation.y)

            switch gesture.state {
            case .began, .changed:
                onChanged(FeatureCommandPaletteGesture.dragDistance(translation: translationSize))
            case .ended:
                let velocity = gesture.velocity(in: gestureHost)
                onEnded(FeatureCommandPaletteGesture.shouldPresent(
                    translation: translationSize,
                    velocity: velocity
                ))
            case .cancelled, .failed:
                onEnded(false)
            default:
                break
            }
        }

        private func shouldReceive(_ touch: UITouch) -> Bool {
            guard let gestureHost, let window, window === gestureHost.window else { return false }
            let point = touch.location(in: gestureHost)
            return FeatureCommandPaletteGesture.shouldReceive(
                point: point,
                surfaceFrame: convert(bounds, to: gestureHost),
                hasPresentedViewController: Self.hasPresentedViewController(
                    in: gestureHost.window?.rootViewController
                )
            )
        }

        private static func hasPresentedViewController(in controller: UIViewController?) -> Bool {
            guard let controller else { return false }
            if controller.presentedViewController != nil { return true }
            return controller.children.contains { hasPresentedViewController(in: $0) }
        }

        private final class GestureDelegate: NSObject, UIGestureRecognizerDelegate {
            private weak var owner: InstallerView?

            init(owner: InstallerView) {
                self.owner = owner
            }

            func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
                guard let panGesture = gestureRecognizer as? UIPanGestureRecognizer else {
                    return false
                }
                return FeatureCommandPaletteGesture.shouldBegin(
                    velocity: panGesture.velocity(in: panGesture.view),
                    translation: panGesture.translation(in: panGesture.view)
                )
            }

            func gestureRecognizer(
                _ gestureRecognizer: UIGestureRecognizer,
                shouldReceive touch: UITouch
            ) -> Bool {
                owner?.shouldReceive(touch) == true
            }

            func gestureRecognizer(
                _ gestureRecognizer: UIGestureRecognizer,
                shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
            ) -> Bool {
                otherGestureRecognizer.view is UIScrollView
            }
        }
    }
}
