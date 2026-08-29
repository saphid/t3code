import Foundation

enum NativeWorkspaceMapper {
    static func files(
        _ entries: [ProjectEntry],
        directory: String?
    ) -> [FeatureFileEntry] {
        let directory = normalize(directory ?? "")
        let prefix = directory.isEmpty ? "" : "\(directory)/"
        var children: [String: FeatureFileEntry] = [:]

        for entry in entries {
            let fullPath = normalize(entry.path)
            guard fullPath.hasPrefix(prefix) else { continue }
            let remainder = String(fullPath.dropFirst(prefix.count))
            guard !remainder.isEmpty else { continue }

            let component = remainder.split(separator: "/", maxSplits: 1).first.map(String.init)!
            let childPath = prefix + component
            let isNested = remainder.contains("/")
            let kind: FeatureFileKind = isNested || entry.kind == .directory
                ? .directory
                : .file
            if children[childPath]?.kind == .directory {
                continue
            }
            children[childPath] = FeatureFileEntry(
                path: childPath,
                name: component,
                kind: kind,
                isHidden: component.hasPrefix(".")
            )
        }

        return Array(children.values).featureFiltered(by: "", includesHidden: true)
    }

    static func language(for path: String) -> String? {
        switch URL(fileURLWithPath: path).pathExtension.lowercased() {
        case "swift": "swift"
        case "ts", "tsx": "typescript"
        case "js", "jsx", "mjs", "cjs": "javascript"
        case "json": "json"
        case "md", "mdx": "markdown"
        case "css", "scss": "css"
        case "html", "htm": "html"
        case "xml", "svg": "xml"
        case "sh", "zsh", "bash": "shell"
        case "py": "python"
        case "rs": "rust"
        case "go": "go"
        case "rb": "ruby"
        case "sql": "sql"
        case "toml": "toml"
        case "yml", "yaml": "yaml"
        default: nil
        }
    }

    static func review(_ preview: ReviewDiffPreview) -> FeatureReview {
        FeatureReview(
            title: "Working tree",
            baseReference: preview.sources.compactMap(\.baseRef).first,
            files: preview.sources.flatMap(parseDiff),
            isTruncated: preview.sources.contains(where: \.truncated)
        )
    }

    static func sourceControl(_ status: VCSStatus) -> FeatureSourceControlStatus {
        sourceControl(
            isRepository: status.isRepo,
            branch: status.refName,
            files: status.workingTree.files,
            aheadCount: status.aheadCount,
            behindCount: status.behindCount,
            pullRequest: status.pr
        )
    }

    static func sourceControl(
        local: VCSLocalStatus,
        remote: VCSRemoteStatus?
    ) -> FeatureSourceControlStatus {
        sourceControl(
            isRepository: local.isRepo,
            branch: local.refName,
            files: local.workingTree.files,
            aheadCount: remote?.aheadCount ?? 0,
            behindCount: remote?.behindCount ?? 0,
            pullRequest: remote?.pr
        )
    }

    private static func sourceControl(
        isRepository: Bool,
        branch: String?,
        files: [VCSWorkingTreeFile],
        aheadCount: Int,
        behindCount: Int,
        pullRequest: VCSChangeRequest?
    ) -> FeatureSourceControlStatus {
        FeatureSourceControlStatus(
            isRepository: isRepository,
            branch: branch,
            aheadCount: aheadCount,
            behindCount: behindCount,
            files: files.map {
                FeatureSourceControlFile(
                    path: $0.path,
                    state: .modified,
                    isStaged: false
                )
            },
            pullRequest: pullRequest.map {
                FeaturePullRequest(
                    number: $0.number,
                    title: $0.title,
                    state: $0.state,
                    url: URL(string: $0.url)
                )
            }
        )
    }

    static func gitAction(_ action: FeatureSourceControlAction) -> GitStackedAction {
        switch action {
        case .commit: .commit
        case .push: .push
        case .createPullRequest: .createPullRequest
        case .commitAndPush: .commitAndPush
        case .commitPushAndCreatePullRequest: .commitPushAndPullRequest
        case .pull:
            // Pull has a dedicated VCS endpoint and never reaches this mapping.
            .push
        }
    }

