struct FeatureThreadControlState: Equatable {
    enum Command: Hashable {
        case send
        case stop
    }

    struct Token: Equatable {
        fileprivate let command: Command
        fileprivate let generation: UInt64
        fileprivate let identifier: UInt64
    }

    private var generation: UInt64 = 0
    private var nextIdentifier: UInt64 = 0
    private var inFlight: [Command: Token] = [:]

    mutating func begin(_ command: Command) -> Token? {
        guard inFlight[command] == nil else { return nil }
        nextIdentifier &+= 1
        let token = Token(
            command: command,
            generation: generation,
            identifier: nextIdentifier
        )
        inFlight[command] = token
        return token
    }

    @discardableResult
    mutating func finish(_ token: Token?) -> Bool {
        guard let token,
              token.generation == generation,
              inFlight[token.command] == token else {
            return false
        }
        inFlight[token.command] = nil
        return true
    }

    func isInFlight(_ command: Command) -> Bool {
        inFlight[command] != nil
    }

    mutating func reset() {
        generation &+= 1
        inFlight.removeAll(keepingCapacity: true)
    }
}
