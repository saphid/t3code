import Foundation

struct TerminalHardwareModifiers: OptionSet, Sendable {
    let rawValue: UInt8

    static let control = Self(rawValue: 1 << 0)
    static let shift = Self(rawValue: 1 << 1)
    static let alternate = Self(rawValue: 1 << 2)
    static let command = Self(rawValue: 1 << 3)
}

enum TerminalHardwareKey: Equatable, Sendable {
    case text(String)
    case escape
    case up
    case down
    case left
    case right
    case insert
}

enum TerminalHardwareKeyAction: Equatable, Sendable {
    case input(String)
    case copySelection
    case pasteClipboard
}

enum TerminalHardwareKeyEncoder {
    static let insertHIDUsage = 0x49

    static func action(
        hidUsage: Int,
        modifiers: TerminalHardwareModifiers
    ) -> TerminalHardwareKeyAction? {
        guard hidUsage == insertHIDUsage else { return nil }
        return action(key: .insert, modifiers: modifiers)
    }

    static func action(
        key: TerminalHardwareKey,
        modifiers: TerminalHardwareModifiers
    ) -> TerminalHardwareKeyAction? {
        if key == .insert {
            if modifiers == .control { return .copySelection }
            if modifiers == .shift { return .pasteClipboard }
            return nil
        }

        if modifiers == .command, case let .text(input) = key {
            switch input.lowercased() {
            case "c": return .copySelection
            case "v": return .pasteClipboard
            default: return nil
            }
        }

        switch key {
        case .escape: return .input("\u{1B}")
        case .up: return .input("\u{1B}[A")
        case .down: return .input("\u{1B}[B")
        case .right: return .input("\u{1B}[C")
        case .left: return .input("\u{1B}[D")
        case .text("\t"):
            return .input(modifiers.contains(.shift) ? "\u{1B}[Z" : "\t")
        case let .text(input):
            guard modifiers.contains(.control),
                  let scalar = input.lowercased().unicodeScalars.first,
                  let sequence = controlSequence(for: scalar) else {
                return nil
            }
            return .input(sequence)
        case .insert:
            return nil
        }
    }

    static func applyingControl(to input: String) -> String {
        guard let scalar = input.lowercased().unicodeScalars.first else { return input }
        return controlSequence(for: scalar) ?? input
    }

    private static func controlSequence(for scalar: Unicode.Scalar) -> String? {
        switch scalar {
        case "a"..."z": return UnicodeScalar(scalar.value - 96).map(String.init)
        case " ", "@": return "\u{00}"
        case "[": return "\u{1B}"
        case "\\": return "\u{1C}"
        case "]": return "\u{1D}"
        case "^": return "\u{1E}"
        case "_", "-": return "\u{1F}"
        case "?": return "\u{7F}"
        default: return nil
        }
    }
}

struct TerminalClipboardRouter {
    let readSelection: () -> String?
    let readClipboard: () -> String?
    let writeClipboard: (String) -> Void
    let sendInput: (String) -> Void

    func perform(_ action: TerminalHardwareKeyAction) {
        switch action {
        case .copySelection:
            guard let selection = readSelection(), !selection.isEmpty else { return }
            writeClipboard(selection)
        case .pasteClipboard:
            guard let clipboard = readClipboard(), !clipboard.isEmpty else { return }
            sendInput(clipboard)
        case .input:
            return
        }
    }
}
