import SwiftUI
import UIKit

/// Native chat Markdown with block-aware layout and Foundation inline parsing.
struct MarkdownMessageView: View {
    private struct RenderRequest: Hashable {
        let revision: MarkdownContentRevision
        let isStreaming: Bool
    }

    private let source: String
    private let revision: MarkdownContentRevision
    private let isStreaming: Bool
    private let onOpenURL: ((URL) -> Bool)?
    private let imageContext: MarkdownImageContext?
    private let copyActionTitle: String
    @State private var selectionSource: MarkdownSelectionSource
    @State private var renderedDocument: MarkdownRenderedDocument?
    @State private var streamingRenderer = StreamingMarkdownRenderer()

    init(
        _ source: String,
        isStreaming: Bool = false,
        onOpenURL: ((URL) -> Bool)? = nil,
        imageContext: MarkdownImageContext? = nil,
        copyActionTitle: String = "Copy message"
    ) {
        self.source = source
        self.isStreaming = isStreaming
        self.onOpenURL = onOpenURL
        self.imageContext = imageContext
        self.copyActionTitle = copyActionTitle
        _selectionSource = State(initialValue: MarkdownSelectionSource(source))
        let revision = MarkdownContentRevision(source)
        self.revision = revision
        let initialDocument = if isStreaming {
            MarkdownRenderCache.shared.cachedDocument(for: revision)
        } else {
            MarkdownRenderCache.shared.documentImmediately(for: revision)
        }
        _renderedDocument = State(
            initialValue: initialDocument
        )
    }

    var body: some View {
        let selectionContext = selectionContext
        Group {
            if let displayDocument {
                MarkdownBlocksView(
                    blocks: displayDocument.blocks,
                    selectionContext: selectionContext,
                    imageContext: imageContext,
                    allowsUnifiedSelection: !isStreaming
                )
            } else {
                // Parsing waits briefly so token-by-token streaming cancels stale revisions
                // instead of scheduling work for content the user will never see.
                Text(verbatim: source)
                    .font(T3Typography.threadBody)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityAction(named: copyActionTitle) {
            UIPasteboard.general.string = source
        }
        .environment(\.openURL, OpenURLAction { url in
            if onOpenURL?(url) == true { return .handled }
            guard MarkdownExternalLink.safeURL(url) != nil else { return .discarded }
            return .systemAction
        })
        .task(id: RenderRequest(revision: revision, isStreaming: isStreaming)) {
            if !isStreaming {
                streamingRenderer.cancel()
                // Streaming -> complete usually keeps the final text; promote
                // the last streamed render instead of reparsing synchronously.
                if let renderedDocument, renderedDocument.revision == revision {
                    MarkdownRenderCache.shared.promote(renderedDocument)
                    return
                }
                renderedDocument = MarkdownRenderCache.shared.documentImmediately(for: revision)
                return
            }

            if let cached = MarkdownRenderCache.shared.cachedDocument(for: revision) {
                renderedDocument = cached
                return
            }

            // Hand the revision to a renderer that outlives this task. The
            // task modifier cancels on every revision, so rendering inside it
            // starves as soon as parsing is slower than the publish cadence;
            // the renderer instead keeps one render running and always picks
            // up the newest revision when it finishes (latest wins).
            streamingRenderer.submit(revision) { renderedDocument = $0 }
        }
        .onDisappear {
            streamingRenderer.cancel()
        }
    }

    private var displayDocument: MarkdownRenderedDocument? {
        if let renderedDocument, renderedDocument.revision == revision {
            return renderedDocument
        }
        // While streaming, a slightly stale document is better than flashing
        // back to plain text between renders. Streamed content only appends,
        // so require the stale document to be a prefix of the current source:
        // that accepts earlier snapshots of this message and rejects leftovers
        // from a recycled cell showing a different message.
        if isStreaming {
            if let renderedDocument,
               renderedDocument.revision.utf8Count <= revision.utf8Count,
               source.utf8.starts(with: renderedDocument.revision.source.utf8) {
                return renderedDocument
            }
            return nil
        }
        return MarkdownRenderCache.shared.documentImmediately(for: revision)
    }

    private var selectionContext: MarkdownSelectionContext {
        selectionSource.text = source
        return MarkdownSelectionContext(
            source: selectionSource,
            copyActionTitle: copyActionTitle
        )
    }
}

enum MarkdownExternalLink {
    /// Transcript and repository markdown are untrusted input. Only ordinary,
    /// credential-free web URLs may leave the app through the system handler.
    static func safeURL(_ url: URL) -> URL? {
        guard let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host?.isEmpty == false,
              url.user == nil,
              url.password == nil else {
            return nil
        }
        return url
    }
}

/// Renders streaming revisions outside SwiftUI's task lifecycle so a render
/// in progress is never cancelled by the next revision arriving. One render
/// runs at a time; newer revisions replace the pending slot (latest wins) and
/// a 150ms throttle bounds the render cadence.
@MainActor
private final class StreamingMarkdownRenderer {
    private let throttle: Duration = .milliseconds(150)
    private var pending: MarkdownContentRevision?
    private var deliver: ((MarkdownRenderedDocument) -> Void)?
    private var renderTask: Task<Void, Never>?
    private var generation = 0
    private var lastRenderAt: Date?

    func submit(
        _ revision: MarkdownContentRevision,
        deliver: @escaping (MarkdownRenderedDocument) -> Void
    ) {
        pending = revision
        self.deliver = deliver
        guard renderTask == nil else { return }
        generation += 1
        let generation = generation
        renderTask = Task { [weak self] in
            await self?.drain(generation: generation)
        }
    }

    func cancel() {
        generation += 1
        renderTask?.cancel()
        renderTask = nil
        pending = nil
        deliver = nil
    }

    private func drain(generation: Int) async {
        // A cancelled drain can unwind after a replacement was already
        // started; only the current generation may clear the shared slot or
        // deliver, so two drains can never race or regress the document.
        defer {
            if self.generation == generation { renderTask = nil }
        }
        while self.generation == generation, let revision = pending {
            pending = nil
            if let lastRenderAt {
                let elapsed = Duration.seconds(-lastRenderAt.timeIntervalSinceNow)
                if elapsed < throttle {
                    try? await Task.sleep(for: throttle - elapsed)
                }
            }
            guard !Task.isCancelled else { return }
            // Render the newest revision available after the throttle wait.
            let target = pending ?? revision
            pending = nil
            guard let document = await MarkdownRenderCache.shared.document(
                for: target,
                isIntermediate: true
            ) else { continue }
            guard !Task.isCancelled, self.generation == generation else { return }
            lastRenderAt = .now
            deliver?(document)
        }
    }
}

private final class MarkdownSelectionSource: @unchecked Sendable {
    var text: String

    init(_ text: String) {
        self.text = text
    }
}

private struct MarkdownSelectionContext: Equatable, Sendable {
    let source: MarkdownSelectionSource
    let copyActionTitle: String

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.source === rhs.source && lhs.copyActionTitle == rhs.copyActionTitle
    }
}

private enum MarkdownTextColor: Equatable, Sendable {
    case primary
    case secondary

