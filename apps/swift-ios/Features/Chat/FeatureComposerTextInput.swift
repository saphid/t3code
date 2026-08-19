import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The composer's text entry, backed by `UITextView` so paste is observable.
///
/// SwiftUI cannot see paste on iOS at all — `onPasteCommand` is macOS-only and
/// `TextField` silently drops image pasteboard items — so the edit-menu Paste
/// entry and hardware Cmd-V both have to be answered by a responder we own.
/// Everything else mirrors the `TextField(axis: .vertical)` this replaced:
/// vertical growth up to `maximumLineCount` lines, then scrolling.
struct FeatureComposerTextInput: UIViewRepresentable {
    @Binding var text: String
    /// Deliberately a plain `Binding`, not `FocusState`. SwiftUI resolves focus
    /// against its own focusable views, so a `@FocusState` that no `.focused()`
    /// view claims silently reverts to `false` on the next render — which read
    /// as "the composer drops focus after one keystroke".
    @Binding var isEditing: Bool
    let placeholder: String
    let acceptsImages: Bool
    let maximumLineCount: Int
    let onPasteImages: ([NSItemProvider]) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> FeatureComposerUITextView {
        let textView = FeatureComposerUITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.textColor = UIColor(T3Colors.textPrimary)
        textView.tintColor = UIColor(T3Colors.accent)
        textView.font = UIFont.preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.isScrollEnabled = true
        textView.text = text
        textView.accessibilityIdentifier = "message-composer"
        apply(to: textView)
        return textView
    }

    func updateUIView(_ textView: FeatureComposerUITextView, context: Context) {
        context.coordinator.parent = self
        apply(to: textView)

        // Replacing the buffer mid-composition drops the in-flight IME or
        // dictation candidate, so only external edits are pushed down.
        if textView.text != text, textView.markedTextRange == nil {
            textView.text = text
            let end = text.utf16.count
            textView.selectedRange = NSRange(location: end, length: 0)
            textView.scrollRangeToVisible(textView.selectedRange)
        }

        if isEditing, !textView.isFirstResponder {
            textView.becomeFirstResponder()
        } else if !isEditing, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: FeatureComposerUITextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        let fitting = uiView.sizeThatFits(
            CGSize(width: width, height: .greatestFiniteMagnitude)
        )
        return CGSize(
            width: width,
            height: FeatureComposerTextInputSizing.height(
                fittingHeight: fitting.height,
                lineHeight: uiView.font?.lineHeight ?? 22,
                maximumLineCount: maximumLineCount
            )
        )
    }

    private func apply(to textView: FeatureComposerUITextView) {
        textView.acceptsImages = acceptsImages
        textView.onPasteImages = onPasteImages
        textView.accessibilityLabel = "Message agent"
        textView.accessibilityHint = acceptsImages
            ? "Enter a message, or paste an image to attach it."
            : "Enter a message."
        textView.accessibilityValue = text.isEmpty ? placeholder : nil
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: FeatureComposerTextInput

        init(_ parent: FeatureComposerTextInput) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            guard parent.text != textView.text else { return }
            parent.text = textView.text
        }

        func textViewDidBeginEditing(_: UITextView) {
            if !parent.isEditing {
                parent.isEditing = true
            }
        }

        func textViewDidEndEditing(_: UITextView) {
            if parent.isEditing {
                parent.isEditing = false
            }
        }
    }
}

enum FeatureComposerTextInputSizing {
    static func height(
        fittingHeight: CGFloat,
        lineHeight: CGFloat,
        maximumLineCount: Int
    ) -> CGFloat {
        let lineHeight = lineHeight > 0 ? lineHeight : 22
        let cap = lineHeight * CGFloat(max(1, maximumLineCount))
        return min(max(fittingHeight, lineHeight), cap)
    }
}

final class FeatureComposerUITextView: UITextView {
    var acceptsImages = false
    var onPasteImages: (([NSItemProvider]) -> Void)?

    /// `UITextView` hides Paste when the pasteboard holds only images, which is
    /// exactly the case the composer wants, so the entry is re-offered here.
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)),
           acceptsImages,
           FeatureComposerPasteboardPolicy.containsImage(in: .general) {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func paste(_ sender: Any?) {
        guard acceptsImages else {
            super.paste(sender)
            return
        }
        let providers = FeatureComposerPasteboardPolicy.imageProviders(in: .general)
        guard !providers.isEmpty else {
            super.paste(sender)
            return
        }
        onPasteImages?(providers)
    }
}

enum FeatureComposerPasteboardPolicy {
    /// Detection only. `hasImages` and `contains(pasteboardTypes:)` are the
    /// pasteboard APIs that do not count as reading, so the edit menu can be
    /// built without tripping the system's paste prompt.
    static func containsImage(in pasteboard: UIPasteboard) -> Bool {
        pasteboard.hasImages
            || pasteboard.contains(pasteboardTypes: [UTType.image.identifier])
    }

    static func imageProviders(in pasteboard: UIPasteboard) -> [NSItemProvider] {
        pasteboard.itemProviders.filter {
            $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
        }
    }
}

/// How many pasted images the composer takes, and what to say when it takes
/// fewer than were offered.
struct FeatureComposerPastePlan: Equatable {
    let acceptedCount: Int
    let message: String?

    static func make(
        providerCount: Int,
        attachedCount: Int,
        pendingCount: Int,
        limit: Int = FeatureImageAttachmentLimit.maximumCount
    ) -> FeatureComposerPastePlan {
        guard providerCount > 0 else {
            return FeatureComposerPastePlan(acceptedCount: 0, message: nil)
        }
        let remaining = max(0, limit - attachedCount - pendingCount)
        guard remaining > 0 else {
            return FeatureComposerPastePlan(
                acceptedCount: 0,
                message: "You can attach up to \(limit) images."
            )
        }
        let accepted = min(providerCount, remaining)
        guard accepted < providerCount else {
            return FeatureComposerPastePlan(acceptedCount: accepted, message: nil)
        }
        return FeatureComposerPastePlan(
            acceptedCount: accepted,
            message: "Only \(accepted) of \(providerCount) images were attached. "
                + "You can attach up to \(limit)."
        )
    }
}
