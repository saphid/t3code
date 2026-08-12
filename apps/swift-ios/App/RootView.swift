import SwiftUI

/// Owns app-wide presentation while the injected feature root owns product navigation.
struct RootView<Content: View>: View {
    @SwiftUI.Environment(T3ThemeRuntime.self) private var themeRuntime
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        let _ = themeRuntime.revision
        content
            .background(T3Colors.background.ignoresSafeArea())
            .tint(T3Colors.accent)
    }
}