    var uiColor: UIColor {
        switch self {
        case .primary: T3Colors.uiTextPrimary
        case .secondary: T3Colors.uiTextSecondary
        }
    }
}

private struct MarkdownBlocksView: View {
    @SwiftUI.Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectableCache = MarkdownSelectableDocumentCache()

    let blocks: [MarkdownRenderedBlock]
    let selectionContext: MarkdownSelectionContext
    var imageContext: MarkdownImageContext?
    var spacing: CGFloat = 12
    var textColor: MarkdownTextColor = .primary
    var allowsUnifiedSelection = true

    var body: some View {
        let segments = MarkdownSelectableDocumentAttributes.segments(
            in: blocks,
            allowsSelectableSegments: allowsUnifiedSelection
        )
        let _ = selectableCache.retain(
            blockSets: segments.compactMap { segment in
                guard case let .selectable(blocks) = segment else { return nil }
                return blocks
            },
            textColor: textColor.uiColor,
            dynamicTypeSize: dynamicTypeSize,
            blockSpacing: spacing
        )
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(segments.indices, id: \.self) { index in
                switch segments[index] {
                case let .selectable(segmentBlocks):
                    MarkdownDocumentText(
                        attributedText: MarkdownSelectableDocumentAttributes.make(
                            from: segmentBlocks,
                            textColor: textColor.uiColor,
                            dynamicTypeSize: dynamicTypeSize,
                            blockSpacing: spacing,
                            cache: selectableCache
                        ),
                        selectionContext: selectionContext
                    )
                case let .rich(block):
                    // Unchanged blocks share inline runs by reference across
                    // streaming revisions, so equatable comparison skips their
                    // body and layout entirely; only the changed tail re-renders.
                    MarkdownBlockView(
                        block: block,
                        selectionContext: selectionContext,
                        textColor: textColor,
                        imageContext: imageContext,
                        allowsUnifiedSelection: allowsUnifiedSelection
                    )
                        .equatable()
                }
            }
        }
    }
}

private struct MarkdownBlockView: View, Equatable {
    let block: MarkdownRenderedBlock
    let selectionContext: MarkdownSelectionContext
    let textColor: MarkdownTextColor
    let imageContext: MarkdownImageContext?
    let allowsUnifiedSelection: Bool
    nonisolated let imageContextID: MarkdownImageContext.ID?

