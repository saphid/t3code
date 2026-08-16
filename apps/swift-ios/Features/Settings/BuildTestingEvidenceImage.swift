import SwiftUI

struct BuildTestingEvidenceImage: View {
    let url: URL
    let title: String

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    .scaledToFit()
            case .failure:
                ContentUnavailableView(
                    "Image unavailable",
                    systemImage: "photo.badge.exclamationmark",
                    description: Text("Open the evidence link below to try again.")
                )
            case .empty:
                ProgressView("Loading image")
                    .frame(maxWidth: .infinity, minHeight: 120)
            @unknown default:
                EmptyView()
            }
        }
        .clipShape(.rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(T3Colors.border, lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isImage)
    }
}
