import SwiftUI

struct FeatureWorkspaceToolPanel: View {
    let client: any FeatureClient
    let threadID: String
    let workspaceRoot: String?
    let surface: FeatureThreadToolSurface
    let onSelect: (FeatureThreadToolSurface) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                switch surface {
                case .files:
                    FeatureFilesView(
                        client: client,
                        threadID: threadID,
                        workspaceRoot: workspaceRoot
                    )
                case let .file(path):
                    FeatureFilesView(
                        client: client,
                        threadID: threadID,
                        initialPath: path,
                        workspaceRoot: workspaceRoot
                    )
                case .review:
                    FeatureReviewView(client: client, threadID: threadID)
                case .sourceControl:
                    FeatureSourceControlView(client: client, threadID: threadID)
                case .terminal:
                    FeatureTerminalView(client: client, threadID: threadID)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("Files", systemImage: "folder") { onSelect(.files) }
                        Button("Review changes", systemImage: "doc.text.magnifyingglass") { onSelect(.review) }
                        Button("Source control", systemImage: "arrow.triangle.branch") { onSelect(.sourceControl) }
                        Button("Terminal", systemImage: "terminal") { onSelect(.terminal) }
                    } label: {
                        Label("Workspace tools", systemImage: "square.grid.2x2")
                    }
                    .accessibilityIdentifier("workspace-panel-tools")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { onClose() }
                        .accessibilityIdentifier("workspace-panel-close")
                }
            }
        }
        .id(surface.id)
    }
}

public enum FeatureThreadToolSurface: Identifiable {
    case files
    case file(String)
    case review
    case sourceControl
    case terminal

    public var id: String {
        switch self {
        case .files: "files"
        case let .file(path): "file:\(path)"
        case .review: "review"
        case .sourceControl: "sourceControl"
        case .terminal: "terminal"
        }
    }
}