    init(
        block: MarkdownRenderedBlock,
        selectionContext: MarkdownSelectionContext,
        textColor: MarkdownTextColor,
        imageContext: MarkdownImageContext?,
        allowsUnifiedSelection: Bool
    ) {
        self.block = block
        self.selectionContext = selectionContext
        self.textColor = textColor
        self.imageContext = imageContext
        self.allowsUnifiedSelection = allowsUnifiedSelection
        imageContextID = imageContext?.id
    }

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.block == rhs.block
            && lhs.selectionContext == rhs.selectionContext
            && lhs.textColor == rhs.textColor
            && lhs.allowsUnifiedSelection == rhs.allowsUnifiedSelection
            && lhs.imageContextID == rhs.imageContextID
    }

    @ViewBuilder
    var body: some View {
        switch block {
        case let .paragraph(inline):
            MarkdownInlineText(
                inline,
                selectionContext: selectionContext,
                lineSpacing: 4,
                textColor: textColor
            )

        case let .image(reference):
            if let imageContext {
                MarkdownWorkspaceImageView(reference: reference, context: imageContext)
            } else {
                Text(reference.alt ?? reference.source)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
            }

        case let .heading(level, inline):
            MarkdownInlineText(
                inline,
                selectionContext: selectionContext,
                textColor: textColor
            )
                .padding(.top, level <= 2 ? 3 : 1)

        case let .unorderedList(items):
            MarkdownListView(
                items: items,
                start: nil,
                selectionContext: selectionContext,
                textColor: textColor,
                imageContext: imageContext,
                allowsUnifiedSelection: allowsUnifiedSelection
            )

        case let .orderedList(start, items):
            MarkdownListView(
                items: items,
                start: start,
                selectionContext: selectionContext,
                textColor: textColor,
                imageContext: imageContext,
                allowsUnifiedSelection: allowsUnifiedSelection
            )

        case let .blockquote(blocks):
            MarkdownBlocksView(
                blocks: blocks,
                selectionContext: selectionContext,
                imageContext: imageContext,
                spacing: 9,
                textColor: .secondary,
                allowsUnifiedSelection: allowsUnifiedSelection
            )
                .foregroundStyle(T3Colors.textSecondary)
                .padding(.leading, 14)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(T3Colors.textTertiary)
                        .frame(width: 2)
                }

        case let .table(table):
            MarkdownTableView(
                table: table,
                selectionContext: selectionContext,
                textColor: textColor
            )

        case let .codeBlock(language, code, renderedCode):
            MarkdownCodeBlockView(
                language: language,
                code: code,
                renderedCode: renderedCode,
                selectionContext: selectionContext
            )

        case .thematicBreak:
            Rectangle()
                .fill(T3Colors.separator)
                .frame(height: 1)
                .padding(.vertical, 2)
                .accessibilityHidden(true)
        }
    }
}

private struct MarkdownTableView: View {
    let table: MarkdownRenderedTable
    let selectionContext: MarkdownSelectionContext
    let textColor: MarkdownTextColor

    private var columnWidths: [CGFloat] { table.columnWidths }

    var body: some View {
        ScrollView(.horizontal) {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                tableRow(table.header, isHeader: true)
                ForEach(table.rows.indices, id: \.self) { rowIndex in
                    tableRow(table.rows[rowIndex], isHeader: false)
                }
            }
            // A horizontal ScrollView still proposes the viewport width to its child.
            // Preserve the grid's measured column widths so it overflows and scrolls
            // instead of compressing prose columns into unreadable slivers.
            .fixedSize(horizontal: true, vertical: true)
            .background(T3Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(T3Colors.border, lineWidth: 1)
            }
        }
        .scrollIndicators(.visible)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Table with \(table.header.count) columns and \(table.rows.count) rows")
    }

    private func tableRow(
        _ cells: [MarkdownRenderedInline],
        isHeader: Bool
    ) -> some View {
        GridRow(alignment: .top) {
            ForEach(cells.indices, id: \.self) { columnIndex in
                MarkdownInlineText(
                    cells[columnIndex],
                    selectionContext: selectionContext,
                    lineSpacing: 3,
                    textColor: textColor
                )
                    .frame(
                        width: columnWidths[columnIndex],
                        alignment: alignment(for: columnIndex)
                    )
                    .frame(
                        minHeight: 44,
                        maxHeight: .infinity,
                        alignment: alignment(for: columnIndex)
                    )
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .overlay(alignment: .trailing) {
                        if columnIndex < cells.count - 1 {
                            Rectangle()
                                .fill(T3Colors.separator)
                                .frame(width: 1)
                        }
                    }
            }
        }
        .background(isHeader ? T3Colors.surfaceRaised : T3Colors.surface)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(T3Colors.separator)
                .frame(height: 1)
        }
    }

    private func alignment(for columnIndex: Int) -> Alignment {
        guard table.alignments.indices.contains(columnIndex) else { return .leading }
        return switch table.alignments[columnIndex] {
        case .natural, .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }

}

private struct MarkdownListView: View {
    let items: [MarkdownRenderedListItem]
    let start: Int?
    let selectionContext: MarkdownSelectionContext
    let textColor: MarkdownTextColor
    let imageContext: MarkdownImageContext?
    let allowsUnifiedSelection: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(items.indices, id: \.self) { offset in
                let item = items[offset]
                HStack(alignment: .top, spacing: 8) {
                    marker(for: item, offset: offset)
                        .frame(width: 24, height: 24, alignment: .trailing)
                    MarkdownBlocksView(
                        blocks: item.blocks,
                        selectionContext: selectionContext,
                        imageContext: imageContext,
                        spacing: 7,
                        textColor: textColor,
                        allowsUnifiedSelection: allowsUnifiedSelection
                    )
                }
                .accessibilityElement(children: .contain)
            }
        }
    }

    @ViewBuilder
    private func marker(for item: MarkdownRenderedListItem, offset: Int) -> some View {
        if let task = item.task {
            Image(systemName: task == .complete ? "checkmark.square.fill" : "square")
                .font(T3Typography.control)
                .foregroundStyle(
                    task == .complete ? T3Colors.success : T3Colors.textSecondary
                )
                .accessibilityLabel(task == .complete ? "Completed" : "Not completed")
        } else if let start {
            Text("\(start + offset).")
                .font(T3Typography.supporting.monospaced())
                .foregroundStyle(T3Colors.textSecondary)
                .accessibilityLabel("Item \(start + offset)")
        } else {
            Text("•")
                .font(T3Typography.threadBody.weight(.semibold))
                .foregroundStyle(T3Colors.textSecondary)
                .accessibilityHidden(true)
        }
    }
}

