import Foundation
import SwiftUI

struct BuildChangelog: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        let commit: String
        let title: String
        let summary: String
        let pullRequest: Int?
        let pullRequestURL: URL?
        var shortCommit: String { String(commit.prefix(7)) }
        var displaySummary: String? {
            let value = summary.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty,
                  value.localizedCaseInsensitiveCompare(
                      title.trimmingCharacters(in: .whitespacesAndNewlines)
                  ) != .orderedSame else {
                return nil
            }
            return value
        }
    }

    let revision: String
    let baseRevision: String?
    let repositoryURL: URL?
    let generatedBy: String
    let marketingVersion: String?
    let buildNumber: String
    let entries: [Entry]

    static func load(info: [String: Any]?) -> BuildChangelog? {
        guard let encoded = info?["T3BuildChangelog"] as? String,
              !encoded.isEmpty,
              !encoded.hasPrefix("$("),
              let data = Data(base64Encoded: encoded)
        else { return nil }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let changelog = try? decoder.decode(BuildChangelog.self, from: data),
              resolvedValue("CFBundleVersion", info: info) == changelog.buildNumber
        else { return nil }
        if let marketingVersion = changelog.marketingVersion,
           resolvedValue("CFBundleShortVersionString", info: info) != marketingVersion {
            return nil
        }
        return changelog
    }

    private static func resolvedValue(_ key: String, info: [String: Any]?) -> String? {
        guard let rawValue = info?[key] as? String else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.hasPrefix("$(") else { return nil }
        return value
    }
}

struct BuildChangelogView: View {
    let changelog: BuildChangelog
    let versionLabel: String

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                header.padding(.bottom, 24)

                if !changelog.entries.isEmpty {
                    ForEach(Array(changelog.entries.reversed().enumerated()), id: \.element.commit) {
                        index, entry in
                        change(entry, isLatest: index == 0)
                            .padding(.bottom, 12)
                    }
                } else {
                    ContentUnavailableView(
                        "No changes in this build",
                        systemImage: "checkmark.circle",
                        description: Text(
                            changelog.baseRevision == nil
                                ? "This build did not configure a base revision for comparison."
                                : "No commits were found between this build and its configured base revision."
                        )
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                }
            }
            .padding(20)
        }
        .background(T3Colors.background)
        .navigationTitle("What’s in this build")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Version \(versionLabel)")
                .font(T3Typography.homeTitle)
                .foregroundStyle(T3Colors.textPrimary)
            Text("Revision \(String(changelog.revision.prefix(7))) · \(changelog.generatedBy)")
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func change(_ entry: BuildChangelog.Entry, isLatest: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if isLatest {
                Label("Latest change", systemImage: "sparkles")
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.accent)
            }
            Text(entry.title)
                .font(T3Typography.threadBody)
                .fontWeight(.semibold)
                .foregroundStyle(T3Colors.textPrimary)
            if let summary = entry.displaySummary {
                Text(summary)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            changeLinks(entry, repositoryURL: changelog.repositoryURL)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(T3Colors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(T3Colors.border, lineWidth: 1)
        }
    }

    private func changeLinks(
        _ entry: BuildChangelog.Entry,
        repositoryURL: URL?
    ) -> some View {
        HStack(spacing: 12) {
            if let repositoryURL {
                Link(destination: repositoryURL.appending(path: "commit/\(entry.commit)")) {
                    Label(entry.shortCommit, systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                }
                .accessibilityLabel("Commit \(entry.shortCommit)")
            } else {
                Text(entry.shortCommit)
            }
            if let pullRequest = entry.pullRequest, let pullRequestURL = entry.pullRequestURL {
                Link(destination: pullRequestURL) {
                    Label("PR #\(pullRequest)", systemImage: "arrow.triangle.pull")
                }
                .accessibilityLabel("Pull request \(pullRequest)")
            }
        }
        .font(.caption.monospaced())
        .foregroundStyle(T3Colors.accent)
    }
}
