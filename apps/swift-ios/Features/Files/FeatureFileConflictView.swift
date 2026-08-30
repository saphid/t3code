import SwiftUI

struct FeatureFileConflictView: View {
  let model: FeatureFileEditorModel
  let conflict: FeatureFileEditorModel.Conflict

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        Label(
          "This file changed after you opened it.", systemImage: "exclamationmark.triangle.fill"
        )
        .font(T3Typography.threadHeading4)
        .foregroundStyle(.orange)

        conflictText(title: "Your version", text: conflict.mine)
        conflictText(
          title: "Latest version",
          text: conflict.latest?.text ?? "The file was deleted or moved."
        )

        VStack(spacing: 10) {
          Button("Keep Mine", action: keepMine)
            .buttonStyle(.borderedProminent)
            .disabled(model.isSaving)
          Button("Reload Latest", action: model.reloadLatest)
            .buttonStyle(.bordered)
            .disabled(conflict.latest == nil || model.isSaving)
          Button("Save Copy", action: saveCopy)
            .buttonStyle(.bordered)
            .disabled(model.isSaving)
          Button("Cancel", role: .cancel, action: model.cancelConflict)
            .disabled(model.isSaving)
        }
        .frame(maxWidth: .infinity)
      }
      .padding(16)
    }
    .accessibilityElement(children: .contain)
  }

  private func conflictText(title: String, text: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(T3Typography.supportingStrong)
      Text(text)
        .font(T3Typography.code)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(T3Colors.surface)
        .clipShape(.rect(cornerRadius: 8))
    }
  }

  private func keepMine() {
    Task { await model.keepMine() }
  }

  private func saveCopy() {
    Task { await model.saveCopy() }
  }
}