private struct MarkdownCodeBlockView: View {
    let language: String?
    let code: String
    let renderedCode: MarkdownRenderedInline
    let selectionContext: MarkdownSelectionContext
    @State private var wrapOverride: Bool?

    private var wrapsLines: Bool {
        wrapOverride ?? MarkdownCodeBlockWrapping.wrapsByDefault(language: language)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if let language, !language.isEmpty {
                    Text(language.uppercased())
                        .font(T3Typography.supportingStrong)
                        .foregroundStyle(T3Colors.textTertiary)
                } else {
                    Text("CODE")
                        .font(T3Typography.supportingStrong)
                        .foregroundStyle(T3Colors.textTertiary)
                }
                Spacer(minLength: 8)
                Button {
                    wrapOverride = !wrapsLines
                } label: {
                    Label("Wrap", systemImage: "arrow.turn.down.left")
                        .font(T3Typography.control)
                        .foregroundStyle(wrapsLines ? T3Colors.accent : T3Colors.textSecondary)
                        .frame(minHeight: 32)
                }
                .buttonStyle(.plain)
                .accessibilityValue(wrapsLines ? "On" : "Off")
                .accessibilityHint("Toggles line wrapping for this code block")
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                        .font(T3Typography.control)
                        .foregroundStyle(T3Colors.textSecondary)
                        .frame(minHeight: 32)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Copies this code block")
            }
            .padding(.horizontal, 13)
            .frame(minHeight: 40)

            Rectangle()
                .fill(T3Colors.separator)
                .frame(height: 1)

            if wrapsLines {
                MarkdownInlineText(
                    renderedCode,
                    selectionContext: selectionContext,
                    lineSpacing: 3,
                    wrapsLines: true
                )
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(13)
            } else {
                ScrollView(.horizontal) {
                    MarkdownInlineText(
                        renderedCode,
                        selectionContext: selectionContext,
                        lineSpacing: 3,
                        wrapsLines: false
                    )
                        .fixedSize(horizontal: true, vertical: true)
                        .padding(13)
                }
                .scrollIndicators(.hidden)
            }
        }
        .background(T3Colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(T3Colors.border, lineWidth: 1)
        }
    }
}

enum MarkdownCodeBlockWrapping {
    private static let proseLanguages: Set<String> = [
        "markdown",
        "md",
        "plain",
        "plaintext",
        "text",
        "text/plain",
        "txt",
    ]

    static func wrapsByDefault(language: String?) -> Bool {
        guard let language else { return false }
        return proseLanguages.contains(language.lowercased())
    }
}

private struct MarkdownDocumentText: UIViewRepresentable {
    @SwiftUI.Environment(\.openURL) private var openURL

    let attributedText: NSAttributedString
    let selectionContext: MarkdownSelectionContext

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.textContainer.widthTracksTextView = true
        textView.adjustsFontForContentSizeCategory = true
        textView.accessibilityTraits = .staticText
        textView.delegate = context.coordinator
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        if context.coordinator.shouldApply(attributedText) {
            let previousText = textView.attributedText.string
            let previousSelection = textView.selectedRange
            textView.attributedText = attributedText
            textView.selectedRange = MarkdownSelectionRestoration.range(
                previousText: previousText,
                previousRange: previousSelection,
                newText: attributedText.string
            )
            context.coordinator.didApplyText()
            context.coordinator.didApply(attributedText)
        }
        context.coordinator.selectionContext = selectionContext
        context.coordinator.onOpenURL = { openURL($0) }
        textView.accessibilityCustomActions = context.coordinator.accessibilityActions(
            title: selectionContext.copyActionTitle
        )
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width.isFinite, width > 0 else { return nil }
        return context.coordinator.size(
            for: uiView,
            proposedWidth: width
        )
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private struct SizeKey: Hashable {
            let width: CGFloat
            let textHash: Int
        }

        var selectionContext = MarkdownSelectionContext(
            source: MarkdownSelectionSource(""),
            copyActionTitle: "Copy message"
        )
        var onOpenURL: ((URL) -> Void)?
        private var cachedSize: (key: SizeKey, value: CGSize)?
        private var cachedAccessibilityTitle: String?
        private var cachedAccessibilityActions: [UIAccessibilityCustomAction] = []
        private var lastAppliedAttributedText: NSAttributedString?

        func didApplyText() {
            cachedSize = nil
        }

        func shouldApply(_ attributedText: NSAttributedString) -> Bool {
            lastAppliedAttributedText !== attributedText
        }

        func didApply(_ attributedText: NSAttributedString) {
            lastAppliedAttributedText = attributedText
        }

