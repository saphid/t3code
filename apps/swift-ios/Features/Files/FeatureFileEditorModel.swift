import Foundation
import Observation

@MainActor
@Observable
final class FeatureFileEditorModel {
  struct Conflict: Identifiable, Equatable {
    let mine: String
    let latest: FeatureFileContent?

    var id: String { latest?.version ?? "missing" }
  }

  typealias Writer =
    @MainActor (
      _ path: String,
      _ contents: String,
      _ expectation: FeatureFileWriteExpectation,
      _ metadata: FeatureFileContent
    ) async throws -> FeatureFileWriteResult

  typealias CopyPath = @MainActor (_ originalPath: String, _ attempt: Int) -> String

  let path: String
  var displayName: String {
    path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
  }
  var text: String
  private(set) var conflict: Conflict?
  private(set) var errorMessage: String?
  private(set) var isSaving = false
  private(set) var savedCopyPath: String?

  private var baselineText: String
  private var metadata: FeatureFileContent
  private let writer: Writer
  private let copyPath: CopyPath
  private var lifecycleGeneration = 0
  private var operationGeneration = 0

  var isDirty: Bool { text != baselineText }
  var isTruncated: Bool { metadata.isTruncated }
  var canSave: Bool {
    isDirty && metadata.version != nil && metadata.isTruncated == false && !isSaving
  }
  var currentContent: FeatureFileContent {
    var content = metadata
    content.text = text
    return content
  }

  init(
    content: FeatureFileContent,
    writer: @escaping Writer,
    copyPath: @escaping CopyPath = FeatureFileEditorModel.defaultCopyPath
  ) {
    path = content.path
    text = content.text
    baselineText = content.text
    metadata = content
    self.writer = writer
    self.copyPath = copyPath
  }

  func save() async {
    guard let version = metadata.version, canSave else { return }
    await write(path: path, expectation: .version(version), updatesOriginal: true)
  }

  func keepMine() async {
    guard let conflict else { return }
    let expectation = conflict.latest?.version.map(FeatureFileWriteExpectation.version) ?? .missing
    if let latest = conflict.latest {
      metadata = latest
    }
    await write(path: path, expectation: expectation, updatesOriginal: true)
  }

  func reloadLatest() {
    guard let latest = conflict?.latest else {
      errorMessage = "The file was deleted or moved. Save your buffer as a copy or cancel."
      return
    }
    operationGeneration &+= 1
    text = latest.text
    baselineText = latest.text
    metadata = latest
    conflict = nil
    errorMessage = nil
    savedCopyPath = nil
  }

  func saveCopy() async {
    guard conflict != nil, !isSaving else { return }
    for attempt in 1...100 {
      let candidate = copyPath(path, attempt)
      guard
        let result = await write(
          path: candidate,
          expectation: .missing,
          updatesOriginal: false,
          clearsConflict: false
        )
      else { return }
      switch result {
      case .written:
        savedCopyPath = candidate
        conflict = nil
        errorMessage = nil
        return
      case .conflict:
        continue
      }
    }
    errorMessage = "Couldn't find an available name for the conflict copy."
  }

  func cancelConflict() {
    operationGeneration &+= 1
    conflict = nil
    errorMessage = nil
  }

  func invalidate() {
    lifecycleGeneration &+= 1
    operationGeneration &+= 1
    isSaving = false
  }

  @discardableResult
  private func write(
    path targetPath: String,
    expectation: FeatureFileWriteExpectation,
    updatesOriginal: Bool,
    clearsConflict: Bool = true
  ) async -> FeatureFileWriteResult? {
    guard !isSaving else { return nil }
    let submittedText = text
    let submittedMetadata = metadata
    let lifecycle = lifecycleGeneration
    operationGeneration &+= 1
    let operation = operationGeneration
    isSaving = true
    errorMessage = nil

    do {
      let result = try await writer(
        targetPath,
        submittedText,
        expectation,
        submittedMetadata
      )
      guard lifecycle == lifecycleGeneration, operation == operationGeneration else {
        return nil
      }
      isSaving = false
      switch result {
      case .written(let resultPath, let version):
        guard resultPath == targetPath else {
          errorMessage = "The save response referred to another file."
          return nil
        }
        if updatesOriginal {
          baselineText = submittedText
          metadata.text = submittedText
          metadata.version = version
          if clearsConflict { conflict = nil }
          savedCopyPath = nil
        }
      case .conflict(let resultPath, let current):
        guard resultPath == targetPath else {
          errorMessage = "The save response referred to another file."
          return nil
        }
        if updatesOriginal {
          conflict = Conflict(mine: text, latest: current)
        }
      }
      return result
    } catch is CancellationError {
      guard lifecycle == lifecycleGeneration, operation == operationGeneration else {
        return nil
      }
      isSaving = false
      return nil
    } catch {
      guard lifecycle == lifecycleGeneration, operation == operationGeneration else {
        return nil
      }
      isSaving = false
      errorMessage = error.localizedDescription
      return nil
    }
  }

  static func defaultCopyPath(originalPath: String, attempt: Int) -> String {
    let separator = originalPath.lastIndex { $0 == "/" || $0 == "\\" }
    let directory = separator.map { String(originalPath[...$0]) } ?? ""
    let fileName =
      separator.map { String(originalPath[originalPath.index(after: $0)...]) }
      ?? originalPath
    let extensionSeparator = fileName.lastIndex(of: ".").flatMap { index in
      index == fileName.startIndex ? nil : index
    }
    let stem = extensionSeparator.map { String(fileName[..<$0]) } ?? fileName
    let fileExtension =
      extensionSeparator.map {
        String(fileName[fileName.index(after: $0)...])
      } ?? ""
    let suffix = attempt == 1 ? "" : " \(attempt)"
    let copyName =
      fileExtension.isEmpty
      ? "\(stem) conflict copy\(suffix)"
      : "\(stem) conflict copy\(suffix).\(fileExtension)"
    return directory + copyName
  }
}
