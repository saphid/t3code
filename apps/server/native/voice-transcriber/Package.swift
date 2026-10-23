// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "t3-voice-transcriber",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(
            name: "t3-voice-transcriber",
            path: "Sources"
        )
    ]
)
