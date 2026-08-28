import SwiftUI

public struct FeatureReviewView: View {
    @SwiftUI.Environment(\.scenePhase) private var scenePhase
    let client: any FeatureClient
    let threadID: String
    let appendCommentToDraft: (FeatureReviewCommentDraft) -> Void

    @State private var review: FeatureReview?
    @State private var isLoading = true
    @State private var errorMessage: String?

    public init(
        client: any FeatureClient,
        threadID: String,
        appendCommentToDraft: @escaping (FeatureReviewCommentDraft) -> Void
    ) {
        self.client = client
        self.threadID = threadID
        self.appendCommentToDraft = appendCommentToDraft
    }

    public var body: some View {
        Group {
            if isLoading, review == nil {
                ProgressView("Loading changes…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let review {
                reviewList(review)
            } else {
                ContentUnavailableView(
                    "Review unavailable",
                    systemImage: "doc.text.magnifyingglass",
                    description: Text(errorMessage ?? "Changes could not be loaded.")
                )
            }
        }
        .background(T3Colors.background)
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Reload changes")
            }
        }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, review != nil, !isLoading else { return }
            Task { await load() }
        }
    }

    private func reviewList(_ review: FeatureReview) -> some View {
        List {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(review.title)
                            .font(T3Typography.navigationTitle)
                        if let base = review.baseReference {
                            Text(base)
                                .font(T3Typography.tool)
                                .foregroundStyle(T3Colors.textSecondary)
                        }
                    }
                    Spacer()
                    FeatureDiffStatsLabel(additions: review.additions, deletions: review.deletions)
                }
                .padding(.vertical, 3)

                if review.isTruncated {
                    Label("Large diff, showing a partial result", systemImage: "exclamationmark.triangle")
                        .font(T3Typography.supporting)
                        .foregroundStyle(.orange)
                }
            }

            Section("\(review.files.count) changed \(review.files.count == 1 ? "file" : "files")") {
                if review.files.isEmpty {
                    ContentUnavailableView(
                        "No changes",
                        systemImage: "checkmark.circle",
                        description: Text("The working tree is clean.")
                    )
                    .listRowBackground(Color.clear)
                }
                ForEach(review.files) { file in
                    NavigationLink {
                        FeatureDiffView(
                            client: client,
                            threadID: threadID,
                            sectionTitle: review.title,
                            file: file,
                            appendCommentToDraft: appendCommentToDraft
                        )
                    } label: {
                        FeatureReviewFileRow(file: file)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            review = try await client.loadReview(threadID: threadID)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct FeatureReviewFileRow: View {
    let file: FeatureReviewFile

    var body: some View {
        HStack(spacing: 10) {
            Text(changeLabel)
                .font(.caption2.monospaced().weight(.bold))
                .foregroundStyle(changeColor)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(fileName)
                    .font(T3Typography.homeTitle)
                    .lineLimit(1)
                if !directory.isEmpty {
                    Text(directory)
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            FeatureDiffStatsLabel(additions: file.additions, deletions: file.deletions)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }

    private var fileName: String {
        file.path.split(separator: "/").last.map(String.init) ?? file.path
    }

    private var directory: String {
        let components = file.path.split(separator: "/")
        return components.dropLast().joined(separator: "/")
    }

    private var changeLabel: String {
        switch file.change {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .binary: "B"
        }
    }

    private var changeColor: Color {
        switch file.change {
        case .added: .green
        case .deleted: .red
        case .renamed: .blue
        case .modified, .binary: .orange
        }
    }
}

struct FeatureDiffStatsLabel: View {
    let additions: Int
    let deletions: Int

    var body: some View {
        HStack(spacing: 5) {
            if additions > 0 {
                Text("+\(additions)").foregroundStyle(.green)
            }
            if deletions > 0 {
                Text("−\(deletions)").foregroundStyle(.red)
            }
        }
        .font(T3Typography.tool.monospacedDigit().weight(.medium))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(additions) additions, \(deletions) deletions")
    }
}

private struct FeatureDiffView: View {
    let client: any FeatureClient
    let threadID: String
    let sectionTitle: String
    let file: FeatureReviewFile
    let appendCommentToDraft: (FeatureReviewCommentDraft) -> Void

    @State private var renderedLines: [FeatureDiffLine]
    @State private var syntaxSpansByLineID: [String: [FeatureDiffSyntaxSpan]] = [:]
    @State private var isHydrating = false
    @State private var commentSession = FeatureReviewCommentSession()
    @FocusState private var isCommentFocused: Bool

    init(
        client: any FeatureClient,
        threadID: String,
        sectionTitle: String,
        file: FeatureReviewFile,
        appendCommentToDraft: @escaping (FeatureReviewCommentDraft) -> Void
    ) {
        self.client = client
        self.threadID = threadID
        self.sectionTitle = sectionTitle
        self.file = file
        self.appendCommentToDraft = appendCommentToDraft
        _renderedLines = State(initialValue: file.lines)
    }

    var body: some View {
        Group {
            if renderedLines.isEmpty, isHydrating {
                ProgressView("Loading full diff…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if renderedLines.isEmpty {
                ContentUnavailableView(
                    file.change == .binary ? "Binary file" : "Diff unavailable",
                    systemImage: file.change == .binary ? "doc.richtext" : "doc.text.magnifyingglass",
                    description: Text("No line-level preview is available.")
                )
            } else {
                GeometryReader { proxy in
                    ScrollView([.horizontal, .vertical]) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(renderedLines.enumerated(), id: \.element.id) { index, line in
                                FeatureDiffLineRow(
                                    line: line,
                                    syntaxSpans: syntaxSpansByLineID[line.id],
                                    isSelected: commentSession.selection?.contains(index) == true,
                                    minimumWidth: proxy.size.width,
                                    select: { selectLine(at: index) },
                                    startRange: { startRange(at: index) }
                                )
                            }
                        }
                        .frame(minWidth: proxy.size.width, alignment: .leading)
                        .padding(.vertical, 8)
                    }
                }
            }
        }
        .background(T3Colors.background)
        .navigationTitle(file.path.split(separator: "/").last.map(String.init) ?? file.path)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    commentSession.openFileComment()
                    focusComment()
                } label: {
                    Image(systemName: "text.bubble")
                }
                .accessibilityLabel("Add file review comment")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if commentSession.isCommenting {
                commentComposer
            } else if commentSession.isSelectingRange {
                rangeSelectionControls
            }
        }
        .task(id: file.id) { await hydrate() }
    }

    private var commentComposer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("REVIEW COMMENT")
                        .font(T3Typography.eyebrow)
                        .foregroundStyle(T3Colors.textTertiary)
                    Text(commentSession.selection?.locationLabel ?? "File comment")
                        .font(T3Typography.control)
                        .accessibilityIdentifier("review-comment-range-label")
                    Text(file.path)
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                Button {
                    commentSession.cancelComposer()
                    isCommentFocused = false
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: T3Metrics.minimumTapTarget, height: T3Metrics.minimumTapTarget)
                }
                .buttonStyle(.plain)
                .foregroundStyle(T3Colors.textSecondary)
                .accessibilityLabel("Close review comment")
            }

            TextField(
                "What should change?",
                text: $commentSession.comment,
                axis: .vertical
            )
            .font(T3Typography.composer)
            .lineLimit(2 ... 6)
            .focused($isCommentFocused)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(T3Colors.input)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(T3Colors.border, lineWidth: 1)
            }

            if let selection = commentSession.selection {
                FeatureReviewSelectionPreview(lines: selection.lines)
            }

            Button {
                appendComment()
            } label: {
                Label("Add to draft", systemImage: "arrow.down.to.line")
                    .frame(maxWidth: .infinity, minHeight: 42)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .background(T3Colors.accent)
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .disabled(trimmedComment.isEmpty)
            .font(T3Typography.control)
            .accessibilityIdentifier("review-comment-add-to-draft")
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(T3Colors.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(T3Colors.separator)
                .frame(height: 1)
        }
    }

    private var trimmedComment: String {
        commentSession.comment.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var rangeSelectionControls: some View {
        HStack(spacing: 12) {
            Button("Clear") {
                commentSession.clearSelection()
            }
            .foregroundStyle(T3Colors.textSecondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(commentSession.selection?.rangeLabel ?? "Select a diff line")
                    .font(T3Typography.control)
                Text("Tap a line to move the range end")
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button("Comment") {
                commentSession.openSelectedComment()
                focusComment()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(T3Colors.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(T3Colors.separator).frame(height: 1)
        }
        .accessibilityIdentifier("review-range-selection-controls")
    }

    private func selectLine(at index: Int) {
        if renderedLines[index].kind == .hunk {
            commentSession.clearSelection()
            return
        }
        commentSession.selectLine(at: index, in: renderedLines)
        if commentSession.isCommenting {
            focusComment()
        }
    }

    private func startRange(at index: Int) {
        commentSession.startRange(at: index, in: renderedLines)
    }

    private func focusComment() {
        Task { @MainActor in
            await Task.yield()
            isCommentFocused = true
        }
    }

    private func hydrate() async {
        isHydrating = true
        defer { isHydrating = false }
        await highlight(renderedLines)
        guard let contents = try? await client.loadReviewFileContents(
            threadID: threadID,
            file: file
        ) else {
            return
        }
        let hydratedLines = FeatureFullDiffHydrator.lines(for: file, contents: contents)
        renderedLines = hydratedLines
        commentSession.cancelComposer()
        await highlight(hydratedLines)
    }

    private func highlight(_ lines: [FeatureDiffLine]) async {
        let highlighted = await FeatureDiffSyntaxWorker.shared.lines(for: file, lines: lines)
        guard !Task.isCancelled else { return }
        syntaxSpansByLineID = highlighted.reduce(into: [:]) { result, line in
            result[line.id] = line.spans
        }
    }

    private func appendComment() {
        guard let draft = commentSession.takeDraft(
            sectionID: file.sourceKind ?? "review",
            sectionTitle: sectionTitle,
            filePath: file.path
        ) else { return }
        isCommentFocused = false
        appendCommentToDraft(draft)
    }
}

private struct FeatureDiffLineRow: View {
    let line: FeatureDiffLine
    let syntaxSpans: [FeatureDiffSyntaxSpan]?
    let isSelected: Bool
    let minimumWidth: CGFloat
    let select: () -> Void
    let startRange: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if line.kind == .hunk {
                Text(line.text)
                    .foregroundStyle(.blue)
                    .padding(.horizontal, 10)
                    .fixedSize(horizontal: true, vertical: false)
            } else {
                lineNumber(line.oldLine)
                lineNumber(line.newLine)
                Text(prefix)
                    .foregroundStyle(prefixColor)
                    .frame(width: 18)
                diffText
                    .fixedSize(horizontal: true, vertical: false)
                    .textSelection(.enabled)
                    .padding(.trailing, 12)
            }
        }
        .font(T3Typography.code)
        .t3CodeTextSize()
        .fixedSize(horizontal: true, vertical: false)
        .frame(
            minWidth: minimumWidth,
            minHeight: line.kind == .hunk ? 30 : 22,
            alignment: .leading
        )
        .background(background)
        .background(isSelected ? T3Colors.accent.opacity(0.14) : Color.clear)
        .overlay(alignment: .leading) {
            if isSelected {
                Rectangle()
                    .fill(T3Colors.accent)
                    .frame(width: 2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onLongPressGesture(minimumDuration: 0.35, perform: startRange)
        .accessibilityAction(named: "Add review comment", select)
        .accessibilityAction(named: "Select review range", startRange)
    }

    private func lineNumber(_ value: Int?) -> some View {
        Text(value.map(String.init) ?? "")
            .foregroundStyle(.tertiary)
            .frame(width: 48, alignment: .trailing)
            .padding(.trailing, 7)
            .accessibilityHidden(true)
    }

    private var prefix: String {
        switch line.kind {
        case .addition: "+"
        case .deletion: "−"
        case .context, .hunk: " "
        }
    }

    private var prefixColor: Color {
        switch line.kind {
        case .addition: .green
        case .deletion: .red
        case .context, .hunk: .secondary
        }
    }

    @ViewBuilder
    private var diffText: some View {
        if let syntaxSpans, !syntaxSpans.isEmpty {
            HStack(spacing: 0) {
                ForEach(syntaxSpans.indices, id: \.self) { index in
                    let span = syntaxSpans[index]
                    Text(verbatim: span.text)
                        .foregroundStyle(syntaxColor(for: span.syntax))
                        .fontWeight(span.emphasis == .changed ? .semibold : .regular)
                        .background(
                            span.emphasis == .changed ? changedSpanBackground : Color.clear
                        )
                }
            }
        } else if let spans = line.spans, !spans.isEmpty {
            HStack(spacing: 0) {
                ForEach(spans.indices, id: \.self) { index in
                    let span = spans[index]
                    Text(verbatim: span.text.isEmpty ? " " : span.text)
                        .foregroundStyle(.primary)
                        .fontWeight(span.kind == .changed ? .semibold : .regular)
                        .background(span.kind == .changed ? changedSpanBackground : Color.clear)
                }
            }
        } else {
            Text(line.text.isEmpty ? " " : line.text)
                .foregroundStyle(.primary)
        }
    }

    private func syntaxColor(for kind: FeatureSourceTokenKind) -> Color {
        switch kind {
        case .plain: .primary
        case .comment: T3Colors.textTertiary
        case .keyword: T3Colors.syntaxKeyword
        case .literal: T3Colors.syntaxLiteral
        case .number: T3Colors.syntaxNumber
        case .property: T3Colors.syntaxProperty
        }
    }

    private var changedSpanBackground: Color {
        switch line.kind {
        case .addition: Color.green.opacity(0.28)
        case .deletion: Color.red.opacity(0.28)
        case .context, .hunk: Color.clear
        }
    }

    private var background: Color {
        switch line.kind {
        case .addition: Color.green.opacity(0.11)
        case .deletion: Color.red.opacity(0.11)
        case .hunk: Color.blue.opacity(0.08)
        case .context: Color.clear
        }
    }
}

private struct FeatureReviewSelectionPreview: View {
    let lines: [FeatureDiffLine]

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(lines) { line in
                    HStack(spacing: 0) {
                        Text(line.oldLine.map(String.init) ?? "")
                            .frame(width: 36, alignment: .trailing)
                        Text(line.newLine.map(String.init) ?? "")
                            .frame(width: 36, alignment: .trailing)
                        Text(marker(for: line))
                            .frame(width: 18)
                        Text(line.text.isEmpty ? " " : line.text)
                            .padding(.trailing, 10)
                    }
                    .frame(minHeight: 22)
                }
            }
            .font(T3Typography.code)
            .t3CodeTextSize()
        }
        .frame(maxHeight: 110)
        .background(T3Colors.input)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(T3Colors.border, lineWidth: 1)
        }
        .accessibilityIdentifier("review-comment-selection-preview")
    }

    private func marker(for line: FeatureDiffLine) -> String {
        switch line.kind {
        case .addition: "+"
        case .deletion: "−"
        case .context, .hunk: " "
        }
    }
}
