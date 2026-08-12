struct FeatureLatestRequest: Equatable {
    private(set) var revision = 0

    mutating func begin() -> Int {
        revision &+= 1
        return revision
    }

    func isCurrent(_ candidate: Int) -> Bool {
        candidate == revision
    }
}
