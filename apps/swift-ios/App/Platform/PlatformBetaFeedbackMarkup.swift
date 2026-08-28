import SwiftUI

struct PlatformBetaFeedbackMarkup: Codable, Equatable, Sendable {
    struct Point: Codable, Equatable, Sendable {
        var x: Double
        var y: Double
    }

    struct Stroke: Codable, Equatable, Sendable {
        var points: [Point]
    }

    private(set) var strokes: [Stroke] = []

    init(strokes: [Stroke] = []) {
        self.strokes = strokes
    }

    var isEmpty: Bool {
        strokes.isEmpty
    }

    mutating func append(_ stroke: Stroke) {
        guard stroke.points.isEmpty == false else { return }
        strokes.append(stroke)
    }

    mutating func undo() {
        _ = strokes.popLast()
    }

    mutating func clear() {
        strokes.removeAll(keepingCapacity: true)
    }
}

@MainActor
enum PlatformBetaFeedbackMarkupRenderer {
    enum RenderError: LocalizedError {
        case invalidScreenshot
        case renderingFailed

        var errorDescription: String? {
            switch self {
            case .invalidScreenshot:
                "The captured screenshot could not be read."
            case .renderingFailed:
                "The annotated screenshot could not be rendered."
            }
        }
    }

    static func render(
        sourceJPEG: Data,
        markup: PlatformBetaFeedbackMarkup
    ) throws -> Data {
        guard let source = UIImage(data: sourceJPEG),
              let cgImage = source.cgImage else {
            throw RenderError.invalidScreenshot
        }
        guard markup.isEmpty == false else { return sourceJPEG }

        let size = CGSize(width: cgImage.width, height: cgImage.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let image = renderer.image { _ in
            source.draw(in: CGRect(origin: .zero, size: size))
            UIColor.systemRed.setStroke()
            for stroke in markup.strokes where stroke.points.isEmpty == false {
                let path = UIBezierPath()
                let first = stroke.points[0]
                path.move(to: CGPoint(x: first.x * size.width, y: first.y * size.height))
                for point in stroke.points.dropFirst() {
                    path.addLine(to: CGPoint(x: point.x * size.width, y: point.y * size.height))
                }
                path.lineWidth = max(4, min(size.width, size.height) * 0.012)
                path.lineCapStyle = .round
                path.lineJoinStyle = .round
                path.stroke()
            }
        }
        guard let data = image.jpegData(compressionQuality: 0.92) else {
            throw RenderError.renderingFailed
        }
        return data
    }
}

struct PlatformBetaFeedbackMarkupEditor: View {
    let sourceJPEG: Data
    let initialMarkup: PlatformBetaFeedbackMarkup
    let onCancel: @MainActor () -> Void
    let onDone: @MainActor (PlatformBetaFeedbackMarkup, Data) -> Void

    @State private var markup: PlatformBetaFeedbackMarkup
    @State private var currentPoints: [PlatformBetaFeedbackMarkup.Point] = []
    @GestureState private var isDrawing = false
    @State private var errorMessage: String?

    init(
        sourceJPEG: Data,
        initialMarkup: PlatformBetaFeedbackMarkup,
        onCancel: @escaping @MainActor () -> Void,
        onDone: @escaping @MainActor (PlatformBetaFeedbackMarkup, Data) -> Void
    ) {
        self.sourceJPEG = sourceJPEG
        self.initialMarkup = initialMarkup
        self.onCancel = onCancel
        self.onDone = onDone
        _markup = State(initialValue: initialMarkup)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let image = UIImage(data: sourceJPEG) {
                    GeometryReader { proxy in
                        let drawingSize = Self.aspectFit(
                            source: image.size,
                            container: proxy.size
                        )
                        Image(uiImage: image)
                            .resizable()
                            .frame(width: drawingSize.width, height: drawingSize.height)
                            .overlay {
                                PlatformBetaFeedbackMarkupCanvas(
                                    strokes: markup.strokes,
                                    currentPoints: currentPoints
                                )
                                .contentShape(Rectangle())
                                .gesture(drawingGesture(size: drawingSize))
                                .onChange(of: isDrawing) { wasDrawing, isDrawing in
                                    if wasDrawing, isDrawing == false {
                                        currentPoints.removeAll(keepingCapacity: true)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityLabel("Screenshot drawing canvas")
                            .accessibilityIdentifier("betaFeedbackMarkupCanvas")
                    }
                    .padding()
                } else {
                    ContentUnavailableView(
                        "Screenshot unavailable",
                        systemImage: "photo.badge.exclamationmark"
                    )
                }
            }
            .background(.black)
            .navigationTitle("Draw on screenshot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel, action: onCancel)
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Undo", systemImage: "arrow.uturn.backward", action: undo)
                        .disabled(markup.isEmpty)
                    Button("Clear", systemImage: "trash", role: .destructive, action: clear)
                        .disabled(markup.isEmpty)
                    Spacer()
                    Button("Use this image", systemImage: "checkmark", action: finish)
                        .accessibilityIdentifier("betaFeedbackUseAnnotatedImage")
                }
            }
            .alert("Could not render screenshot", isPresented: errorBinding) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "Try again.")
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if $0 == false { errorMessage = nil } }
        )
    }

    private func drawingGesture(size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($isDrawing) { _, isDrawing, _ in
                isDrawing = true
            }
            .onChanged { value in
                guard size.width > 0, size.height > 0 else { return }
                let point = PlatformBetaFeedbackMarkup.Point(
                    x: min(1, max(0, value.location.x / size.width)),
                    y: min(1, max(0, value.location.y / size.height))
                )
                if currentPoints.last != point {
                    currentPoints.append(point)
                }
            }
            .onEnded { _ in
                markup.append(.init(points: currentPoints))
                currentPoints.removeAll(keepingCapacity: true)
            }
    }

    private func undo() {
        markup.undo()
    }

    private func clear() {
        markup.clear()
    }

    private func finish() {
        do {
            let rendered = try PlatformBetaFeedbackMarkupRenderer.render(
                sourceJPEG: sourceJPEG,
                markup: markup
            )
            onDone(markup, rendered)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private static func aspectFit(source: CGSize, container: CGSize) -> CGSize {
        guard source.width > 0,
              source.height > 0,
              container.width > 0,
              container.height > 0 else { return .zero }
        let scale = min(container.width / source.width, container.height / source.height)
        return CGSize(width: source.width * scale, height: source.height * scale)
    }
}

private struct PlatformBetaFeedbackMarkupCanvas: View {
    let strokes: [PlatformBetaFeedbackMarkup.Stroke]
    let currentPoints: [PlatformBetaFeedbackMarkup.Point]

    var body: some View {
        Canvas { context, size in
            for points in strokes.map(\.points) + [currentPoints] where points.isEmpty == false {
                var path = Path()
                let first = points[0]
                path.move(to: CGPoint(x: first.x * size.width, y: first.y * size.height))
                for point in points.dropFirst() {
                    path.addLine(to: CGPoint(x: point.x * size.width, y: point.y * size.height))
                }
                context.stroke(
                    path,
                    with: .color(.red),
                    style: StrokeStyle(
                        lineWidth: max(4, min(size.width, size.height) * 0.012),
                        lineCap: .round,
                        lineJoin: .round
                    )
                )
            }
        }
        .allowsHitTesting(true)
    }
}
