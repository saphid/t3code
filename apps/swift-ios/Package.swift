// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "T3CodeSimulatorFreeTests",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "T3CodeMarkdownLayout", targets: ["T3CodeMarkdownLayout"]),
    ],
    targets: [
        .target(
            name: "T3CodeMarkdownLayout",
            path: "Features/Chat/MarkdownTable",
            sources: ["MarkdownTableLayout.swift"]
        ),
        .testTarget(
            name: "T3CodeMarkdownLayoutTests",
            dependencies: ["T3CodeMarkdownLayout"],
            path: "Tests/FeatureTests/MarkdownTable",
            sources: ["MarkdownTableLayoutTests.swift"]
        ),
    ]
)
