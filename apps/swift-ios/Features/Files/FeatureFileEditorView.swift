import SwiftUI

struct FeatureFileEditorView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var model: FeatureFileEditorModel
  @State private var confirmsDiscard = false

  private let onSaved: (FeatureFileContent) -> Void

  init(
    client: any FeatureClient,
    threadID: String,
    content: FeatureFileContent,
    onSaved: @escaping (FeatureFileContent) -> Void
  ) {
    _model = State(
      initialValue: FeatureFileEditorModel(content: content) {
        path,
        contents,
        expectation,
        metadata in
        try await client.writeFile(
          threadID: threadID,
          path: path,
          contents: contents,
          expectation: expectation,
          metadata: metadata
        )
      }
    )
    self.onSaved = onSaved
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if let errorMessage = model.errorMessage {
          Label(errorMessage, systemImage: "exclamationmark.triangle")
            .font(T3Typography.supporting)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Color.red.opacity(0.08))
        } else if model.isTruncated {
          Label(
            "The latest file is too large to save from this preview.",
            systemImage: "doc.badge.ellipsis"
          )
          .font(T3Typography.supporting)
          .foregroundStyle(.orange)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 14)
          .padding(.vertical, 9)
        } else if let savedCopyPath = model.savedCopyPath {
          Label("Saved a copy at \(savedCopyPath)", systemImage: "doc.on.doc")
            .font(T3Typography.supporting)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
        }

        if let conflict = model.conflict {
          FeatureFileConflictView(model: model, conflict: conflict)
        } else {
          TextEditor(text: $model.text)
            .font(T3Typography.code)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .padding(.horizontal, 10)
            .scrollContentBackground(.hidden)
            .background(T3Colors.background)
            .accessibilityLabel("File contents")
        }
      }
      .background(T3Colors.background)
      .navigationTitle(model.displayName)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close", action: close)
            .disabled(model.isSaving)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save", action: save)
            .disabled(model.canSave == false)
        }
      }
      .confirmationDialog(
        "Discard unsaved changes?",
        isPresented: $confirmsDiscard,
        titleVisibility: .visible
      ) {
        Button("Discard Changes", role: .destructive, action: discardAndClose)
        Button("Keep Editing", role: .cancel) {}
      } message: {
        Text("Closing never writes this buffer. Save it explicitly if you want to keep it.")
      }
    }
    .interactiveDismissDisabled(model.isDirty || model.isSaving)
    .onDisappear(perform: model.invalidate)
  }

  private func save() {
    Task {
      await model.save()
      if model.conflict == nil, model.isDirty == false, model.errorMessage == nil {
        onSaved(model.currentContent)
      }
    }
  }

  private func close() {
    if model.isDirty {
      confirmsDiscard = true
    } else {
      model.invalidate()
      dismiss()
    }
  }

  private func discardAndClose() {
    model.invalidate()
    dismiss()
  }
}
