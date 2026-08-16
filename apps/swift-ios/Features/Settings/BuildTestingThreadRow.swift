import SwiftUI

struct BuildTestingThreadRow: View {
    let thread: BuildTestingManifest.Thread

    var body: some View {
        Group {
            if let url = PlatformRoute.thread(environmentID: nil, threadID: thread.id).url {
                Link(destination: url) {
                    Label(thread.title, systemImage: "bubble.left.and.bubble.right")
                }
            } else {
                Label(thread.title, systemImage: "bubble.left.and.bubble.right")
            }
        }
        .font(T3Typography.supporting)
        .foregroundStyle(T3Colors.accent)
    }
}
