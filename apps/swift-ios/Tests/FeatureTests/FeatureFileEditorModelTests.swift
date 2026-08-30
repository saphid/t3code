import Foundation
import Testing

@testable import T3Code

@MainActor
struct FeatureFileEditorModelTests {
  @Test(
    "Clean dismissal and background invalidation never write",
    .bug("https://github.com/saphid/t3code-personal/issues/248"))
  func cleanInvalidationDoesNotWrite() {
    var calls = 0
    let model = makeModel { _, _, _, _ in
      calls += 1
      return .written(path: "notes.md", version: "v2")
    }

    model.invalidate()

    #expect(calls == 0)
    #expect(model.isDirty == false)
  }

  @Test("Explicit save writes once against the loaded version")
  func explicitSaveUsesLoadedVersion() async {
    var calls: [(String, String, FeatureFileWriteExpectation)] = []
    let model = makeModel { path, contents, expectation, _ in
      calls.append((path, contents, expectation))
      return .written(path: path, version: "v2")
    }
    model.text = "mine\n"

    await model.save()

    #expect(calls.count == 1)
    #expect(calls.first?.0 == "notes.md")
    #expect(calls.first?.1 == "mine\n")
    #expect(calls.first?.2 == .version("v1"))
    #expect(model.isDirty == false)
    #expect(model.currentContent.version == "v2")
  }

  @Test("Keep Mine rechecks the latest conflict version")
  func keepMineRechecksLatestVersion() async {
    var expectations: [FeatureFileWriteExpectation] = []
    let latest = Self.content(text: "agent\n", version: "v2")
    let model = makeModel { path, _, expectation, _ in
      expectations.append(expectation)
      return expectations.count == 1
        ? .conflict(path: path, current: latest)
        : .written(path: path, version: "v3")
    }
    model.text = "mine\n"

    await model.save()
    await model.keepMine()

    #expect(expectations == [.version("v1"), .version("v2")])
    #expect(model.conflict == nil)
    #expect(model.isDirty == false)
    #expect(model.currentContent.version == "v3")
  }

  @Test("Reload Latest and Cancel return to deterministic editor states")
  func reloadAndCancelConflict() async {
    let latest = Self.content(text: "agent\n", version: "v2")
    let model = makeModel { path, _, _, _ in .conflict(path: path, current: latest) }
    model.text = "mine\n"

    await model.save()
    model.cancelConflict()
    #expect(model.conflict == nil)
    #expect(model.text == "mine\n")
    #expect(model.isDirty)

    await model.save()
    model.reloadLatest()
    #expect(model.conflict == nil)
    #expect(model.text == "agent\n")
    #expect(model.isDirty == false)
    #expect(model.currentContent.version == "v2")
  }

  @Test("Save Copy retries an occupied name without changing the original baseline")
  func saveCopyRetriesOccupiedName() async {
    var paths: [String] = []
    let latest = Self.content(text: "agent\n", version: "v2")
    let model = makeModel(
      writer: { path, _, expectation, _ in
        paths.append(path)
        if path == "notes.md" {
          return .conflict(path: path, current: latest)
        }
        return paths.count == 2
          ? .conflict(
            path: path,
            current: Self.content(text: "occupied\n", version: "copy-v1")
          )
          : .written(path: path, version: "copy-v2")
      },
      copyPath: { _, attempt in "notes copy \(attempt).md" }
    )
    model.text = "mine\n"

    await model.save()
    await model.saveCopy()

    #expect(paths == ["notes.md", "notes copy 1.md", "notes copy 2.md"])
    #expect(model.savedCopyPath == "notes copy 2.md")
    #expect(model.conflict == nil)
    #expect(model.isDirty)
  }

  @Test("Deletion and rename conflicts preserve the local buffer for Save Copy")
  func missingConflictPreservesMine() async {
    var calls = 0
    let model = makeModel { path, _, expectation, _ in
      calls += 1
      if expectation == .missing, path != "notes.md" {
        return .written(path: path, version: "copy")
      }
      return .conflict(path: path, current: nil)
    }
    model.text = "mine\n"

    await model.save()
    model.reloadLatest()
    #expect(model.text == "mine\n")
    #expect(model.errorMessage?.contains("deleted or moved") == true)

    await model.saveCopy()
    #expect(calls == 2)
    #expect(model.savedCopyPath == "notes conflict copy.md")
    #expect(model.text == "mine\n")
  }