        func size(for textView: UITextView, proposedWidth: CGFloat) -> CGSize {
            let key = SizeKey(
                width: proposedWidth,
                textHash: textView.attributedText.hash
            )
            if cachedSize?.key == key, let value = cachedSize?.value { return value }
            let bounds = textView.attributedText.boundingRect(
                with: CGSize(width: proposedWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )
            let width = min(proposedWidth, max(1, ceil(bounds.width)))
            let fittingSize = textView.sizeThatFits(
                CGSize(width: width, height: .greatestFiniteMagnitude)
            )
            let value = CGSize(width: width, height: max(1, ceil(fittingSize.height)))
            cachedSize = (key, value)
            return value
        }

        func accessibilityActions(title: String) -> [UIAccessibilityCustomAction] {
            if cachedAccessibilityTitle == title { return cachedAccessibilityActions }
            cachedAccessibilityTitle = title
            cachedAccessibilityActions = [
                UIAccessibilityCustomAction(name: title) { [weak self] _ in
                    guard let self else { return false }
                    UIPasteboard.general.string = selectionContext.source.text
                    return true
                },
            ]
            return cachedAccessibilityActions
        }

        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            let copyMessage = UIAction(
                title: selectionContext.copyActionTitle,
                image: UIImage(systemName: "doc.on.doc")
            ) { [weak self] _ in
                guard let self else { return }
                UIPasteboard.general.string = selectionContext.source.text
            }
            return UIMenu(children: suggestedActions + [copyMessage])
        }

        func textView(
            _ textView: UITextView,
            shouldInteractWith URL: URL,
            in characterRange: NSRange,
            interaction: UITextItemInteraction
        ) -> Bool {
            guard interaction == .invokeDefaultAction else { return false }
            onOpenURL?(URL)
            return false
        }
    }
}

private struct MarkdownInlineText: UIViewRepresentable {
    @SwiftUI.Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @SwiftUI.Environment(\.openURL) private var openURL

    let rendered: MarkdownRenderedInline
    let selectionContext: MarkdownSelectionContext
    let lineSpacing: CGFloat
    let textColor: MarkdownTextColor
    let wrapsLines: Bool