    static func terminal(_ snapshot: TerminalSessionSnapshot) -> FeatureTerminalSnapshot {
        FeatureTerminalSnapshot(
            threadID: snapshot.threadId,
            terminalID: snapshot.terminalId,
            state: terminalState(snapshot.status),
            title: snapshot.label,
            workingDirectory: snapshot.cwd,
            buffer: snapshot.history,
            exitCode: snapshot.exitCode,
            updatedAt: snapshot.updatedAt
        )
    }

    static func terminal(_ summary: TerminalSummary) -> FeatureTerminalSnapshot {
        FeatureTerminalSnapshot(
            threadID: summary.threadId,
            terminalID: summary.terminalId,
            state: terminalState(summary.status),
            title: summary.label,
            workingDirectory: summary.cwd,
            exitCode: summary.exitCode,
            hasRunningSubprocess: summary.hasRunningSubprocess,
            updatedAt: summary.updatedAt
        )
    }

    private static func terminalState(_ status: TerminalSessionStatus) -> FeatureTerminalState {
        switch status {
        case .starting: .starting
        case .running: .running
        case .exited: .exited
        case .error: .failed
        }
    }

    private static func normalize(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "/")
            .split(separator: "/", omittingEmptySubsequences: true)
            .joined(separator: "/")
    }

    private static func parseDiff(_ source: ReviewDiffSource) -> [FeatureReviewFile] {
        let rawLines = source.diff.split(
            separator: "\n",
            omittingEmptySubsequences: false
        ).map(String.init)
        var files: [FeatureReviewFile] = []
        var currentPath: String?
        var previousPath: String?
        var currentPathResolved = false
        var previousPathResolved = false
        var oldPrefix: String?
        var newPrefix: String?
        var change = FeatureReviewChangeKind.modified
        var lines: [FeatureDiffLine] = []
        var oldLine: Int?
        var newLine: Int?
        var additions = 0
        var deletions = 0

        func finishFile() {
            guard let currentPath else { return }
            files.append(
                FeatureReviewFile(
                    path: currentPath,
                    previousPath: previousPath,
                    change: change,
                    additions: additions,
                    deletions: deletions,
                    lines: annotateChangedSpans(lines),
                    sourceKind: source.kind,
                    sourceBaseReference: source.baseRef,
                    sourceHeadReference: source.headRef,
                    isPathResolved: currentPathResolved
                        && (previousPath == nil || previousPathResolved)
                )
            )
        }

        for (index, line) in rawLines.enumerated() {
            if line.hasPrefix("diff --git ") {
                finishFile()
                let header = GitDiffPathParser.header(line)
                currentPath = header.newPath ?? header.displayPath
                previousPath = header.oldPath
                currentPathResolved = header.newPath != nil
                previousPathResolved = header.oldPath != nil
                oldPrefix = header.oldPrefix
                newPrefix = header.newPrefix
                change = .modified
                lines = []
                oldLine = nil
                newLine = nil
                additions = 0
                deletions = 0
                continue
            }
            if line.hasPrefix("new file mode ") {
                change = .added
                continue
            }
            if line.hasPrefix("deleted file mode ") {
                change = .deleted
                continue
            }
            if line.hasPrefix("rename from ") {
                let parsed = GitDiffPathParser.metadata(
                    String(line.dropFirst("rename from ".count))
                )
                previousPath = parsed.workspacePath ?? parsed.displayPath
                previousPathResolved = parsed.workspacePath != nil
                change = .renamed
                continue
            }
            if line.hasPrefix("rename to ") {
                let parsed = GitDiffPathParser.metadata(
                    String(line.dropFirst("rename to ".count))
                )
                currentPath = parsed.workspacePath ?? parsed.displayPath
                currentPathResolved = parsed.workspacePath != nil
                change = .renamed
                continue
            }
            if line.hasPrefix("copy from ") {
                let parsed = GitDiffPathParser.metadata(
                    String(line.dropFirst("copy from ".count))
                )
                previousPath = parsed.workspacePath ?? parsed.displayPath
                previousPathResolved = parsed.workspacePath != nil
                change = .renamed
                continue
            }
            if line.hasPrefix("copy to ") {
                let parsed = GitDiffPathParser.metadata(
                    String(line.dropFirst("copy to ".count))
                )
                currentPath = parsed.workspacePath ?? parsed.displayPath
                currentPathResolved = parsed.workspacePath != nil
                change = .renamed
                continue
            }
            if line.hasPrefix("Binary files ") || line == "GIT binary patch" {
                change = .binary
                continue
            }
            if line.hasPrefix("+++ ") {
                let raw = String(line.dropFirst(4))
                if raw != "/dev/null" {
                    let parsed = GitDiffPathParser.marker(raw, expectedPrefix: newPrefix)
                    currentPath = parsed.workspacePath ?? parsed.displayPath
                    currentPathResolved = parsed.workspacePath != nil
                }
                continue
            }
            if line.hasPrefix("--- ") {
                let raw = String(line.dropFirst(4))
                if raw == "/dev/null" {
                    previousPath = nil
                    previousPathResolved = false
                } else {
                    let parsed = GitDiffPathParser.marker(raw, expectedPrefix: oldPrefix)
                    previousPath = parsed.workspacePath ?? parsed.displayPath
                    previousPathResolved = parsed.workspacePath != nil
                }
                continue
            }
            if line.hasPrefix("@@") {
                let ranges = line.split(separator: " ")
                oldLine = ranges.count > 1 ? rangeStart(String(ranges[1])) : nil
                newLine = ranges.count > 2 ? rangeStart(String(ranges[2])) : nil
                lines.append(
                    FeatureDiffLine(
                        id: "\(source.id)-\(index)",
                        kind: .hunk,
                        text: line
                    )
                )
                continue
            }

            let kind: FeatureDiffLineKind
            let rendered: String
            let renderedOld: Int?
            let renderedNew: Int?
            if line.hasPrefix("+") {
                kind = .addition
                rendered = String(line.dropFirst())
                renderedOld = nil
                renderedNew = newLine
                newLine = newLine.map { $0 + 1 }
                additions += 1
            } else if line.hasPrefix("-") {
                kind = .deletion
                rendered = String(line.dropFirst())
                renderedOld = oldLine
                renderedNew = nil
                oldLine = oldLine.map { $0 + 1 }
                deletions += 1
            } else if line.hasPrefix(" ") {
                kind = .context
                rendered = String(line.dropFirst())
                renderedOld = oldLine
                renderedNew = newLine
                oldLine = oldLine.map { $0 + 1 }
                newLine = newLine.map { $0 + 1 }
            } else {
                continue
            }
            lines.append(
                FeatureDiffLine(
                    id: "\(source.id)-\(index)",
                    kind: kind,
                    oldLine: renderedOld,
                    newLine: renderedNew,
                    text: rendered
                )
            )
        }
        finishFile()

        if files.isEmpty, !source.diff.isEmpty {
            return [
                FeatureReviewFile(
                    path: source.title,
                    change: .modified,
                    additions: additions,
                    deletions: deletions,
                    lines: annotateChangedSpans(lines),
                    sourceKind: source.kind,
                    sourceBaseReference: source.baseRef,
                    sourceHeadReference: source.headRef,
                    isPathResolved: false
                ),
            ]
        }
        return files
    }

    /// Git presents replacements as adjacent deletion/addition blocks. Pairing those
    /// lines here keeps the view dumb and makes word-level highlighting stable on scroll.
    private static func annotateChangedSpans(
        _ source: [FeatureDiffLine]
    ) -> [FeatureDiffLine] {
        var lines = source
        var index = 0
        while index < lines.count {
            guard lines[index].kind == .deletion || lines[index].kind == .addition else {
                index += 1
                continue
            }
            let start = index
            while index < lines.count,
                  lines[index].kind == .deletion || lines[index].kind == .addition {
                index += 1
            }
            let changedIndices = start ..< index
            let deletions = changedIndices.filter { lines[$0].kind == .deletion }
            let additions = changedIndices.filter { lines[$0].kind == .addition }
            for (deletionIndex, additionIndex) in zip(deletions, additions) {
                let spans = FeatureDiffWordHighlighter.spans(
                    old: lines[deletionIndex].text,
                    new: lines[additionIndex].text
                )
                lines[deletionIndex].spans = spans.old
                lines[additionIndex].spans = spans.new
            }
        }
        return lines
    }

    private static func rangeStart(_ range: String) -> Int? {
        Int(
            range
                .drop(while: { $0 == "-" || $0 == "+" })
                .split(separator: ",", maxSplits: 1)
                .first
                ?? ""
        )
    }
}
