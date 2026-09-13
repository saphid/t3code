import SwiftUI

/// Keeps the native inspector adjustable with touch as well as VoiceOver.
struct WorkspaceInspectorSizing: ViewModifier {
    let isResizable: Bool
    @AppStorage("workspaceInspectorWidth") private var savedWidth = WorkspaceInspectorWidth.standard
    @State private var dragStart: Double?
    @State private var dragWidth: Double?

    private var width: Double {
        WorkspaceInspectorWidth.clamped(dragWidth ?? savedWidth)
    }

    func body(content: Content) -> some View {
        content
            .inspectorColumnWidth(width)
            .overlay(alignment: .leading) {
                if isResizable {
                    Capsule()
                        .fill(Color(uiColor: .systemGray))
                        .frame(width: 4, height: 36)
                        .frame(width: 44, height: 100)
                        .contentShape(Rectangle())
                        .focusable()
                        .onKeyPress(.leftArrow) { adjustWidth(by: 20); return .handled }
                        .onKeyPress(.rightArrow) { adjustWidth(by: -20); return .handled }
                        .gesture(
                            DragGesture(minimumDistance: 3, coordinateSpace: .global)
                                .onChanged { value in
                                    let start = dragStart ?? width
                                    dragStart = start
                                    dragWidth = WorkspaceInspectorWidth.clamped(start - value.translation.width)
                                }
                                .onEnded { _ in finishResize() }
                        )
                        .accessibilityElement()
                        .accessibilityLabel("Workspace panel width")
                        .accessibilityValue("\(Int(width)) points")
                        .accessibilityHint("Swipe up or down to adjust the panel width")
                        .accessibilityAdjustableAction { direction in
                            switch direction {
                            case .increment: adjustWidth(by: 20)
                            case .decrement: adjustWidth(by: -20)
                            @unknown default: break
                            }
                        }
                        .accessibilityIdentifier("workspace-panel-resizer")
                }
            }
            .onChange(of: isResizable) { _, _ in finishResize() }
            .onDisappear { finishResize() }
    }

    private func adjustWidth(by amount: Double) {
        let adjusted = WorkspaceInspectorWidth.clamped(width + amount)
        dragStart = nil
        dragWidth = nil
        savedWidth = adjusted
    }

    private func finishResize() {
        if let dragWidth { savedWidth = WorkspaceInspectorWidth.clamped(dragWidth) }
        dragStart = nil
        dragWidth = nil
    }
}

enum WorkspaceInspectorWidth {
    static let standard = 340.0

    static func clamped(_ width: Double) -> Double {
        guard width.isFinite else { return standard }
        return min(440, max(280, width))
    }
}