    init(
        _ rendered: MarkdownRenderedInline,
        selectionContext: MarkdownSelectionContext,
        lineSpacing: CGFloat = 0,
        textColor: MarkdownTextColor = .primary,
        wrapsLines: Bool = true
    ) {
        self.rendered = rendered
        self.selectionContext = selectionContext
        self.lineSpacing = lineSpacing
        self.textColor = textColor
        self.wrapsLines = wrapsLines
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = false
        textView.showsHorizontalScrollIndicator = false
        textView.showsVerticalScrollIndicator = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.textContainer.widthTracksTextView = true
        textView.textContainer.lineBreakMode = wrapsLines ? .byWordWrapping : .byClipping
        textView.adjustsFontForContentSizeCategory = true
        textView.accessibilityTraits = .staticText
        textView.delegate = context.coordinator
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        let attributedText = context.coordinator.attributedText(
            from: rendered,
            lineSpacing: lineSpacing,
            textColor: textColor,
            dynamicTypeSize: dynamicTypeSize,
            wrapsLines: wrapsLines
        )
        if context.coordinator.shouldApply(attributedText) {
            let previousText = context.coordinator.lastAppliedText
            let previousSelection = textView.selectedRange
            textView.attributedText = attributedText
            textView.selectedRange = MarkdownSelectionRestoration.range(
                previousText: previousText,
                previousRange: previousSelection,
                newText: attributedText.string
            )
            context.coordinator.didApply(attributedText)
        }
        context.coordinator.selectionContext = selectionContext
        context.coordinator.onOpenURL = { url in
            openURL(url)
        }
        textView.accessibilityCustomActions = context.coordinator.accessibilityActions(
            title: selectionContext.copyActionTitle
        )
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context: Context
    ) -> CGSize? {
        guard let proposedWidth = proposal.width,
            proposedWidth.isFinite,
            proposedWidth > 0
        else {
            return wrapsLines ? nil : context.coordinator.unwrappedSize(for: uiView)
        }
        return context.coordinator.size(
            for: uiView,
            proposedWidth: proposedWidth,
            wrapsLines: wrapsLines
        )
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private struct CacheKey: Equatable {
            let lineSpacing: CGFloat
            let textColor: MarkdownTextColor
            let dynamicTypeSize: DynamicTypeSize
            let wrapsLines: Bool
        }

        private struct SizeKey: Hashable {
            let proposedWidth: CGFloat
            let wrapsLines: Bool
        }

        var selectionContext = MarkdownSelectionContext(
            source: MarkdownSelectionSource(""),
            copyActionTitle: "Copy message"
        )
        var onOpenURL: ((URL) -> Void)?
        private var cacheKey: CacheKey?
        private var cachedRendered: MarkdownRenderedInline?
        private var cachedAttributedText: NSAttributedString?
        private var cachedSizes: [SizeKey: CGSize] = [:]
        private var lastAppliedAttributedText: NSAttributedString?
        private var cachedAccessibilityTitle: String?
        private var cachedAccessibilityActions: [UIAccessibilityCustomAction] = []

        func attributedText(
            from rendered: MarkdownRenderedInline,
            lineSpacing: CGFloat,
            textColor: MarkdownTextColor,
            dynamicTypeSize: DynamicTypeSize,
            wrapsLines: Bool
        ) -> NSAttributedString {
            let key = CacheKey(
                lineSpacing: lineSpacing,
                textColor: textColor,
                dynamicTypeSize: dynamicTypeSize,
                wrapsLines: wrapsLines
            )
            if cachedRendered === rendered, key == cacheKey, let cachedAttributedText {
                return cachedAttributedText
            }
            let attributedText = MarkdownSelectableTextAttributes.make(
                from: rendered,
                lineSpacing: lineSpacing,
                foregroundColor: textColor.uiColor,
                dynamicTypeSize: dynamicTypeSize,
                wrapsLines: wrapsLines
            )
            cacheKey = key
            cachedRendered = rendered
            cachedAttributedText = attributedText
            cachedSizes.removeAll(keepingCapacity: true)
            return attributedText
        }

        var lastAppliedText: String {
            lastAppliedAttributedText?.string ?? ""
        }

        func shouldApply(_ attributedText: NSAttributedString) -> Bool {
            lastAppliedAttributedText !== attributedText
        }

        func didApply(_ attributedText: NSAttributedString) {
            lastAppliedAttributedText = attributedText
        }

        func size(
            for textView: UITextView,
            proposedWidth: CGFloat,
            wrapsLines: Bool
        ) -> CGSize {
            let key = SizeKey(proposedWidth: proposedWidth, wrapsLines: wrapsLines)
            if let cached = cachedSizes[key] {
                return cached
            }
            let bounds = textView.attributedText.boundingRect(
                with: CGSize(width: proposedWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )
            let width = min(proposedWidth, max(1, ceil(bounds.width)))
            let fittingSize = textView.sizeThatFits(
                CGSize(width: width, height: .greatestFiniteMagnitude)
            )
            let size = CGSize(width: width, height: max(1, ceil(fittingSize.height)))
            cachedSizes[key] = size
            return size
        }

        func unwrappedSize(for textView: UITextView) -> CGSize {
            let key = SizeKey(proposedWidth: .infinity, wrapsLines: false)
            if let cached = cachedSizes[key] {
                return cached
            }
            let longestLineLength = textView.attributedText.string
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map(\.utf16.count)
                .max() ?? 0
            let maximumWidth = max(10_000, CGFloat(longestLineLength) * 64)
            let fittingSize = textView.sizeThatFits(
                CGSize(width: maximumWidth, height: .greatestFiniteMagnitude)
            )
            let bounds = textView.attributedText.boundingRect(
                with: CGSize(width: maximumWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )
            let size = CGSize(
                width: max(1, ceil(bounds.width)),
                height: max(1, ceil(fittingSize.height))
            )
            cachedSizes[key] = size
            return size
        }

        func accessibilityActions(title: String) -> [UIAccessibilityCustomAction] {
            if cachedAccessibilityTitle == title {
                return cachedAccessibilityActions
            }
            cachedAccessibilityTitle = title
            cachedAccessibilityActions = [
                UIAccessibilityCustomAction(
                    name: title
                ) { [weak self] _ in
                    self?.copyMessage()
                    return true
                },
            ]
            return cachedAccessibilityActions
        }

        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            let copyMessage = UIAction(
                title: selectionContext.copyActionTitle,
                image: UIImage(systemName: "doc.on.doc")
            ) { [weak self] _ in
                self?.copyMessage()
            }
            return UIMenu(children: suggestedActions + [copyMessage])
        }

        func textView(
            _ textView: UITextView,
            shouldInteractWith URL: URL,
            in characterRange: NSRange,
            interaction: UITextItemInteraction
        ) -> Bool {
            guard interaction == .invokeDefaultAction else { return false }
            onOpenURL?(URL)
            return false
        }

        private func copyMessage() {
            UIPasteboard.general.string = selectionContext.source.text
        }
    }
}

enum MarkdownSelectableTextAttributes {
    @MainActor
    static func make(
        from rendered: MarkdownRenderedInline,
        lineSpacing: CGFloat,
        foregroundColor: UIColor = T3Colors.uiTextPrimary,
        dynamicTypeSize: DynamicTypeSize = .large,
        wrapsLines: Bool = true
    ) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = lineSpacing
        paragraphStyle.lineBreakMode = wrapsLines ? .byWordWrapping : .byClipping

        for run in rendered.attributedText.runs {
            let intent = run.inlinePresentationIntent
            var attributes: [NSAttributedString.Key: Any] = [
                .font: font(
                    for: rendered.style,
                    intent: intent,
                    dynamicTypeSize: dynamicTypeSize
                ),
                .foregroundColor: foregroundColor,
                .paragraphStyle: paragraphStyle,
            ]
            if intent?.contains(.code) == true {
                attributes[.backgroundColor] = UIColor.secondarySystemBackground
            }
            if intent?.contains(.strikethrough) == true {
                attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            if let link = run.link {
                attributes[.link] = link
                attributes[.foregroundColor] = UIColor.link
            }
            result.append(
                NSAttributedString(
                    string: String(rendered.attributedText[run.range].characters),
                    attributes: attributes
                )
            )
        }

        return result
    }

