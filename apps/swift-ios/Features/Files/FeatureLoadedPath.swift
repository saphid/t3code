struct FeatureLoadedPath: Equatable {
    private(set) var path: String?
    private var isInitialized = false

    mutating func begin(_ path: String?) -> Bool {
        let changed = !isInitialized || self.path != path
        self.path = path
        isInitialized = true
        return changed
    }
}
