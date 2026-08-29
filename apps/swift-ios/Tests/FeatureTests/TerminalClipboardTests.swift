import Testing
@testable import T3Code

@Suite("Terminal hardware key encoder")
struct TerminalHardwareKeyEncoderTests {
    @Test(
        "Control-Insert and Shift-Insert map to clipboard actions",
        .bug("https://github.com/saphid/t3code-personal/issues/206")
    )
    func recognizesInsertClipboardShortcuts() {
        #expect(
            TerminalHardwareKeyEncoder.action(
                hidUsage: TerminalHardwareKeyEncoder.insertHIDUsage,
                modifiers: .control
            )
                == .copySelection
        )
        #expect(
            TerminalHardwareKeyEncoder.action(
                hidUsage: TerminalHardwareKeyEncoder.insertHIDUsage,
                modifiers: .shift
            )
                == .pasteClipboard
        )
        #expect(TerminalHardwareKeyEncoder.action(hidUsage: 0x4A, modifiers: .control) == nil)
    }

    @Test(arguments: [
        TerminalHardwareModifiers(),
        [.control, .shift],
        .command,
        [.control, .alternate],
        [.shift, .command],
    ])
    func rejectsInsertWithMissingOrExtraModifiers(_ modifiers: TerminalHardwareModifiers) {
        #expect(
            TerminalHardwareKeyEncoder.action(
                hidUsage: TerminalHardwareKeyEncoder.insertHIDUsage,
                modifiers: modifiers
            ) == nil
        )
    }

    @Test
    func preservesCommandClipboardAndOrdinaryControlInput() {
        #expect(
            TerminalHardwareKeyEncoder.action(key: .text("c"), modifiers: .command)
                == .copySelection
        )
        #expect(
            TerminalHardwareKeyEncoder.action(key: .text("V"), modifiers: .command)
                == .pasteClipboard
        )
        #expect(
            TerminalHardwareKeyEncoder.action(key: .text("c"), modifiers: .control)
                == .input("\u{03}")
        )
        #expect(
            TerminalHardwareKeyEncoder.action(key: .text("["), modifiers: [.control, .shift])
                == .input("\u{1B}")
        )
    }
}

@Suite("Terminal clipboard routing")
struct TerminalClipboardRouterTests {
    @Test(
        "Copy writes only the current selection without PTY input",
        .bug("https://github.com/saphid/t3code-personal/issues/206")
    )
    func copyWritesOnlyTheCurrentSelectionWithoutPTYInput() {
        let recorder = Recorder()
        let router = TerminalClipboardRouter(
            readSelection: { "selected \u{1F642}\nline" },
            readClipboard: { "old clipboard" },
            writeClipboard: { recorder.clipboardWrites.append($0) },
            sendInput: { recorder.ptyWrites.append($0) }
        )

        router.perform(.copySelection)

        #expect(recorder.clipboardWrites == ["selected \u{1F642}\nline"])
        #expect(recorder.ptyWrites.isEmpty)
    }

    @Test
    func copyWithoutASelectionIsATruthfulNoOp() {
        let recorder = Recorder()
        let router = TerminalClipboardRouter(
            readSelection: { nil },
            readClipboard: { "existing clipboard" },
            writeClipboard: { recorder.clipboardWrites.append($0) },
            sendInput: { recorder.ptyWrites.append($0) }
        )

        router.perform(.copySelection)

        #expect(recorder.clipboardWrites.isEmpty)
        #expect(recorder.ptyWrites.isEmpty)
    }

    @Test(
        "Paste uses the safe input path exactly once",
        .bug("https://github.com/saphid/t3code-personal/issues/206")
    )
    func pasteUsesTheSafeInputPathExactlyOnce() {
        let recorder = Recorder()
        let value = String(repeating: "large \u{1F680}\n", count: 4_096)
        let router = TerminalClipboardRouter(
            readSelection: { nil },
            readClipboard: { value },
            writeClipboard: { recorder.clipboardWrites.append($0) },
            sendInput: { recorder.ptyWrites.append($0) }
        )

        router.perform(.pasteClipboard)

        #expect(recorder.ptyWrites == [value])
        #expect(recorder.clipboardWrites.isEmpty)
    }

    @Test
    func emptyPasteDoesNotReachThePTY() {
        let recorder = Recorder()
        let router = TerminalClipboardRouter(
            readSelection: { nil },
            readClipboard: { "" },
            writeClipboard: { recorder.clipboardWrites.append($0) },
            sendInput: { recorder.ptyWrites.append($0) }
        )

        router.perform(.pasteClipboard)

        #expect(recorder.clipboardWrites.isEmpty)
        #expect(recorder.ptyWrites.isEmpty)
    }

    @Test
    func rapidPasteCommandsEachRouteOnce() {
        let recorder = Recorder()
        let router = TerminalClipboardRouter(
            readSelection: { nil },
            readClipboard: { "paste" },
            writeClipboard: { recorder.clipboardWrites.append($0) },
            sendInput: { recorder.ptyWrites.append($0) }
        )

        router.perform(.pasteClipboard)
        router.perform(.pasteClipboard)

        #expect(recorder.ptyWrites == ["paste", "paste"])
        #expect(recorder.clipboardWrites.isEmpty)
    }
}

private final class Recorder {
    var clipboardWrites = [String]()
    var ptyWrites = [String]()
}
