import AVKit
import SwiftUI

struct BuildTestingEvidenceVideo: View {
    let url: URL

    @State private var player: AVPlayer?
    @State private var loadFailed = false

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else if loadFailed {
                ContentUnavailableView(
                    "Video unavailable",
                    systemImage: "play.slash",
                    description: Text("Open the evidence link below to try again.")
                )
            } else {
                ProgressView("Loading video")
                    .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
        .aspectRatio(9 / 19.5, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(T3Colors.border, lineWidth: 1)
        }
        .accessibilityLabel("Annotated interaction video")
        .task(id: url) {
            player?.pause()
            player = nil
            loadFailed = false

            do {
                let asset = AVURLAsset(url: url)
                let isPlayable = try await asset.load(.isPlayable)
                guard !Task.isCancelled else { return }
                guard isPlayable else {
                    loadFailed = true
                    return
                }
                player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                loadFailed = true
            }
        }
        .onDisappear {
            player?.pause()
        }
    }
}
