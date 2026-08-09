import Foundation
import SwiftUI

struct MarkdownImageContext {
    struct ID: Hashable, Sendable {
        let resolverID: ObjectIdentifier?
        let threadID: String
        let workspaceRoot: String?
    }

    let assetResolver: (any FeatureWorkspaceAssetResolving)?
    let threadID: String
    let workspaceRoot: String?

    var id: ID {
        ID(
            resolverID: assetResolver.map(ObjectIdentifier.init),
            threadID: threadID,
            workspaceRoot: workspaceRoot
        )
    }

    init(client: any FeatureClient, threadID: String, workspaceRoot: String?) {
        assetResolver = client as? any FeatureWorkspaceAssetResolving
        self.threadID = threadID
        self.workspaceRoot = workspaceRoot
    }
}

struct MarkdownWorkspaceImage: Equatable {
    let sourceURL: URL
    let link: FeatureWorkspaceFileLink

    init?(source: String, workspaceRoot: String?) {
        let encodedSource = source.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
        guard let sourceURL = URL(string: source) ?? encodedSource.flatMap(URL.init(string:)),
              let link = FeatureWorkspaceFileLink(
                  url: sourceURL,
                  workspaceRoot: workspaceRoot
              ),
              FeatureFilePreviewKind.infer(path: link.path) == .image else { return nil }
        self.sourceURL = sourceURL
        self.link = link
    }
}

struct MarkdownWorkspaceImageView: View {
    private struct Request: Hashable {
        let reference: MarkdownImageReference
        let contextID: MarkdownImageContext.ID
    }

    let reference: MarkdownImageReference
    let context: MarkdownImageContext

    @SwiftUI.Environment(\.openURL) private var openURL
    @State private var resolvedURL: URL?
    @State private var failed = false

    private var image: MarkdownWorkspaceImage? {
        MarkdownWorkspaceImage(source: reference.source, workspaceRoot: context.workspaceRoot)
    }

    private var name: String {
        let alt = reference.alt?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let alt, !alt.isEmpty { return alt }
        return image?.link.entry.name ?? reference.source
    }

    var body: some View {
        Group {
            if image == nil {
                Text(name)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
            } else if failed {
                Label("Image unavailable: \(name)", systemImage: "exclamationmark.triangle")
                    .font(T3Typography.supporting.monospaced())
                    .foregroundStyle(T3Colors.textSecondary)
                    .padding(9)
                    .overlay { RoundedRectangle(cornerRadius: 8).stroke(T3Colors.border) }
            } else if let resolvedURL, let image {
                Button { openURL(image.sourceURL) } label: {
                    FeatureRemoteAttachmentThumbnail(url: resolvedURL)
                        .frame(maxWidth: .infinity)
                        .frame(height: 240)
                        .background(T3Colors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open image \(name)")
            } else {
                ProgressView(name)
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .background(T3Colors.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: Request(reference: reference, contextID: context.id)) { await resolve() }
    }

    private func resolve() async {
        resolvedURL = nil
        failed = false
        guard let image else { return }
        do {
            guard let assetResolver = context.assetResolver else {
                throw FeatureCapabilityUnavailable("Inline workspace images")
            }
            resolvedURL = try await assetResolver.workspaceAssetURL(
                threadID: context.threadID,
                path: image.link.path
            )
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
    }
}
