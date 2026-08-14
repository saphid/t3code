import XCTest

@MainActor
final class AppFlowUITests: XCTestCase {
    private static var testedApplicationIsRegistered = false
    private var app: XCUIApplication!
    private var permissionPolicy = PermissionPolicy.denyAll

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "System permission") { alert in
            MainActor.assumeIsolated {
                let containsLocalNetworkText = alert.label
                    .localizedCaseInsensitiveContains("local network")
                    || alert.staticTexts.allElementsBoundByIndex
                    .contains { $0.label.localizedCaseInsensitiveContains("local network") }
                if self.permissionPolicy == .allowLocalNetwork,
                   containsLocalNetworkText
                {
                    let allow = alert.buttons["Allow"]
                    if allow.exists {
                        allow.tap()
                        return true
                    }
                }
                let deny = alert.buttons["Don’t Allow"]
                if deny.exists {
                    deny.tap()
                    return true
                }
                return false
            }
        }
    }

    func testDirectConnectionOnboardingHappyPath() {
        launch(scenario: "onboarding")
        completeManualConnection(
            server: "http://127.0.0.1:3773",
            pairingCode: "fixture-code"
        )
        assertIdentifier("thread-fixture-main")
        capture("onboarding-connected-home")
    }

    func testLiveBackendPairingAndProjectDiscovery() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["T3_APP_FLOW_LIVE_ENABLED"] == "1" else {
            throw XCTSkip("Set T3_APP_FLOW_LIVE_CREDENTIALS_FILE for the opt-in live smoke journey")
        }

        launchLive()
        assertExists("Server address")
        assertExists("Pairing code")
        let projectFilter = submitConnectionAndReachHome()
        let project = openProjectFilter(
            projectFilter,
            expectedProject: "App Flow Regression Fixture",
            timeout: 12
        )
        capture("live-project-discovery")
        project.tap()

        assertIdentifier("sidebar-new-task-button").tap()
        let initialMessage = "App-flow disposable live task"
        replaceText(in: assertIdentifier("message-composer"), with: initialMessage)
        assertIdentifier("message-send").tap()
        assertSingleMessageText(initialMessage)

        let followUp = "App-flow disposable live follow-up"
        if !app.descendants(matching: .any)["message-composer"].firstMatch.exists {
            assertHittableButton("Message agent").tap()
        }
        replaceText(in: assertIdentifier("message-composer"), with: followUp)
        assertIdentifier("message-send").tap()
        assertSingleMessageText(followUp)
        capture("live-task-follow-up")
    }

    func testCredentialIngressDoesNotEnterEvidence() throws {
        guard ProcessInfo.processInfo.environment["T3_APP_FLOW_LIVE_ENABLED"] == "1" else {
            throw XCTSkip("Set T3_APP_FLOW_LIVE_CREDENTIALS_FILE for the credential-ingress audit")
        }

        launch(scenario: "onboarding", usesStagedCredentials: true)
        assertExists("Server address")
        assertExists("Pairing code")
        _ = submitConnectionAndReachHome()
        assertIdentifier("thread-fixture-main")
        capture("credential-ingress-connected-home")
    }

    @discardableResult
    private func completeManualConnection(
        server: String,
        pairingCode: String
    ) -> XCUIElement {
        assertExists("Enter details manually").tap()
        let serverAddress = assertExists("Server address")
        let pairingCodeField = assertExists("Pairing code")
        serverAddress.tap()
        serverAddress.typeText(server)
        pairingCodeField.tap()
        pairingCodeField.typeText(pairingCode)
        return submitConnectionAndReachHome()
    }

    private func submitConnectionAndReachHome() -> XCUIElement {
        assertHittableButton("Connect").tap()

        return assertIdentifier("sidebar-project-filter", timeout: 20)
    }

    @discardableResult
    private func openProjectFilter(
        _ projectFilter: XCUIElement,
        expectedProject: String,
        timeout: TimeInterval
    ) -> XCUIElement {
        let project = app.descendants(matching: .any)[expectedProject].firstMatch
        projectFilter.tap()
        if !project.waitForExistence(timeout: 1) {
            // A first post-connection tap may be consumed while XCTest handles
            // the notification permission alert. Retry the intended action,
            // then apply the real semantic timeout.
            projectFilter.tap()
        }
        XCTAssertTrue(
            project.waitForExistence(timeout: timeout),
            "Missing project after opening the project filter: \(expectedProject)"
        )
        return project
    }

    func testWorkspaceNavigationAndMenus() {
        launch()

        let primaryThread = assertIdentifier("thread-fixture-main")
        capture("workspace-home")

        assertIdentifier("sidebar-search-button").tap()
        let search = assertIdentifier("sidebar-search-field")
        search.typeText("regression")
        XCTAssertTrue(primaryThread.exists)
        capture("workspace-search")
        assertIdentifier("sidebar-search-button").tap()

        assertIdentifier("sidebar-project-filter").tap()
        assertExists("All projects")
        assertExists("T3 Code").tap()

        assertIdentifier("sidebar-settings-button").tap()
        assertExists("Settings")
        assertExists("Connections")
        assertExists("Usage")
        let themeCatalog = assertIdentifier("settings-themes")
        themeCatalog.tap()
        let themesNavigationBar = app.navigationBars["Themes"]
        XCTAssertTrue(themesNavigationBar.waitForExistence(timeout: 8))
        assertExists("Appearance")
        assertExists("System")
        assertExists("Light")
        assertExists("Dark")
        let darkThemeCard = app.descendants(matching: .any)["T3 Code, dark"].firstMatch
        for _ in 0 ..< 3 where !darkThemeCard.exists {
            app.swipeUp()
        }
        XCTAssertTrue(darkThemeCard.waitForExistence(timeout: 8))
        capture("settings-theme-catalog")
        let backButton = themesNavigationBar.buttons.firstMatch
        XCTAssertTrue(backButton.waitForExistence(timeout: 8))
        backButton.tap()

        assertHittableButton(labelStartsWith: "Connections,").tap()
        assertIdentifier("connections-add-button")
        capture("settings-connections")
    }

    func testNewTaskComposerMenus() {
        exerciseNewTaskComposerMenus()
    }

    func testSettingsSecondarySurfaces() {
        launch()
        assertIdentifier("sidebar-settings-button").tap()
        assertExists("Haptics")
        assertExists("Notifications")
        assertExists("Live Activities")

        assertHittableButton(labelStartsWith: "Usage").tap()
        assertExists("Usage")
        assertExists("7 days")
        assertExists("30 days")
        assertExists("90 days")
        capture("settings-usage")
    }

    func testAccessibilitySemanticsCriticalScreens() {
        launch(scenario: "onboarding")
        assertAccessibleButton(
            identifier: "connection-action-manual",
            label: "Enter details manually"
        )
        assertUniqueAccessibilityIdentifiers(context: "onboarding")
        capture("accessibility-onboarding")

        completeManualConnection(
            server: "http://127.0.0.1:3773",
            pairingCode: "fixture-code"
        )
        assertIdentifier("thread-fixture-main")
        assertAccessibleButton(
            identifier: "sidebar-new-task-button",
            label: "New task"
        )
        assertUniqueAccessibilityIdentifiers(context: "Home")
        capture("accessibility-home")

        assertIdentifier("sidebar-settings-button").tap()
        assertExists("Settings")
        assertUniqueAccessibilityIdentifiers(context: "Settings")
        capture("accessibility-settings")
    }

    func testRecoveryPersonaKeepsLastKnownWorkspace() {
        launch(scenario: "recovery")
        assertExists("Fixture Mac reconnecting")
        assertIdentifier("thread-fixture-main")
        capture("recovery-last-known-workspace")
    }

    func testPermissionsDeniedPersonaReflectsSettings() {
        launch(scenario: "permissions-denied")
        assertIdentifier("sidebar-settings-button").tap()
        assertSwitch("Haptics", isOn: false)
        assertSwitch("Notifications", isOn: false)
        assertSwitch("Live Activities", isOn: false)
        capture("settings-permissions-denied")
    }

    func testLongLivedPersonaSearchesAccumulatedHistory() {
        launch(scenario: "long-lived")
        assertIdentifier("sidebar-search-button").tap()
        assertIdentifier("sidebar-search-field").typeText("history item 24")
        assertIdentifier("thread-fixture-history-24")
        capture("long-lived-history-search")
    }

    func testSkillsPopupStaysReadableAboveKeyboardAndSelectsBottomSkill() {
        launch()
        assertIdentifier("thread-fixture-main").tap()
        assertIdentifier("message-fixture-user")

        if !app.descendants(matching: .any)["message-composer"].firstMatch.exists {
            assertHittableButton("Message agent").tap()
        }
        let composer = assertIdentifier("message-composer")
        composer.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(
            keyboard.waitForExistence(timeout: 4),
            "Thread composer did not accept keyboard focus"
        )
        composer.typeText("$")

        let menu = assertIdentifier("composer-command-menu")
        let firstSkill = assertIdentifier(
            "composer-suggestion-skill:accessibility-workflow-review"
        )
        XCTAssertTrue(
            firstSkill.label.contains(
                "Accessibility workflow review for compact mobile screens"
            ),
            "The long skill name was not exposed in full: \(firstSkill.label)"
        )
        XCTAssertTrue(
            firstSkill.label.contains("safe-area clearance"),
            "The skill description was not exposed in full: \(firstSkill.label)"
        )
        XCTAssertGreaterThanOrEqual(
            firstSkill.frame.height,
            60,
            "The long skill row collapsed below its readable expanded height"
        )
        assertMenu(menu, clears: keyboard)

        let lastSkill = assertIdentifier(
            "composer-suggestion-skill:zeta-release-proof-archive"
        )
        for _ in 0 ..< 8 where !isFullyContained(lastSkill, in: menu) {
            menu.swipeUp()
        }
        XCTAssertTrue(
            isFullyContained(lastSkill, in: menu),
            "Could not scroll the full final fixture skill row into view"
        )
        assertMenu(menu, clears: keyboard)
        capture("thread-skills-popup-scrolled")

        composer.typeText("release")
        XCTAssertTrue(lastSkill.waitForExistence(timeout: 4))
        XCTAssertTrue(lastSkill.isHittable, "The filtered final skill is not selectable")
        lastSkill.tap()

        XCTAssertTrue(menu.waitForNonExistence(timeout: 4), "Skills popup did not dismiss")
        XCTAssertEqual(
            composer.value as? String,
            "$zeta-release-proof-archive ",
            "Selecting the filtered skill did not replace the trigger"
        )
        XCTAssertTrue(keyboard.exists, "Selecting a skill unexpectedly dismissed the keyboard")
        capture("thread-skills-popup-selected")
    }

    func testHomeListScrollDoesNotOpenCommandPalette() {
        launch(scenario: "long-lived")

        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 8), "Home thread list did not appear")
        XCTAssertTrue(assertIdentifier("thread-fixture-history-24").isHittable)
        list.swipeUp()
        assertCommandPaletteClosed("A normal Home-list swipe opened the command palette")

        let nearTop = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12))
        nearTop.press(
            forDuration: 0.15,
            thenDragTo: nearTop.withOffset(CGVector(dx: 0, dy: -70)),
            withVelocity: .slow,
            thenHoldForDuration: 0.1
        )
        assertCommandPaletteClosed("A swipe near the top of the Home list opened the command palette")

        let accumulatedThread = app.descendants(matching: .any)["thread-fixture-main"].firstMatch
        for _ in 0 ..< 10 where !accumulatedThread.isHittable {
            list.swipeUp()
            assertCommandPaletteClosed("Scrolling accumulated history opened the command palette")
        }
        XCTAssertTrue(
            accumulatedThread.isHittable,
            "Home did not scroll to the final accumulated fixture thread"
        )
        capture("home-thread-list-scrolled")
    }

    func testCommandPaletteTopDrawerThresholdAndGestureIsolation() {
        launch()

        let homeGestureSurface = assertIdentifier("sidebar-search-button")
        drag(
            from: homeGestureSurface,
            offset: CGVector(dx: -120, dy: 18),
            velocity: .slow
        )
        assertCommandPaletteClosed("A horizontal Home-bar gesture opened the command palette")

        drag(
            from: homeGestureSurface,
            offset: CGVector(dx: 0, dy: 70),
            velocity: .slow
        )
        assertCommandPaletteClosed("A below-threshold Home-bar drag opened the command palette")

        drag(
            from: homeGestureSurface,
            offset: CGVector(dx: 0, dy: 120),
            velocity: .slow
        )
        assertCommandPaletteOpen()
        capture("command-palette-home-threshold")
        dismissCommandPalette()

        assertIdentifier("thread-fixture-main").tap()
        assertIdentifier("message-fixture-user")
        if !app.descendants(matching: .any)["message-composer"].firstMatch.exists {
            assertHittableButton("Message agent").tap()
        }
        let composer = assertIdentifier("message-composer")
        composer.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 4),
            "Thread composer did not accept keyboard focus"
        )

        let navigationBar = app.navigationBars.firstMatch
        XCTAssertTrue(navigationBar.waitForExistence(timeout: 4))
        drag(
            from: navigationBar,
            offset: CGVector(dx: 0, dy: 120),
            velocity: .slow
        )
        assertCommandPaletteOpen()
        capture("command-palette-thread-keyboard")
    }

    func testCreateTaskAndSendFollowUpHappyPath() {
        launch()
        assertIdentifier("sidebar-new-task-button").tap()

        let initialMessage = "Verify the native happy path"
        let newTaskComposer = assertIdentifier("message-composer")
        replaceText(in: newTaskComposer, with: initialMessage)
        assertIdentifier("message-send").tap()

        assertIdentifier("message-fixture-message-1")
        assertMessageCount(1)
        assertSingleMessageText(initialMessage)
        capture("created-task-detail")

        let followUp = "Confirm the follow-up path"
        if !app.descendants(matching: .any)["message-composer"].firstMatch.exists {
            assertHittableButton("Message agent").tap()
        }
        let followUpComposer = assertIdentifier("message-composer")
        followUpComposer.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) {
            followUpComposer.tap()
        }
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 2),
            "Thread composer did not accept keyboard focus"
        )
        replaceText(in: followUpComposer, with: followUp)
        assertIdentifier("message-send").tap()
        assertMessageCount(2)
        assertSingleMessageText(followUp)
        capture("sent-follow-up")
    }

    private func exerciseNewTaskComposerMenus() {
        launch()
        assertIdentifier("sidebar-new-task-button").tap()

        let workspaceMenu = assertHittableButton("Current checkout")
        workspaceMenu.tap()
        assertExists("New worktree")
        capture("new-task-workspace-menu")
        assertHittableButton("New worktree").tap()
        assertExists("Base branch")
        assertExists("Latest origin")
        assertHittableButton("Base branch").tap()
        assertExists("main")
        assertExists("personal/swiftui-feature/app-flow-regression-tests")
        capture("new-task-base-branch-picker")
        assertHittableButton("Cancel").tap()
        assertHittableButton("New worktree").tap()
        assertHittableButton("Current checkout").tap()

        tapAndAssertResponse(
            assertExists("Choose model"),
            destination: "Search models"
        )
        assertExists("GPT-5.6 Sol")
        capture("new-task-model-picker")
        assertHittableButton("Cancel").tap()

        assertHittableButton("Choose reasoning level").tap()
        assertExists("Medium")
        assertExists("High")
        capture("new-task-reasoning-menu")
        assertHittableButton("High").tap()

        assertIdentifier("image-attachment-picker").tap()
        assertExists("Photo Library")
        assertExists("Files")
        capture("new-task-attachment-menu")
        assertExists("What should we build").tap()
        XCTAssertTrue(
            app.buttons["Photo Library"].waitForNonExistence(timeout: 4),
            "Attachment menu did not dismiss after tapping outside it"
        )
    }

    func testProjectAndConnectionEntryPoints() {
        launch()

        tapAndAssertResponse(
            assertIdentifier("sidebar-add-project-button"),
            destination: "Add project"
        )
        assertExists("Folder")
        assertExists("Clone")
        capture("add-project-entry")
        assertHittableButton("Cancel").tap()

        assertIdentifier("sidebar-settings-button").tap()
        assertHittableButton(labelStartsWith: "Connections,").tap()
        assertHittableButton(labelStartsWith: "Fixture Mac,").tap()
        XCTAssertTrue(app.navigationBars["Fixture Mac"].waitForExistence(timeout: 4))
        assertExists("Remove connection")
        capture("connection-detail")
        assertHittableButton("Done").tap()

        assertHittableButton("Devices and sessions").tap()
        assertExists("Devices")
        assertExists("No devices found")
        capture("settings-devices")
        assertHittableButton("Done").tap()

        tapAndAssertResponse(
            assertIdentifier("connections-add-button"),
            destination: "Enter details manually"
        )
        assertExists("Scan QR code")
        assertExists("Paste connection link")
        capture("add-connection-entry")
    }

    func testThreadContextMenuInventory() {
        launch()

        let thread = assertIdentifier("thread-fixture-main")
        thread.press(forDuration: 1)

        let expectedItems = [
            "New thread on personal/swiftui-feature/app-flow-regression-tests",
            "Pin thread",
            "Settle thread",
            "Snooze",
            "Rename thread",
            "Regenerate title",
            "Archive",
            "Copy path",
            "Copy branch",
            "Copy Thread ID",
            "Delete",
        ]
        for item in expectedItems {
            assertExists(item)
        }
        capture("thread-context-menu")

        assertExists("Snooze").tap()
        XCTAssertTrue(
            app.buttons.matching(
                NSPredicate(format: "label BEGINSWITH %@", "In 1 hour")
            ).firstMatch.waitForExistence(timeout: 4)
        )
        capture("thread-snooze-menu")
    }

    func testThreadWorkspaceToolSurfaces() {
        verifyToolSurface(menuItem: "Files", title: "Files", evidence: "thread-files")
        verifyToolSurface(menuItem: "Review changes", title: "Review", evidence: "thread-review")
        verifyToolSurface(
            menuItem: "Source Control",
            title: "Source Control",
            evidence: "thread-source-control"
        )
        verifyToolSurface(menuItem: "Terminal", title: "Terminal", evidence: "thread-terminal")
    }

    func testKnownIssueThreadToolSheetHasExplicitDoneControl() throws {
        guard ProcessInfo.processInfo.environment["T3_APP_FLOW_RUN_KNOWN_FAILURES"] == "1" else {
            throw XCTSkip("Tracked product defect: https://github.com/saphid/t3code-personal/issues/60")
        }

        launch()
        assertIdentifier("thread-fixture-main").tap()
        assertExists("Thread actions").tap()
        assertExists("Files").tap()
        assertExists("Files")
        assertExists("Done")
    }

    func testKnownIssueAddConnectionSheetHasExplicitCloseControl() throws {
        guard ProcessInfo.processInfo.environment["T3_APP_FLOW_RUN_KNOWN_FAILURES"] == "1" else {
            throw XCTSkip("Tracked product defect: https://github.com/saphid/t3code-personal/issues/61")
        }

        launch()
        assertIdentifier("sidebar-settings-button").tap()
        assertHittableButton(labelStartsWith: "Connections,").tap()
        assertIdentifier("connections-add-button").tap()
        assertExists("Enter details manually")
        assertExists("Close")
    }

    func testKnownIssueNewTaskCancelDismissesComposer() throws {
        guard ProcessInfo.processInfo.environment["T3_APP_FLOW_RUN_KNOWN_FAILURES"] == "1" else {
            throw XCTSkip("Tracked product defect: https://github.com/saphid/t3code-personal/issues/62")
        }

        exerciseNewTaskComposerMenus()
        let composerTitle = assertExists("What should we build")
        assertHittableButton("Cancel").tap()
        XCTAssertTrue(
            composerTitle.waitForNonExistence(timeout: 4),
            "New Task did not dismiss after tapping its visible Cancel button"
        )
    }

    private func launch(
        scenario: String = "workspace",
        usesStagedCredentials: Bool = false
    ) {
        permissionPolicy = .denyAll
        if !Self.testedApplicationIsRegistered {
            // XCUITest can report PID 0 for an app left running by an earlier
            // invocation. Register the first journey with the same requested
            // persona before terminating it, so a launch/termination race can
            // never substitute the default workspace for another persona.
            let preflight = XCUIApplication()
            preflight.launchArguments = fixtureLaunchArguments(scenario: scenario)
            preflight.launchEnvironment["T3_APP_FLOW_FIXTURE_SCENARIO"] = scenario
            preflight.launch()
            preflight.terminate()
            Self.testedApplicationIsRegistered = true
        }

        app = XCUIApplication()
        app.terminate()
        app.launchEnvironment["T3_APP_FLOW_FIXTURE_SCENARIO"] = scenario
        app.launchArguments = fixtureLaunchArguments(
            scenario: scenario,
            usesStagedCredentials: usesStagedCredentials
        )
        app.launch()
    }

    private func launchLive() {
        permissionPolicy = .allowLocalNetwork
        app = XCUIApplication()
        app.terminate()
        app.launchArguments = [
            "-app-flow-staged-credentials",
            "-ApplePersistenceIgnoreState",
            "YES",
        ]
        app.launch()
    }

    private enum PermissionPolicy {
        case denyAll
        case allowLocalNetwork
    }

    private func fixtureLaunchArguments(
        scenario: String,
        usesStagedCredentials: Bool = false
    ) -> [String] {
        var arguments = [
            "-app-flow-fixture",
            "-app-flow-scenario",
            scenario,
            "-ApplePersistenceIgnoreState",
            "YES",
        ]
        if usesStagedCredentials {
            arguments.append("-app-flow-staged-credentials")
        }
        return arguments
    }

    @discardableResult
    private func assertIdentifier(
        _ identifier: String,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let element = app.descendants(matching: .any)[identifier].firstMatch
        XCTAssertTrue(
            element.waitForExistence(timeout: timeout),
            "Missing accessibility identifier: \(identifier)",
            file: file,
            line: line
        )
        return element
    }

    @discardableResult
    private func assertExists(
        _ label: String,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let element = app.descendants(matching: .any)[label].firstMatch
        XCTAssertTrue(
            element.waitForExistence(timeout: timeout),
            "Missing accessible label: \(label)",
            file: file,
            line: line
        )
        return element
    }

    private func assertSwitch(
        _ label: String,
        isOn: Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let control = app.switches[label].firstMatch
        XCTAssertTrue(
            control.waitForExistence(timeout: 8),
            "Missing switch: \(label)",
            file: file,
            line: line
        )
        XCTAssertEqual(
            control.value as? String,
            isOn ? "1" : "0",
            "Unexpected switch value: \(label)",
            file: file,
            line: line
        )
    }

    private func assertUniqueAccessibilityIdentifiers(
        context: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        // XCTest keeps decorative SF Symbols in its descendant snapshot even
        // when SwiftUI hides them from VoiceOver, and assigns the symbol name
        // as an identifier. Validate the application-owned semantic elements,
        // not duplicated framework metadata such as `chevron.right`.
        let identifiers = app.descendants(matching: .any).allElementsBoundByIndex
            .filter { $0.elementType != .image }
            .map(\.identifier)
            .filter { !$0.isEmpty }
        let duplicates = Dictionary(grouping: identifiers, by: { $0 })
            .filter { $0.value.count > 1 }
            .keys
            .sorted()
        XCTAssertTrue(
            duplicates.isEmpty,
            "Duplicate accessibility identifiers on \(context): \(duplicates.joined(separator: ", "))",
            file: file,
            line: line
        )
    }

    @discardableResult
    private func assertHittableButton(
        _ label: String,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        let buttons = app.buttons.matching(NSPredicate(format: "label == %@", label))

        repeat {
            for index in 0 ..< buttons.count {
                let button = buttons.element(boundBy: index)
                if button.exists, button.isHittable {
                    return button
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        let visibleButtonLabels = app.buttons.allElementsBoundByIndex
            .filter(\.exists)
            .map(\.label)
            .filter { !$0.isEmpty }
        XCTFail(
            "Missing hittable button: \(label). XCTest button labels: \(visibleButtonLabels)",
            file: file,
            line: line
        )
        return buttons.firstMatch
    }

    @discardableResult
    private func assertAccessibleButton(
        identifier: String,
        label: String,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let button = app.buttons[identifier].firstMatch
        XCTAssertTrue(
            button.waitForExistence(timeout: timeout),
            "Missing button accessibility identifier: \(identifier)",
            file: file,
            line: line
        )
        XCTAssertEqual(
            button.label,
            label,
            "Unexpected accessible label for \(identifier)",
            file: file,
            line: line
        )
        XCTAssertTrue(
            button.isHittable,
            "Button is not hittable: \(identifier)",
            file: file,
            line: line
        )
        return button
    }

    @discardableResult
    private func assertHittableButton(
        labelStartsWith prefix: String,
        timeout: TimeInterval = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        let buttons = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix))

        repeat {
            for index in 0 ..< buttons.count {
                let button = buttons.element(boundBy: index)
                if button.exists, button.isHittable {
                    return button
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        XCTFail("Missing hittable button beginning with: \(prefix)", file: file, line: line)
        return buttons.firstMatch
    }

    private func verifyToolSurface(menuItem: String, title: String, evidence: String) {
        launch()
        assertIdentifier("thread-fixture-main").tap()
        assertIdentifier("message-fixture-user")
        if menuItem == "Files" {
            capture("thread-detail")
        }
        assertExists("Thread actions").tap()
        assertExists("Pin")
        assertExists("Reload")
        assertExists("Archive")
        assertExists(menuItem).tap()
        assertExists(title)

        switch menuItem {
        case "Files":
            assertExists("Sources")
            assertExists("README.md")
            assertHittableButton("File browser options").tap()
            assertExists("Show hidden files")
            assertExists("Reload")
        case "Review changes":
            assertExists("Working tree")
            assertExists("AppFlowFixtureClient.swift")
        case "Source Control":
            assertExists("Commit changes")
            assertExists("Commit and push")
            assertExists("Commit, push, and create PR")
            assertExists("Push")
            assertExists("Create pull request")
        case "Terminal":
            assertHittableButton("Terminal options").tap()
            assertExists("Open new terminal")
            assertExists("Clear")
            assertExists("Stop terminal")
            XCTAssertTrue(
                app.buttons.matching(
                    NSPredicate(format: "label BEGINSWITH %@", "Text size ·")
                ).firstMatch.waitForExistence(timeout: 4)
            )
        default:
            XCTFail("Unhandled tool surface: \(menuItem)")
        }
        capture(evidence)
    }

    private func tapAndAssertResponse(
        _ element: XCUIElement,
        destination label: String,
        maximumLatency: TimeInterval = 3,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let startedAt = Date()
        element.tap()
        let destination = app.descendants(matching: .any)[label].firstMatch
        XCTAssertTrue(
            destination.waitForExistence(timeout: maximumLatency),
            "\(label) did not appear within \(maximumLatency) seconds",
            file: file,
            line: line
        )
        XCTAssertLessThanOrEqual(
            Date().timeIntervalSince(startedAt),
            maximumLatency,
            "\(label) responded too slowly",
            file: file,
            line: line
        )
    }

    private func replaceText(in element: XCUIElement, with text: String) {
        element.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 2),
            "Text input did not accept keyboard focus"
        )
        if let value = element.value as? String,
           !value.isEmpty,
           value != "Ask anything…" {
            XCTFail("Fixture composer opened with a stale draft: \(value)")
            return
        }
        element.typeText(text)
    }

    private func assertMenu(
        _ menu: XCUIElement,
        clears keyboard: XCUIElement,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let windowFrame = app.windows.firstMatch.frame
        XCTAssertGreaterThanOrEqual(menu.frame.minX, windowFrame.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(menu.frame.maxX, windowFrame.maxX, file: file, line: line)
        XCTAssertLessThanOrEqual(
            menu.frame.maxY,
            keyboard.frame.minY + 2,
            "Skills popup overlaps the software keyboard",
            file: file,
            line: line
        )
    }

    private func isFullyContained(_ element: XCUIElement, in container: XCUIElement) -> Bool {
        let elementFrame = element.frame
        let containerFrame = container.frame
        return elementFrame.minY >= containerFrame.minY
            && elementFrame.maxY <= containerFrame.maxY
    }

    private func drag(
        from element: XCUIElement,
        offset: CGVector,
        velocity: XCUIGestureVelocity
    ) {
        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(
            forDuration: 0.15,
            thenDragTo: start.withOffset(offset),
            withVelocity: velocity,
            thenHoldForDuration: 0.1
        )
    }

    private func assertCommandPaletteClosed(
        _ message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let drawer = app.descendants(matching: .any)["command-palette-drawer"].firstMatch
        XCTAssertTrue(drawer.waitForNonExistence(timeout: 2), message, file: file, line: line)
    }

    private func assertCommandPaletteOpen(
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(
            app.descendants(matching: .any)["command-palette-drawer"].firstMatch
                .waitForExistence(timeout: 5),
            "Command palette did not settle open",
            file: file,
            line: line
        )
        XCTAssertTrue(
            app.textFields["command-palette-search"].firstMatch.waitForExistence(timeout: 4),
            "Command palette search did not become interactive",
            file: file,
            line: line
        )
    }

    private func dismissCommandPalette() {
        assertHittableButton("Done").tap()
        assertCommandPaletteClosed("Command palette did not dismiss")
    }

    private func assertMessageCount(
        _ expectedCount: Int,
        timeout: TimeInterval = 4,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let matches = app.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "message-cell-")
        )
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if matches.count == expectedCount {
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
                if matches.count == expectedCount { return }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        XCTFail(
            "Expected \(expectedCount) rendered fixture messages but found \(matches.count)",
            file: file,
            line: line
        )
    }

    private func assertSingleMessageText(
        _ text: String,
        timeout: TimeInterval = 4,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let matches = app.staticTexts.matching(NSPredicate(format: "value == %@", text))
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if matches.count == 1 { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline

        XCTFail(
            "Expected one rendered message with exact text but found \(matches.count): \(text)",
            file: file,
            line: line
        )
    }

    private func capture(_ name: String) {
        resolvePendingSystemPermissionBeforeCapture()

        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let accessibility = XCTAttachment(
            data: Data(app.debugDescription.utf8),
            uniformTypeIdentifier: "public.plain-text"
        )
        accessibility.name = "\(name)-accessibility"
        accessibility.lifetime = .keepAlways
        add(accessibility)
    }

    private func resolvePendingSystemPermissionBeforeCapture() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.firstMatch
        guard alert.waitForExistence(timeout: 1) else { return }

        let containsLocalNetworkText = alert.label
            .localizedCaseInsensitiveContains("local network")
            || alert.staticTexts.allElementsBoundByIndex
            .contains { $0.label.localizedCaseInsensitiveContains("local network") }
        let preferredButton = permissionPolicy == .allowLocalNetwork && containsLocalNetworkText
            ? alert.buttons["Allow"]
            : alert.buttons["Don’t Allow"]
        XCTAssertTrue(
            preferredButton.exists,
            "Pending system permission has no policy-approved action"
        )
        preferredButton.tap()
        XCTAssertTrue(
            alert.waitForNonExistence(timeout: 3),
            "System permission remained visible before proof capture"
        )
    }

}
