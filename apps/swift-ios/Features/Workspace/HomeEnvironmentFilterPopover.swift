import SwiftUI

struct HomeEnvironmentFilterPopover: View {
    let environments: [FeatureEnvironment]
    let labels: [String: String]
    let disabledEnvironmentIDs: Set<String>
    let onIncludeAll: () -> Void
    let onToggle: (String, Bool) -> Void

    private var includedCount: Int {
        environments.count - disabledEnvironmentIDs.count
    }

    var body: some View {
        NavigationStack {
            List {
                Button(action: onIncludeAll) {
                    HStack {
                        Text("All environments")
                        Spacer(minLength: 8)
                        if disabledEnvironmentIDs.isEmpty {
                            Image(systemName: "checkmark")
                                .accessibilityHidden(true)
                        }
                    }
                }
                .disabled(disabledEnvironmentIDs.isEmpty)
                .accessibilityValue(
                    disabledEnvironmentIDs.isEmpty ? "All included" : "Include all"
                )
                .accessibilityIdentifier("home-environment-option-all")

                ForEach(environments) { environment in
                    let title = labels[environment.id] ?? environment.name
                    let status = HomeEnvironmentFilter.connectionStatus(for: environment)
                    let isIncluded = !disabledEnvironmentIDs.contains(environment.id)
                    Button {
                        onToggle(environment.id, !isIncluded)
                    } label: {
                        HomeEnvironmentFilterOptionLabel(
                            title: title,
                            status: status,
                            isSelected: isIncluded
                        )
                    }
                    .disabled(isIncluded && includedCount == 1)
                    .accessibilityLabel(title)
                    .accessibilityValue(
                        status.accessibilityValue(isSelected: isIncluded)
                    )
                    .accessibilityHint(
                        isIncluded && includedCount == 1
                            ? "At least one environment must remain included"
                            : isIncluded ? "Double tap to exclude" : "Double tap to include"
                    )
                    .accessibilityIdentifier("home-environment-option-\(environment.id)")
                }
            }
            .listStyle(.plain)
            .navigationTitle("Environments")
            .navigationBarTitleDisplayMode(.inline)
        }
        .frame(minWidth: 320, idealHeight: 320)
    }
}