    @MainActor
    private static func font(
        for style: MarkdownInlineStyle,
        intent: InlinePresentationIntent?,
        dynamicTypeSize: DynamicTypeSize
    ) -> UIFont {
        var font = style.uiFont(dynamicTypeSize: dynamicTypeSize)
        if intent?.contains(.code) == true, style != .code {
            font = UIFont.monospacedSystemFont(
                ofSize: font.pointSize,
                weight: .regular
            )
        }

        let addsBold = intent?.contains(.stronglyEmphasized) == true
        let addsItalic = intent?.contains(.emphasized) == true
        guard addsBold || addsItalic else { return font }

        var traits = font.fontDescriptor.symbolicTraits
        if addsBold {
            traits.insert(.traitBold)
        }
        if addsItalic {
            traits.insert(.traitItalic)
        }
        if let descriptor = font.fontDescriptor.withSymbolicTraits(traits) {
            font = UIFont(descriptor: descriptor, size: 0)
        }
        return font
    }
}

@MainActor
final class MarkdownSelectableDocumentCache {
    private struct Entry {
        let blocks: [MarkdownRenderedBlock]
        let textColor: UIColor
        let dynamicTypeSize: DynamicTypeSize
        let blockSpacing: CGFloat
        let attributedText: NSAttributedString
    }

    private var entries: [Entry] = []

    func retain(
        blockSets: [[MarkdownRenderedBlock]],
        textColor: UIColor,
        dynamicTypeSize: DynamicTypeSize,
        blockSpacing: CGFloat
    ) {
        entries.removeAll { entry in
            !blockSets.contains(where: { $0 == entry.blocks })
                || !entry.textColor.isEqual(textColor)
                || entry.dynamicTypeSize != dynamicTypeSize
                || entry.blockSpacing != blockSpacing
        }
    }

    func value(
        for blocks: [MarkdownRenderedBlock],
        textColor: UIColor,
        dynamicTypeSize: DynamicTypeSize,
        blockSpacing: CGFloat,
        build: () -> NSAttributedString
    ) -> NSAttributedString {
        if let entry = entries.first(where: {
            $0.blocks == blocks
                && $0.textColor.isEqual(textColor)
                && $0.dynamicTypeSize == dynamicTypeSize
                && $0.blockSpacing == blockSpacing
        }) {
            return entry.attributedText
        }
        let attributedText = build()
        entries.append(Entry(
            blocks: blocks,
            textColor: textColor,
            dynamicTypeSize: dynamicTypeSize,
            blockSpacing: blockSpacing,
            attributedText: attributedText
        ))
        return attributedText
    }
}

enum MarkdownSelectableDocumentAttributes {
    enum Segment {
        case selectable([MarkdownRenderedBlock])
        case rich(MarkdownRenderedBlock)
    }

    static func segments(
        in blocks: [MarkdownRenderedBlock],
        allowsSelectableSegments: Bool = true
    ) -> [Segment] {
        guard allowsSelectableSegments else { return blocks.map(Segment.rich) }
        var result: [Segment] = []
        var selectable: [MarkdownRenderedBlock] = []
        func flushSelectable() {
            guard !selectable.isEmpty else { return }
            result.append(.selectable(selectable))
            selectable.removeAll(keepingCapacity: true)
        }
        for block in blocks {
            if isSelectable(block) {
                selectable.append(block)
            } else {
                flushSelectable()
                result.append(.rich(block))
            }
        }
        flushSelectable()
        return result
    }

    private static func isSelectable(_ block: MarkdownRenderedBlock) -> Bool {
        switch block {
        case .paragraph, .heading:
            true
        case let .unorderedList(items), let .orderedList(_, items):
            items.allSatisfy { $0.task == nil && $0.blocks.allSatisfy(isSelectable) }
        case .blockquote, .image, .table, .codeBlock, .thematicBreak:
            false
        }
    }

    @MainActor
    static func make(
        from blocks: [MarkdownRenderedBlock],
        textColor: UIColor = T3Colors.uiTextPrimary,
        dynamicTypeSize: DynamicTypeSize = .large,
        blockSpacing: CGFloat = 12,
        cache: MarkdownSelectableDocumentCache? = nil
    ) -> NSAttributedString {
        let build = {
            let result = NSMutableAttributedString()
            append(
                blocks,
                to: result,
                depth: 0,
                textColor: textColor,
                dynamicTypeSize: dynamicTypeSize,
                blockSpacing: blockSpacing
            )
            return result
        }
        return cache?.value(
            for: blocks,
            textColor: textColor,
            dynamicTypeSize: dynamicTypeSize,
            blockSpacing: blockSpacing,
            build: build
        ) ?? build()
    }

    @MainActor
    private static func append(
        _ blocks: [MarkdownRenderedBlock],
        to result: NSMutableAttributedString,
        depth: Int,
        textColor: UIColor,
        dynamicTypeSize: DynamicTypeSize,
        blockSpacing: CGFloat
    ) {
        for (index, block) in blocks.enumerated() {
            if index > 0 {
                appendSeparator(
                    to: result,
                    spacing: blockSpacing,
                    textColor: textColor,
                    dynamicTypeSize: dynamicTypeSize
                )
            }
            switch block {
            case let .paragraph(inline), let .heading(_, inline):
                result.append(MarkdownSelectableTextAttributes.make(
                    from: inline,
                    lineSpacing: 4,
                    foregroundColor: textColor,
                    dynamicTypeSize: dynamicTypeSize
                ))
            case let .unorderedList(items):
                appendList(
                    items,
                    start: nil,
                    to: result,
                    depth: depth,
                    textColor: textColor,
                    dynamicTypeSize: dynamicTypeSize,
                    blockSpacing: blockSpacing
                )
            case let .orderedList(start, items):
                appendList(
                    items,
                    start: start,
                    to: result,
                    depth: depth,
                    textColor: textColor,
                    dynamicTypeSize: dynamicTypeSize,
                    blockSpacing: blockSpacing
                )
            case .blockquote, .image, .table, .codeBlock, .thematicBreak:
                preconditionFailure("Rich blocks must be split before selectable rendering")
            }
        }
    }