  @Test("Reconnect failures stay dirty and can be retried")
  func reconnectFailureCanRetry() async {
    var calls = 0
    let model = makeModel { path, _, _, _ in
      calls += 1
      if calls == 1 { throw RPCError.disconnected }
      return .written(path: path, version: "v2")
    }
    model.text = "mine\n"

    await model.save()
    #expect(model.isDirty)
    #expect(model.errorMessage != nil)

    await model.save()
    #expect(calls == 2)
    #expect(model.isDirty == false)
  }

  @Test("A stale response for another file never updates this editor")
  func staleResponseForAnotherFileIsIgnored() async {
    let model = makeModel { _, _, _, _ in
      .written(path: "other-environment/notes.md", version: "wrong")
    }
    model.text = "mine\n"

    await model.save()

    #expect(model.isDirty)
    #expect(model.currentContent.version == "v1")
    #expect(model.errorMessage?.contains("another file") == true)
  }

  @Test("Conflict inspection includes edits made while the save was pending")
  func conflictIncludesPendingEdits() async {
    let gate = FeatureFileEditorTestGate()
    let latest = Self.content(text: "agent\n", version: "v2")
    let model = makeModel { path, _, _, _ in
      await gate.wait()
      return .conflict(path: path, current: latest)
    }
    model.text = "submitted\n"
    let save = Task { await model.save() }
    await gate.waitUntilWaiting()

    model.text = "edited while saving\n"
    await gate.open()
    await save.value

    #expect(model.conflict?.mine == "edited while saving\n")
    #expect(model.text == "edited while saving\n")
  }

  @Test("A late save result is ignored after the editor is dismissed")
  func lateResultAfterInvalidationIsIgnored() async {
    let gate = FeatureFileEditorTestGate()
    let model = makeModel { path, _, _, _ in
      await gate.wait()
      return .written(path: path, version: "late")
    }
    model.text = "mine\n"
    let save = Task { await model.save() }
    await gate.waitUntilWaiting()

    model.invalidate()
    await gate.open()
    await save.value

    #expect(model.isDirty)
    #expect(model.currentContent.version == "v1")
    #expect(model.isSaving == false)
  }

  @Test("Conflict copy paths preserve remote separator and extension rules")
  func conflictCopyPaths() {
    #expect(
      FeatureFileEditorModel.defaultCopyPath(originalPath: "docs/notes.md", attempt: 1)
        == "docs/notes conflict copy.md"
    )
    #expect(
      FeatureFileEditorModel.defaultCopyPath(
        originalPath: #"Sources\My File.swift"#,
        attempt: 2
      ) == #"Sources\My File conflict copy 2.swift"#
    )
    #expect(
      FeatureFileEditorModel.defaultCopyPath(originalPath: "LICENSE", attempt: 1)
        == "LICENSE conflict copy"
    )
    #expect(
      FeatureFileEditorModel.defaultCopyPath(originalPath: ".env", attempt: 1)
        == ".env conflict copy"
    )
  }

  private func makeModel(
    writer: @escaping FeatureFileEditorModel.Writer,
    copyPath: @escaping FeatureFileEditorModel.CopyPath = FeatureFileEditorModel.defaultCopyPath
  ) -> FeatureFileEditorModel {
    FeatureFileEditorModel(content: Self.content(), writer: writer, copyPath: copyPath)
  }

  private static func content(
    text: String = "loaded\n",
    version: String = "v1"
  ) -> FeatureFileContent {
    FeatureFileContent(
      path: "notes.md",
      text: text,
      language: "markdown",
      isTruncated: false,
      totalBytes: text.utf8.count,
      version: version,
      encoding: .utf8,
      lineEnding: .lineFeed,
      mode: 0o644
    )
  }
}
