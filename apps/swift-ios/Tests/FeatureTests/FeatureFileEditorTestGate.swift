actor FeatureFileEditorTestGate {
  private var isWaiting = false
  private var arrival: CheckedContinuation<Void, Never>?
  private var release: CheckedContinuation<Void, Never>?

  func wait() async {
    isWaiting = true
    arrival?.resume()
    arrival = nil
    await withCheckedContinuation { release = $0 }
  }

  func waitUntilWaiting() async {
    guard isWaiting == false else { return }
    await withCheckedContinuation { arrival = $0 }
  }

  func open() {
    release?.resume()
    release = nil
  }
}