    @MainActor
    private static func appendList(
        _ items: [MarkdownRenderedListItem],
        start: Int?,
        to result: NSMutableAttributedString,
        depth: Int,
        textColor: UIColor,
        dynamicTypeSize: DynamicTypeSize,
        blockSpacing: CGFloat
    ) {
        for (offset, item) in items.enumerated() {
            if offset > 0 { result.append(NSAttributedString(string: "\n")) }
            let itemStart = result.length
            let marker = if let task = item.task {
                task == .complete ? "☑" : "☐"
            } else if let start {
                "\(start + offset)."
            } else {
                "•"
            }
            let paragraph = NSMutableParagraphStyle()
            let bodyFont = MarkdownInlineStyle.body.uiFont(dynamicTypeSize: dynamicTypeSize)
            let indentUnit = max(32, ceil(bodyFont.pointSize * 1.5))
            paragraph.firstLineHeadIndent = CGFloat(depth) * indentUnit
            paragraph.headIndent = CGFloat(depth + 1) * indentUnit
            paragraph.paragraphSpacing = 6
            paragraph.lineSpacing = 4
            paragraph.defaultTabInterval = indentUnit
            paragraph.tabStops = [
                NSTextTab(textAlignment: .left, location: paragraph.headIndent),
            ]
            result.append(NSAttributedString(
                string: "\(marker)\t",
                attributes: [
                    .font: bodyFont,
                    .foregroundColor: T3Colors.uiTextSecondary,
                    .paragraphStyle: paragraph,
                ]
            ))
            append(
                item.blocks,
                to: result,
                depth: depth + 1,
                textColor: textColor,
                dynamicTypeSize: dynamicTypeSize,
                blockSpacing: 7
            )
            applyMinimumIndent(
                paragraph,
                to: result,
                range: NSRange(location: itemStart, length: result.length - itemStart)
            )
        }
    }

    private static func applyMinimumIndent(
        _ minimum: NSParagraphStyle,
        to result: NSMutableAttributedString,
        range: NSRange
    ) {
        let text = result.string as NSString
        var location = range.location
        while location < NSMaxRange(range) {
            let paragraphRange = NSIntersectionRange(text.paragraphRange(
                for: NSRange(location: location, length: 0)
            ), range)
            let existing = result.attribute(
                .paragraphStyle,
                at: paragraphRange.location,
                effectiveRange: nil
            ) as? NSParagraphStyle
            let merged = (existing?.mutableCopy() as? NSMutableParagraphStyle)
                ?? NSMutableParagraphStyle()
            if merged.headIndent < minimum.headIndent {
                merged.firstLineHeadIndent = minimum.firstLineHeadIndent
                merged.headIndent = minimum.headIndent
                merged.tabStops = minimum.tabStops
                merged.defaultTabInterval = minimum.defaultTabInterval
                merged.paragraphSpacing = max(merged.paragraphSpacing, minimum.paragraphSpacing)
                merged.lineSpacing = max(merged.lineSpacing, minimum.lineSpacing)
                if paragraphRange.location > range.location {
                    merged.firstLineHeadIndent = merged.headIndent
                }
            }
            result.addAttribute(.paragraphStyle, value: merged, range: paragraphRange)
            let next = NSMaxRange(paragraphRange)
            guard next > location else { break }
            location = next
        }
    }

    @MainActor
    private static func appendSeparator(
        to result: NSMutableAttributedString,
        spacing: CGFloat,
        textColor: UIColor,
        dynamicTypeSize: DynamicTypeSize
    ) {
        if result.length > 0,
           let style = result.attribute(
               .paragraphStyle,
               at: result.length - 1,
               effectiveRange: nil
           ) as? NSParagraphStyle,
           let spaced = style.mutableCopy() as? NSMutableParagraphStyle {
            spaced.paragraphSpacing = max(spaced.paragraphSpacing, spacing)
            let paragraph = (result.string as NSString).paragraphRange(
                for: NSRange(location: result.length - 1, length: 0)
            )
            result.addAttribute(.paragraphStyle, value: spaced, range: paragraph)
        }
        result.append(NSAttributedString(
            string: "\n",
            attributes: [
                .font: MarkdownInlineStyle.body.uiFont(dynamicTypeSize: dynamicTypeSize),
                .foregroundColor: textColor,
            ]
        ))
    }

}

enum MarkdownSelectionRestoration {
    static func range(
        previousText: String,
        previousRange: NSRange,
        newText: String
    ) -> NSRange {
        guard newText.utf16.starts(with: previousText.utf16),
            NSMaxRange(previousRange) <= (newText as NSString).length
        else {
            return NSRange(location: 0, length: 0)
        }
        return previousRange
    }
}

enum MarkdownInlineFormatter {
    static func format(_ source: String) -> AttributedString {
        (
            try? AttributedString(
                markdown: source,
                options: AttributedString.MarkdownParsingOptions(
                    interpretedSyntax: .inlineOnlyPreservingWhitespace,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
        ) ?? AttributedString(source)
    }
}
