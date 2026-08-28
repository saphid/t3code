import SwiftUI

struct HomeEnvironmentFilterPopover: View {
    @SwiftUI.Environment(\.dismiss) private var dismiss

    let environments: [FeatureEnvironment]
    let labels: [String: String]
    let selectedEnvironmentID: String?
    let onSelect: (String?) -> Void

    var body: some View {
        NavigationStack {
            List {
                Button(action: selectAll) {
                    HStack {
                        Text("All environments")
                        Spacer(minLength: 8)
                        if selectedEnvironmentID == nil {
                            Image(systemName: "checkmark")
                                .accessibilityHidden(true)
                        }
                    }
                }
                .accessibilityValue(selectedEnvironmentID == nil ? "Selected" : "Not selected")
                .accessibilityIdentifier("home-environment-option-all")

                ForEach(environments) { environment in
                    let title = labels[environment.id] ?? environment.name
                    let status = HomeEnvironmentFilter.connectionStatus(for: environment)
                    Button {
                        select(environment.id)
                    } label: {
                        HomeEnvironmentFilterOptionLabel(
                            title: title,
                            status: status,
                            isSelected: selectedEnvironmentID == environment.id
                        )
                    }
                    .accessibilityLabel(title)
                    .accessibilityValue(
                        status.accessibilityValue(
                            isSelected: selectedEnvironmentID == environment.id
                        )
                    )
                    .accessibilityIdentifier("home-environment-option-\(environment.id)")
                }
            }
            .listStyle(.plain)
            .navigationTitle("Environment")
            .navigationBarTitleDisplayMode(.inline)
        }
        .frame(minWidth: 320, idealHeight: 320)
    }

    private func selectAll() {
        onSelect(nil)
        dismiss()
    }

    private func select(_ id: String) {
        onSelect(id)
        dismiss()
    }
}
