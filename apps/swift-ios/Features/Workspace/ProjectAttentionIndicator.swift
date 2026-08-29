import SwiftUI

struct ProjectAttentionIndicator: View {
    let state: ProjectAttentionState

    var body: some View {
        Image(systemName: state.systemImage)
            .imageScale(.small)
            .foregroundStyle(color)
            .accessibilityLabel(state.accessibilityLabel)
    }

    private var color: Color {
        switch state {
        case .failure:
            T3Colors.danger
        case .pendingInput:
            T3Colors.statusInput
        case .unseenCompletion:
            T3Colors.success
        }
    }
}
