import SwiftUI

public struct ProjectGroupingSettingsView: View {
    @Bindable private var model: FeatureRootModel
    @State private var selectedEnvironmentID: String
    @State private var isSaving = false
    @State private var saveErrorMessage: String?

    public init(model: FeatureRootModel) {
        self.model = model
        let environments = ProjectGroupingSettingsPresentation.environments(in: model.snapshot)
        _selectedEnvironmentID = State(
            initialValue: environments.first(where: \.isActive)?.id
                ?? environments.first?.id
                ?? ""
        )
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if environments.count > 1 {
                    environmentSection
                }
                defaultGroupingSection
                projectOverridesSection
            }
            .padding(.vertical, 24)
        }
        .background(T3Colors.background)
        .navigationTitle("Project grouping")
        .navigationBarTitleDisplayMode(.inline)
        .t3NavigationChrome()
        .alert(
            "Couldn’t save project grouping",
            isPresented: Binding(
                get: { saveErrorMessage != nil },
                set: { if !$0 { saveErrorMessage = nil } }
            )
        ) {
        } message: {
            Text(saveErrorMessage ?? "Something went wrong.")
        }
        .onChange(of: environments.map(\.id)) { _, environmentIDs in
            guard !environmentIDs.contains(selectedEnvironmentID) else { return }
            selectedEnvironmentID = environmentIDs.first ?? ""
        }
    }

    private var environments: [FeatureEnvironment] {
        ProjectGroupingSettingsPresentation.environments(in: model.snapshot)
    }

    private var projects: [FeatureProject] {
        ProjectGroupingSettingsPresentation.projects(
            in: model.snapshot,
            environmentID: selectedEnvironmentID
        )
    }

    private var preferences: FeatureEnvironmentPreferences {
        ProjectGroupingSettingsPresentation.preferences(
            in: model.snapshot,
            environmentID: selectedEnvironmentID
        )
    }

    private var environmentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Environment")
            HStack(spacing: 12) {
                Image(systemName: "server.rack")
                    .foregroundStyle(T3Colors.textSecondary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                Text("Computer")
                    .font(T3Typography.threadBody)
                    .foregroundStyle(T3Colors.textPrimary)
                Spacer(minLength: 12)
                Picker("Computer", selection: $selectedEnvironmentID) {
                    ForEach(environments) { environment in
                        Text(environment.name).tag(environment.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .disabled(isSaving)
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 56)
        }
    }

    private var defaultGroupingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Default grouping")
            VStack(spacing: 0) {
                groupingChoice(
                    mode: .repository,
                    description: "Matching repositories appear as one project."
                )
                settingsDivider
                groupingChoice(
                    mode: .repositoryPath,
                    description: "Keep different paths in the same repository apart."
                )
                settingsDivider
                groupingChoice(
                    mode: .separate,
                    description: "Show every workspace as its own project."
                )
            }
        }
    }

    private var projectOverridesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Project overrides")
            if projects.isEmpty {
                ContentUnavailableView(
                    "No projects",
                    systemImage: "folder",
                    description: Text("Projects from this environment will appear here.")
                )
                .padding(.horizontal, 20)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(projects) { project in
                        projectOverrideRow(project)
                        if project.id != projects.last?.id {
                            settingsDivider
                        }
                    }
                }
            }
            Text("Choose Use default to clear an override and follow the default grouping again.")
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textTertiary)
                .padding(.horizontal, 20)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(T3Typography.navigationTitle)
            .foregroundStyle(T3Colors.textPrimary)
            .padding(.horizontal, 20)
            .accessibilityAddTraits(.isHeader)
    }

    private func groupingChoice(
        mode: FeatureEnvironmentPreferences.ProjectGroupingMode,
        description: String
    ) -> some View {
        Button {
            save(mode: mode, overrides: preferences.projectGroupingOverrides)
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ProjectGroupingSettingsPresentation.modeLabel(mode))
                        .font(T3Typography.threadBody)
                        .foregroundStyle(T3Colors.textPrimary)
                    Text(description)
                        .font(T3Typography.supporting)
                        .foregroundStyle(T3Colors.textSecondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 12)
                Image(systemName: "checkmark")
                    .font(T3Typography.supportingStrong)
                    .foregroundStyle(T3Colors.accent)
                    .opacity(preferences.projectGroupingMode == mode ? 1 : 0)
                    .frame(width: 22)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isSaving || selectedEnvironmentID.isEmpty)
        .accessibilityAddTraits(
            preferences.projectGroupingMode == mode ? .isSelected : []
        )
    }

    private func projectOverrideRow(_ project: FeatureProject) -> some View {
        let key = DailyUXProjectGrouping.overrideKey(for: project)
        let override = preferences.projectGroupingOverrides[key]
        let value = override.map(ProjectGroupingSettingsPresentation.modeLabel)
            ?? "Use default"
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(project.name)
                    .font(T3Typography.threadBody)
                    .foregroundStyle(T3Colors.textPrimary)
                Text(project.path)
                    .font(T3Typography.supporting)
                    .foregroundStyle(T3Colors.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Menu {
                Button("Use default") { saveOverride(nil, for: project) }
                Divider()
                Button("Group by repository") { saveOverride(.repository, for: project) }
                Button("Group by repository path") { saveOverride(.repositoryPath, for: project) }
                Button("Keep separate") { saveOverride(.separate, for: project) }
            } label: {
                HStack(spacing: 6) {
                    Text(value)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .accessibilityHidden(true)
                }
                .font(T3Typography.supporting)
                .foregroundStyle(T3Colors.textSecondary)
            }
            .disabled(isSaving)
            .accessibilityLabel("Grouping rule for \(project.name)")
            .accessibilityValue(value)
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 64)
    }

    private var settingsDivider: some View {
        Divider()
            .overlay { T3Colors.separator }
            .padding(.leading, 20)
            .padding(.trailing, 20)
    }

    private func saveOverride(
        _ mode: FeatureEnvironmentPreferences.ProjectGroupingMode?,
        for project: FeatureProject
    ) {
        var overrides = preferences.projectGroupingOverrides
        let key = DailyUXProjectGrouping.overrideKey(for: project)
        if let mode {
            overrides[key] = mode
        } else {
            overrides[key] = nil
        }
        save(mode: preferences.projectGroupingMode, overrides: overrides)
    }

    private func save(
        mode: FeatureEnvironmentPreferences.ProjectGroupingMode,
        overrides: [String: FeatureEnvironmentPreferences.ProjectGroupingMode]
    ) {
        guard !isSaving, !selectedEnvironmentID.isEmpty else { return }
        let environmentID = selectedEnvironmentID
        isSaving = true
        Task {
            let didSave = await model.saveProjectGroupingPreferences(
                environmentID: environmentID,
                mode: mode,
                overrides: overrides
            )
            isSaving = false
            if !didSave {
                saveErrorMessage = model.errorMessage
                    ?? "Project grouping could not be saved."
            }
        }
    }
}
