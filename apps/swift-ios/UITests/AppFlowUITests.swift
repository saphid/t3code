import XCTest

@MainActor
final class AppFlowUITests: XCTestCase {
    private static var testedApplicationIsRegistered = false
    private var app: XCUIApplication!
    private var permissionPolicy = PermissionPolicy.denyAll
    private var proofEvents: AppFlowProofEventEmitter!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        proofEvents = AppFlowProofEventEmitter(testName: name)
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

    func testInAppStreamApprovalControlRequiresExactVerdictConfirmation() {
        launch(scenario: "stream-approval")
        let openSettings = proofTap(
            assertIdentifier("sidebar-settings-button"),
            selector: "sidebar-settings-button",
            postcondition: "Settings is visible"
        )
        assertExists("Settings")
        proofPassed(openSettings, observation: "Settings is visible")

        let reviewRow = app.descendants(matching: .any)["Review Dev candidates"].firstMatch
        scrollToHittable(reviewRow)
        let openReview = proofTap(
            reviewRow,
            selector: "Review Dev candidates",
            postcondition: "Exact Dev build identity is visible"
        )

        XCTAssertTrue(app.navigationBars["Ready for testing"].waitForExistence(timeout: 8))
        let identity = assertIdentifier("build-testing-build-identity")
        XCTAssertEqual(identity.label, "Build 5,601 · Revision 56f17e0")
        proofPassed(openReview, observation: "Build 5,601 · Revision 56f17e0 is visible")
        assertExists("Development → Test → Dev → Upstream · Current gate: enter Test")

        let pipeline = assertExists("Proposed PR promotion flow")
        let inspectPipeline = proofTap(
            pipeline,
            selector: "Proposed PR promotion flow",
            postcondition: "All six phone and branch promotion stages are visible"
        )
        for stage in [
            "Candidate PR into Test",
            "SwiftUI Test build",
            "You approve the feature",
            "SwiftUI Dev build",
            "You approve upstream delivery",
            "Upstream PR",
        ] {
            assertExists(stage)
        }
        proofPassed(inspectPipeline, observation: "Candidate, Test, Dev, approvals, and upstream stages are visible")
        capture("stream-approval-pipeline")
        pipeline.tap()

        let entry = assertIdentifier("build-testing-entry-in-app-stream-approval-control")
        XCTAssertTrue(entry.label.hasPrefix("In-app stream approval control"))
        XCTAssertTrue(entry.label.contains("Priority 1, Release control"))
        XCTAssertTrue(entry.label.contains("1 commits · 1 thread"))
        XCTAssertTrue(entry.label.hasSuffix("Proved"))

        let pendingEntry = assertIdentifier("build-testing-entry-fixture-pending-proof")
        XCTAssertGreaterThan(
            pendingEntry.frame.minY,
            entry.frame.minY,
            "Review cards are not ordered by ascending priority"
        )
        scrollToHittable(pendingEntry)
        let inspectPending = proofTap(
            pendingEntry,
            selector: "build-testing-entry-fixture-pending-proof",
            postcondition: "Pending-proof notice is visible and approval is blocked"
        )
        assertIdentifier("build-testing-proof-pending-fixture-pending-proof")
        assertExists(
            "Fresh Test proof is being recorded. This item is not ready for approval."
        )
        let pendingReady = assertIdentifier("build-testing-ready-fixture-pending-proof")
        XCTAssertFalse(pendingReady.isEnabled, "Pending proof did not block Ready for Test")
        XCTAssertTrue(
            assertIdentifier("build-testing-not-ready-fixture-pending-proof").isEnabled,
            "Pending proof unexpectedly blocked the Not ready safety verdict"
        )
        proofPassed(inspectPending, observation: "Pending proof blocks approval but preserves rejection")
        capture("stream-approval-proof-pending")
        pendingEntry.tap()

        scrollToHittable(entry)
        let expandEntry = proofTap(
            entry,
            selector: "build-testing-entry-in-app-stream-approval-control",
            postcondition: "The exact feature review guide is visible"
        )

        assertExists("What changed")
        assertExists(
            "The Dev review screen now binds one feature, build, revision, commit, and T3 thread to an auditable verdict."
        )
        assertExists("What to check")
        assertExists(
            "Confirm the exact build identity and review guide, then inspect both verdict confirmations."
        )
        assertExists("Success looks like")
        assertExists(
            "Ready for Test and Not ready each require confirmation for this feature and exact build before a verdict is sent."
        )
        assertExists("5600000")
        assertExists("App flow regression audit")
        proofPassed(expandEntry, observation: "Feature, commit, and thread attribution are visible")
        capture("stream-approval-review-guide")

        let ready = app.buttons["build-testing-ready-in-app-stream-approval-control"].firstMatch
        scrollToHittable(ready)
        XCTAssertEqual(ready.label, "Ready for Test")
        let requestReady = proofTap(
            ready,
            selector: "build-testing-ready-in-app-stream-approval-control",
            postcondition: "Ready for Test confirmation is visible"
        )
        assertExists("Send to Test?")
        assertExists(
            "This sends an auditable verdict for In-app stream approval control from exact build 5,601 to its owning T3 thread."
        )
        proofPassed(requestReady, observation: "Ready confirmation names feature and exact build")
        capture("stream-approval-ready-confirmation")

        let confirmReady = proofTap(
            assertHittableButton("Ready for Test"),
            selector: "Ready for Test confirmation action",
            postcondition: "The exact verdict is queued"
        )
        assertExists("Testing verdict")
        assertExists("Verdict queued for App flow regression audit.")
        proofPassed(confirmReady, observation: "Exact verdict queued for owning T3 thread")
        capture("stream-approval-ready-recorded")
        assertHittableButton("OK").tap()
        assertExists("Submitted: Ready for Test")

        let notReady = assertIdentifier(
            "build-testing-not-ready-in-app-stream-approval-control"
        )
        scrollToHittable(notReady)
        XCTAssertEqual(notReady.label, "Not ready")
        let requestNotReady = proofTap(
            notReady,
            selector: "build-testing-not-ready-in-app-stream-approval-control",
            postcondition: "Not ready confirmation is visible"
        )
        assertExists("Mark as not ready?")
        assertExists(
            "This sends an auditable verdict for In-app stream approval control from exact build 5,601 to its owning T3 thread."
        )
        proofPassed(requestNotReady, observation: "Not ready confirmation names feature and exact build")
        capture("stream-approval-not-ready-confirmation")
    }

    func testInitialThreadLiveUpdateWinsAndTimelineStaysStableOnReopen() {
        launch(scenario: "live-update-race")
        let initialOpen = proofTap(
            assertIdentifier("thread-fixture-main"),
            selector: "thread-fixture-main",
            postcondition: "Newer live detail wins during initial history load"
        )

        let initial = assertIdentifier("message-fixture-assistant")
        let live = assertIdentifier("message-fixture-live-update")
        assertSingleMessageText(
            "This live update arrived while initial history was still loading."
        )
        assertMessageCount(3)
        XCTAssertLessThan(initial.frame.minY, live.frame.minY)
        proofPassed(initialOpen, observation: "Live message is present once after initial open")
        capture("initial-thread-live-update")

        let navigationBar = app.navigationBars.firstMatch
        XCTAssertTrue(navigationBar.waitForExistence(timeout: 4))
        let back = navigationBar.buttons.firstMatch
        XCTAssertTrue(back.isHittable, "Thread navigation did not expose a back button")
        let returnHome = proofTap(
            back,
            selector: "BackButton",
            postcondition: "Home thread row is visible"
        )
        let threadRow = assertIdentifier("thread-fixture-main")
        proofPassed(returnHome, observation: "Home thread row is visible")
        let reopen = proofTap(
            threadRow,
            selector: "thread-fixture-main",
            postcondition: "The same ordered timeline is visible after reopen"
        )

        let reopenedInitial = assertIdentifier("message-fixture-assistant")
        let reopenedLive = assertIdentifier("message-fixture-live-update")
        assertMessageCount(3)
        XCTAssertLessThan(reopenedInitial.frame.minY, reopenedLive.frame.minY)
        assertSingleMessageText(
            "This live update arrived while initial history was still loading."
        )
        proofPassed(reopen, observation: "Live message remains present once and in order")
        capture("reopened-thread-live-update")
    }

    func testProofEventEmitterWritesCompatibleOptInSessionAndActionMap() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("app-flow-proof-emitter-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let sessionURL = root.appendingPathComponent("session.json")
        let mapURL = root.appendingPathComponent("action-map.json")
        let anchor = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-08-15T00:00:00Z")
        )
        var uptime = 100.0
        let emitter = AppFlowProofEventEmitter(
            environment: [
                AppFlowProofEventEmitter.sessionPathEnvironment: sessionURL.path,
                AppFlowProofEventEmitter.actionMapPathEnvironment: mapURL.path,
                AppFlowProofEventEmitter.recordingStartEnvironment: "2026-08-14T23:59:59.000Z",
                AppFlowProofEventEmitter.planEnvironment: "proof-contract",
            ],
            wallAnchor: anchor,
            monotonicAnchor: uptime,
            monotonicNow: { uptime }
        )
        uptime = 100.25
        let actionID = try XCTUnwrap(
            emitter.recordTap(
                selector: "fixture-control",
                point: CGPoint(x: 0.25, y: 0.75),
                postcondition: "fixture result is visible"
            )
        )
        uptime = 100.5
        emitter.recordPassed(actionID: actionID, observation: "fixture result is visible")
        uptime = 100.75
        let swipeID = try XCTUnwrap(
            emitter.recordSwipe(
                selector: "fixture-list",
                from: CGPoint(x: 0.5, y: 0.8),
                to: CGPoint(x: 0.5, y: 0.3),
                duration: 0.6,
                postcondition: "older fixture content is visible"
            )
        )
        uptime = 101.0
        emitter.recordPassed(actionID: swipeID, observation: "older fixture content is visible")

        let session = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: sessionURL))
                as? [String: Any]
        )
        XCTAssertEqual(session["schemaVersion"] as? Int, 1)
        XCTAssertEqual(session["plan"] as? String, "proof-contract")
        let events = try XCTUnwrap(session["events"] as? [[String: Any]])
        XCTAssertEqual(
            events.map { $0["phase"] as? String },
            ["act", "assert", "act", "assert"]
        )
        XCTAssertEqual(events[0]["id"] as? String, "event-1")
        XCTAssertEqual(events[0]["elapsedSeconds"] as? Double, 0.25)
        XCTAssertEqual(events[0]["point"] as? [Double], [0.25, 0.75])
        XCTAssertEqual(events[1]["actionid"] as? String, "event-1")
        XCTAssertEqual(events[1]["result"] as? String, "passed")
        XCTAssertEqual(events[2]["action"] as? String, "swipe")
        XCTAssertEqual(events[2]["from"] as? [Double], [0.5, 0.8])
        XCTAssertEqual(events[2]["to"] as? [Double], [0.5, 0.3])
        XCTAssertEqual(events[2]["duration"] as? Double, 0.6)
        XCTAssertEqual(events[3]["actionid"] as? String, "event-3")

        let actionMap = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: mapURL))
                as? [String: Any]
        )
        XCTAssertEqual(actionMap["version"] as? Int, 1)
        XCTAssertEqual(
            actionMap["recording_started_at"] as? String,
            "2026-08-14T23:59:59.000Z"
        )
        let actions = try XCTUnwrap(actionMap["actions"] as? [[String: Any]])
        XCTAssertEqual(actions[0]["action_id"] as? String, "event-1")
        XCTAssertEqual(actions[0]["kind"] as? String, "tap")
        XCTAssertEqual(actions[0]["at"] as? Double, 1.25)
        XCTAssertEqual(actions[0]["point"] as? [Double], [0.25, 0.75])
        XCTAssertEqual(actions[1]["action_id"] as? String, "event-3")
        XCTAssertEqual(actions[1]["kind"] as? String, "swipe")
        XCTAssertEqual(actions[1]["at"] as? Double, 1.75)
        XCTAssertEqual(actions[1]["from"] as? [Double], [0.5, 0.8])
        XCTAssertEqual(actions[1]["to"] as? [Double], [0.5, 0.3])
        XCTAssertEqual(actions[1]["duration"] as? Double, 0.6)

        let disabled = AppFlowProofEventEmitter(environment: [:])
        XCTAssertFalse(disabled.isEnabled)
        XCTAssertNil(
            disabled.recordTap(
                selector: "disabled",
                point: .zero,
                postcondition: "no output"
            )
        )
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
            90,
            "The long skill row collapsed below its readable expanded height"
        )
        assertMenu(menu, clears: keyboard)

        let lastSkill = assertIdentifier(
            "composer-suggestion-skill:zeta-release-proof-archive"
        )
        for _ in 0 ..< 8 where !isFullyContained(lastSkill, in: menu) {
            let scroll = proofSwipe(
                menu,
                selector: "composer-command-menu",
                from: CGVector(dx: 0.5, dy: 0.78),
                to: CGVector(dx: 0.5, dy: 0.24),
                duration: 0.6,
                postcondition: "The Skills popup scrolls and remains clear of the keyboard"
            )
            assertMenu(menu, clears: keyboard)
            proofPassed(
                scroll,
                observation: "The Skills popup remained readable above the keyboard"
            )
        }
        XCTAssertTrue(
            isFullyContained(lastSkill, in: menu),
            "Could not scroll the full final fixture skill row into view"
        )
        XCTAssertGreaterThanOrEqual(
            lastSkill.frame.height,
            90,
            "The full final skill row collapsed below its readable expanded height"
        )
        assertMenu(menu, clears: keyboard)
        capture("thread-skills-popup-scrolled")

        XCTAssertTrue(lastSkill.isHittable, "The full-popup final skill is not selectable")
        let selectFullSkill = proofTap(
            lastSkill,
            selector: "composer-suggestion-skill:zeta-release-proof-archive",
            postcondition: "The full-popup skill replaces the trigger"
        )
        XCTAssertTrue(menu.waitForNonExistence(timeout: 4), "Skills popup did not dismiss")
        let fullSelection = "$zeta-release-proof-archive "
        XCTAssertEqual(
            composer.value as? String,
            fullSelection,
            "Selecting the full-popup final skill did not replace the trigger"
        )
        XCTAssertTrue(keyboard.exists, "Selecting a skill unexpectedly dismissed the keyboard")
        proofPassed(
            selectFullSkill,
            observation: "The full-popup skill replaced the trigger and kept the keyboard open"
        )

        launch()
        assertIdentifier("thread-fixture-main").tap()
        assertIdentifier("message-fixture-user")
        if !app.descendants(matching: .any)["message-composer"].firstMatch.exists {
            assertHittableButton("Message agent").tap()
        }
        let filteredComposer = assertIdentifier("message-composer")
        filteredComposer.tap()
        let filteredKeyboard = app.keyboards.firstMatch
        XCTAssertTrue(
            filteredKeyboard.waitForExistence(timeout: 4),
            "Thread composer did not accept keyboard focus for filtering"
        )
        filteredComposer.typeText("$release")
        let filteredMenu = assertIdentifier("composer-command-menu")
        let filteredSkill = assertIdentifier(
            "composer-suggestion-skill:zeta-release-proof-archive"
        )
        assertMenu(filteredMenu, clears: filteredKeyboard)
        XCTAssertTrue(filteredSkill.isHittable, "The filtered final skill is not selectable")
        let selectFilteredSkill = proofTap(
            filteredSkill,
            selector: "filtered composer-suggestion-skill:zeta-release-proof-archive",
            postcondition: "The filtered skill replaces the trigger"
        )
        XCTAssertTrue(
            filteredMenu.waitForNonExistence(timeout: 4),
            "Filtered Skills popup did not dismiss"
        )
        XCTAssertEqual(
            filteredComposer.value as? String,
            fullSelection,
            "Selecting the filtered skill did not replace the trigger"
        )
        proofPassed(
            selectFilteredSkill,
            observation: "The filtered skill replaced the trigger"
        )
        capture("thread-skills-popup-selected")
    }

    func testHomeListScrollDoesNotOpenCommandPalette() {
        launch(scenario: "long-lived")

        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 8), "Home thread list did not appear")
        XCTAssertTrue(assertIdentifier("thread-fixture-history-24").isHittable)

        let rubberBandEnd = min(0.95, 0.12 + 110 / list.frame.height)
        let rubberBand = proofSwipe(
            list,
            selector: "Home collection view at top",
            from: CGVector(dx: 0.5, dy: 0.12),
            to: CGVector(dx: 0.5, dy: rubberBandEnd),
            duration: 0.6,
            postcondition: "The top rubber-band gesture leaves the command palette closed"
        )
        assertCommandPaletteClosed(
            "A downward rubber-band gesture at the top of Home opened the command palette"
        )
        proofPassed(rubberBand, observation: "The top rubber-band gesture kept the drawer closed")

        let scrollDown = proofSwipe(
            list,
            selector: "Home collection view",
            from: CGVector(dx: 0.5, dy: 0.76),
            to: CGVector(dx: 0.5, dy: 0.28),
            duration: 0.6,
            postcondition: "A normal Home-list swipe leaves the command palette closed"
        )
        assertCommandPaletteClosed("A normal Home-list swipe opened the command palette")
        proofPassed(scrollDown, observation: "The Home list scrolled without opening the drawer")
        let scrollUp = proofSwipe(
            list,
            selector: "Home collection view",
            from: CGVector(dx: 0.5, dy: 0.28),
            to: CGVector(dx: 0.5, dy: 0.76),
            duration: 0.6,
            postcondition: "A downward Home-list scroll leaves the command palette closed"
        )
        assertCommandPaletteClosed("A downward Home-list scroll opened the command palette")
        proofPassed(scrollUp, observation: "The Home list scrolled back without opening the drawer")

        let accumulatedThread = app.descendants(matching: .any)["thread-fixture-main"].firstMatch
        for _ in 0 ..< 10 where !accumulatedThread.isHittable {
            let historyScroll = proofSwipe(
                list,
                selector: "accumulated Home history",
                from: CGVector(dx: 0.5, dy: 0.76),
                to: CGVector(dx: 0.5, dy: 0.28),
                duration: 0.6,
                postcondition: "Accumulated history scrolls with the command palette closed"
            )
            assertCommandPaletteClosed("Scrolling accumulated history opened the command palette")
            proofPassed(
                historyScroll,
                observation: "Accumulated history scrolled with the drawer closed"
            )
        }
        XCTAssertTrue(
            accumulatedThread.isHittable,
            "Home did not scroll to the final accumulated fixture thread"
        )
        capture("home-thread-list-scrolled")
    }

    func testColdBootHomeListScrollsWhileMetadataArrivesAndAfterReturning() throws {
        launch(scenario: "cold-boot")

        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 8), "Cold-boot Home list did not appear")
        let initialTopThread = assertIdentifier("thread-fixture-history-24")
        XCTAssertTrue(initialTopThread.isHittable, "Cold-boot Home did not contain fixture history")
        let metadataReady = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "metadata ready"),
            object: initialTopThread
        )
        XCTAssertEqual(
            XCTWaiter.wait(for: [metadataReady], timeout: 4),
            .completed,
            "Cold-boot metadata fixture did not begin its update sequence"
        )
        let firstScroll = proofSwipe(
            list,
            selector: "cold-boot Home collection view",
            from: CGVector(dx: 0.5, dy: 0.76),
            to: CGVector(dx: 0.5, dy: 0.28),
            duration: 0.6,
            postcondition: "The first drag moves the populated list while metadata snapshots arrive"
        )
        XCTAssertFalse(
            initialTopThread.isHittable,
            "The first cold-boot drag did not move the initial top thread off screen"
        )
        assertCommandPaletteClosed("Cold-boot list scrolling opened the command palette")
        proofPassed(firstScroll, observation: "The first drag moved Home without opening the drawer")
        capture("cold-boot-home-first-scroll")

        let visibleThread = try XCTUnwrap(
            app.descendants(matching: .any).allElementsBoundByIndex.first {
                $0.identifier.hasPrefix("thread-fixture-history-") && $0.isHittable
            },
            "No history thread remained hittable after the first cold-boot drag"
        )
        let openedThread = proofTap(
            visibleThread,
            selector: visibleThread.identifier,
            postcondition: "The selected history thread opens during metadata loading"
        )
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 4))
        proofPassed(openedThread, observation: "A history thread opened from the moving Home list")

        let back = app.navigationBars.firstMatch.buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 4))
        back.tap()
        XCTAssertTrue(list.waitForExistence(timeout: 4), "Home did not return after opening a thread")

        let returnScroll = proofSwipe(
            list,
            selector: "returned cold-boot Home collection view",
            from: CGVector(dx: 0.5, dy: 0.32),
            to: CGVector(dx: 0.5, dy: 0.72),
            duration: 0.6,
            postcondition: "The returned Home list responds without snapping back"
        )
        assertCommandPaletteClosed("Returned cold-boot list scrolling opened the command palette")
        proofPassed(returnScroll, observation: "Home remained scrollable after opening and returning")
        capture("cold-boot-home-returned-scroll")
    }

    func testPersonalConnectShowsFailureConnectsAndPersistsAcrossReopen() {
        launch(
            scenario: "personal-connect",
            extraEnvironment: ["T3_APP_FLOW_PERSONAL_CONNECT_RESET": "1"]
        )
        assertExists("PERSONAL CONNECT")
        assertExists("Pair directly through your private Tailnet. No code entry required.")

        let unavailable = assertIdentifier("personal-connect-host-fixture-unavailable")
        let requestUnavailable = proofTap(
            unavailable,
            selector: "personal-connect-host-fixture-unavailable",
            postcondition: "The unavailable private host explains the failure"
        )
        assertExists("Offline Fixture Mac pairing is unavailable (HTTP 503).")
        proofPassed(requestUnavailable, observation: "Unavailable host failure is visible and specific")
        capture("personal-connect-unavailable")

        let reachable = assertIdentifier("personal-connect-host-fixture-reachable")
        let requestConnection = proofTap(
            reachable,
            selector: "personal-connect-host-fixture-reachable",
            postcondition: "One action connects without manual code entry"
        )
        assertIdentifier("thread-fixture-main", timeout: 12)
        proofPassed(requestConnection, observation: "Personal Connect reached the fixture Home")
        capture("personal-connect-connected-home")

        app.terminate()
        launch(scenario: "personal-connect")
        assertIdentifier("thread-fixture-main", timeout: 12)
        XCTAssertFalse(
            app.descendants(matching: .any)["PERSONAL CONNECT"].firstMatch.exists,
            "The persisted fixture connection reopened onboarding"
        )
        capture("personal-connect-reopened-home")
    }

    func testCommandPaletteTopDrawerThresholdAndGestureIsolation() {
        launch()

        let homeGestureSurface = assertIdentifier("sidebar-search-button")
        let homeHorizontal = proofDrag(
            from: homeGestureSurface,
            offset: CGVector(dx: -120, dy: 18),
            velocity: .slow,
            selector: "Home search button horizontal drag",
            postcondition: "A horizontal Home-bar drag leaves the command palette closed"
        )
        assertCommandPaletteClosed("A horizontal Home-bar gesture opened the command palette")
        proofPassed(homeHorizontal, observation: "The horizontal Home drag kept the drawer closed")

        let homeBelowThreshold = proofDrag(
            from: homeGestureSurface,
            offset: CGVector(dx: 0, dy: 70),
            velocity: .slow,
            selector: "Home search button short downward drag",
            postcondition: "A below-threshold Home drag leaves the command palette closed"
        )
        assertCommandPaletteClosed("A below-threshold Home-bar drag opened the command palette")
        proofPassed(
            homeBelowThreshold,
            observation: "The short Home drag kept the drawer closed"
        )

        let homeOpen = proofDrag(
            from: homeGestureSurface,
            offset: CGVector(dx: 0, dy: 120),
            velocity: .slow,
            selector: "Home search button full downward drag",
            postcondition: "A full Home drag opens the command palette"
        )
        assertCommandPaletteOpen()
        proofPassed(homeOpen, observation: "The full Home drag opened the drawer")
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
        let threadHorizontal = proofDrag(
            from: navigationBar,
            offset: CGVector(dx: -120, dy: 18),
            velocity: .slow,
            selector: "Thread header horizontal drag",
            postcondition: "A horizontal thread-header drag leaves the command palette closed"
        )
        assertCommandPaletteClosed("A horizontal thread-header gesture opened the command palette")
        proofPassed(
            threadHorizontal,
            observation: "The horizontal thread drag kept the drawer closed"
        )

        let threadBelowThreshold = proofDrag(
            from: navigationBar,
            offset: CGVector(dx: 0, dy: 70),
            velocity: .slow,
            selector: "Thread header short downward drag",
            postcondition: "A below-threshold thread drag leaves the command palette closed"
        )
        assertCommandPaletteClosed("A below-threshold thread-header drag opened the command palette")
        proofPassed(
            threadBelowThreshold,
            observation: "The short thread drag kept the drawer closed"
        )

        let threadOpen = proofDrag(
            from: navigationBar,
            offset: CGVector(dx: 0, dy: 120),
            velocity: .slow,
            selector: "Thread header full downward drag",
            postcondition: "A full thread drag opens the command palette"
        )
        assertCommandPaletteOpen()
        proofPassed(threadOpen, observation: "The full thread drag opened the drawer")
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

    func testThemeSearchSelectionPersistenceAndNativeTerminalColorAgreement() {
        launch(
            scenario: "theme-catalog",
            extraEnvironment: ["T3_APP_FLOW_THEME_RESET": "1"]
        )
        openThemeSettings()
        assertExists("VS Code themes from Open VSX")

        let search = assertIdentifier("theme-open-vsx-search-field")
        search.tap()
        search.typeText("fixture night")
        let searchAction = proofTap(
            assertIdentifier("theme-open-vsx-search-button"),
            selector: "theme-open-vsx-search-button",
            postcondition: "The deterministic Open VSX result is visible"
        )
        let install = assertIdentifier("theme-open-vsx-install-fixture.night-theme")
        scrollToHittable(install)
        XCTAssertEqual(
            app.staticTexts.matching(
                NSPredicate(format: "label == %@", "Fixture Night Theme")
            ).count,
            1
        )
        proofPassed(searchAction, observation: "One compatible Fixture Night Theme result is visible")
        capture("theme-open-vsx-search")

        let installAction = proofTap(
            install,
            selector: "theme-open-vsx-install-fixture.night-theme",
            postcondition: "Fixture Night is installed and selected for light and dark appearances"
        )
        assertExists("Installed 1 theme from Fixture Night Theme.")
        assertHittableButton("OK").tap()

        let lightCard = app.descendants(matching: .any)["theme-card-fixture-night-light"].firstMatch
        scrollToHittable(lightCard)
        XCTAssertTrue(lightCard.isSelected)
        XCTAssertTrue((lightCard.value as? String)?.contains("canvas #f5f3ff") == true)
        XCTAssertTrue((lightCard.value as? String)?.contains("terminal background #f5f3ff") == true)
        let darkCard = app.descendants(matching: .any)["theme-card-fixture-night-dark"].firstMatch
        scrollToHittable(darkCard)
        XCTAssertTrue(darkCard.isSelected)
        XCTAssertTrue((darkCard.value as? String)?.contains("canvas #111827") == true)
        XCTAssertTrue((darkCard.value as? String)?.contains("terminal background #111827") == true)
        proofPassed(installAction, observation: "Light and dark cards are selected and expose matching native and terminal canvas colors")
        capture("theme-selected-light-dark")

        for _ in 0 ..< 6 {
            app.swipeDown()
        }
        let lightControl = assertHittableButton("Light")
        let lightAction = proofTap(
            lightControl,
            selector: "Appearance.Light",
            postcondition: "The Fixture Night light native canvas is active"
        )
        XCTAssertTrue(lightControl.isSelected)
        proofPassed(lightAction, observation: "The selected light theme remains Fixture Night")
        capture("theme-native-light")

        launch(scenario: "theme-catalog")
        openThemeSettings()
        let persistedLightCard = app.descendants(matching: .any)["theme-card-fixture-night-light"].firstMatch
        scrollToHittable(persistedLightCard)
        XCTAssertTrue(persistedLightCard.isSelected)
        for _ in 0 ..< 6 {
            app.swipeDown()
        }
        let persistedAction = proofTap(
            assertHittableButton("Dark"),
            selector: "Appearance.Dark",
            postcondition: "The persisted dark Fixture Night theme is active"
        )
        let persistedDarkCard = app.descendants(matching: .any)["theme-card-fixture-night-dark"].firstMatch
        scrollToHittable(persistedDarkCard)
        XCTAssertTrue(persistedDarkCard.isSelected)
        proofPassed(persistedAction, observation: "Fixture Night persisted across app relaunch and is selected in dark appearance")
        capture("theme-persisted-dark")

        let back = app.navigationBars["Themes"].buttons.firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 8))
        back.tap()
        assertHittableButton("Cancel").tap()
        assertIdentifier("thread-fixture-main").tap()
        assertExists("Thread actions").tap()
        let terminalAction = proofTap(
            assertExists("Terminal"),
            selector: "Thread actions.Terminal",
            postcondition: "Terminal opens with the persisted Fixture Night dark roles"
        )
        assertHittableButton("Terminal options")
        proofPassed(terminalAction, observation: "Terminal is visible under the same persisted dark theme")
        capture("theme-terminal-dark-agreement")
    }

    func testSourceControlRetainsContentRetriesAndRestoresFocusTarget() {
        launch(scenario: "tool-recovery")
        assertIdentifier("thread-fixture-main").tap()
        assertExists("Thread actions").tap()
        assertExists("Source Control").tap()

        let branch = assertIdentifier("source-control-branch")
        let fileRow = assertIdentifier(
            "source-control-file-apps/swift-ios/App/AppFlowFixtureClient.swift"
        )
        XCTAssertEqual(identifierCount("source-control-branch"), 1)
        XCTAssertTrue(fileRow.label.contains("AppFlowFixtureClient.swift"))
        XCTAssertEqual(
            identifierCount("source-control-file-apps/swift-ios/App/AppFlowFixtureClient.swift"),
            1
        )

        let reloadAction = proofTap(
            assertHittableButton("Reload source control"),
            selector: "Reload source control",
            postcondition: "The last known branch and file remain visible beside a recoverable error"
        )
        let message = assertIdentifier("source-control-recovery-message")
        XCTAssertEqual(
            message.label,
            "Fixture source-control refresh failed. The last known working tree is retained."
        )
        XCTAssertTrue(branch.exists)
        XCTAssertEqual(
            identifierCount("source-control-file-apps/swift-ios/App/AppFlowFixtureClient.swift"),
            1
        )
        proofPassed(reloadAction, observation: "The exact error is inline and retained content has no duplicate rows")
        capture("source-control-retained-error")

        let retry = assertIdentifier("source-control-recovery-retry")
        XCTAssertEqual(retry.label, "Refresh status")
        let retryAction = proofTap(
            retry,
            selector: "source-control-recovery-retry",
            postcondition: "The error clears and accessibility focus returns to the retained branch"
        )
        XCTAssertTrue(message.waitForNonExistence(timeout: 8))
        XCTAssertTrue(branch.exists)
        XCTAssertEqual(
            identifierCount("source-control-file-apps/swift-ios/App/AppFlowFixtureClient.swift"),
            1
        )
        proofPassed(retryAction, observation: "Recovery cleared the notice, retained one file row, and targeted the branch for accessibility focus")
        capture("source-control-recovered")
    }

    func testBuildChangelogOpensExactSourceThread() {
        launch(scenario: "build-source-thread")
        assertIdentifier("sidebar-settings-button").tap()
        let changelogRow = app.descendants(matching: .any)["Build changelog"].firstMatch
        scrollToHittable(changelogRow)
        changelogRow.tap()

        assertExists("What’s in this build")
        assertExists("Revision 85a11ce · Summaries by app-flow fixture")
        assertExists("Open the exact development thread")
        assertExists("The build changelog now routes back to the thread that produced this build.")
        assertExists("85a11ce")
        capture("build-changelog-source-attribution")

        let openAction = proofTap(
            assertIdentifier("build-changelog-open-source-thread"),
            selector: "build-changelog-open-source-thread",
            postcondition: "The exact existing fixture-main thread opens once"
        )
        assertIdentifier("message-fixture-user")
        assertIdentifier("message-fixture-assistant")
        assertExists("App flow regression audit")
        XCTAssertEqual(identifierCount("message-fixture-user"), 1)
        XCTAssertEqual(identifierCount("message-fixture-assistant"), 1)
        XCTAssertEqual(identifierCount("thread-fixture-working"), 0)
        proofPassed(openAction, observation: "The existing fixture-main conversation opened with each expected message once")
        capture("build-changelog-source-thread")
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
        usesStagedCredentials: Bool = false,
        extraEnvironment: [String: String] = [:]
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
            for (key, value) in extraEnvironment {
                preflight.launchEnvironment[key] = value
            }
            preflight.launch()
            preflight.terminate()
            Self.testedApplicationIsRegistered = true
        }

        app = XCUIApplication()
        app.terminate()
        app.launchEnvironment["T3_APP_FLOW_FIXTURE_SCENARIO"] = scenario
        for (key, value) in extraEnvironment {
            app.launchEnvironment[key] = value
        }
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

    private func openThemeSettings() {
        let settingsButton = assertIdentifier("sidebar-settings-button")
        settingsButton.tap()
        let themesRow = app.descendants(matching: .any)["settings-themes"].firstMatch
        if !themesRow.waitForExistence(timeout: 2) {
            settingsButton.tap()
        }
        XCTAssertTrue(
            themesRow.waitForExistence(timeout: 8),
            "Settings did not open after tapping its Home control"
        )

        themesRow.tap()
        let themesNavigationBar = app.navigationBars["Themes"]
        if !themesNavigationBar.waitForExistence(timeout: 2), themesRow.exists {
            themesRow.tap()
        }
        XCTAssertTrue(
            themesNavigationBar.waitForExistence(timeout: 8),
            "Theme Settings did not open after tapping the Themes row"
        )
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

    private func identifierCount(_ identifier: String) -> Int {
        app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == %@", identifier)
        ).count
    }

    @discardableResult
    private func proofTap(
        _ element: XCUIElement,
        selector: String,
        postcondition: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> String? {
        let applicationFrame = app.frame
        XCTAssertGreaterThan(applicationFrame.width, 0, file: file, line: line)
        XCTAssertGreaterThan(applicationFrame.height, 0, file: file, line: line)
        let point = CGPoint(
            x: min(1, max(0, (element.frame.midX - applicationFrame.minX) / applicationFrame.width)),
            y: min(1, max(0, (element.frame.midY - applicationFrame.minY) / applicationFrame.height))
        )
        let actionID = proofEvents.recordTap(
            selector: selector,
            point: point,
            postcondition: postcondition
        )
        element.tap()
        return actionID
    }

    private func proofPassed(_ actionID: String?, observation: String) {
        proofEvents.recordPassed(actionID: actionID, observation: observation)
    }

    @discardableResult
    private func proofSwipe(
        _ element: XCUIElement,
        selector: String,
        from startOffset: CGVector,
        to endOffset: CGVector,
        duration: TimeInterval,
        postcondition: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> String? {
        let applicationFrame = app.frame
        let elementFrame = element.frame
        XCTAssertGreaterThan(applicationFrame.width, 0, file: file, line: line)
        XCTAssertGreaterThan(applicationFrame.height, 0, file: file, line: line)
        XCTAssertGreaterThan(elementFrame.width, 0, file: file, line: line)
        XCTAssertGreaterThan(elementFrame.height, 0, file: file, line: line)

        func normalizedApplicationPoint(_ offset: CGVector) -> CGPoint {
            CGPoint(
                x: min(
                    1,
                    max(
                        0,
                        (elementFrame.minX + elementFrame.width * offset.dx
                            - applicationFrame.minX) / applicationFrame.width
                    )
                ),
                y: min(
                    1,
                    max(
                        0,
                        (elementFrame.minY + elementFrame.height * offset.dy
                            - applicationFrame.minY) / applicationFrame.height
                    )
                )
            )
        }

        let start = element.coordinate(withNormalizedOffset: startOffset)
        let end = element.coordinate(withNormalizedOffset: endOffset)
        let actionID = proofEvents.recordSwipe(
            selector: selector,
            from: normalizedApplicationPoint(startOffset),
            to: normalizedApplicationPoint(endOffset),
            duration: duration,
            postcondition: postcondition
        )
        start.press(
            forDuration: 0.1,
            thenDragTo: end,
            withVelocity: .slow,
            thenHoldForDuration: 0.1
        )
        return actionID
    }

    private func scrollToHittable(
        _ element: XCUIElement,
        maximumSwipes: Int = 8,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        for _ in 0 ..< maximumSwipes where !element.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(
            element.exists && element.isHittable,
            "Could not scroll element into view: \(element.identifier) \(element.label)",
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
        let navigationBar = app.navigationBars.firstMatch
        XCTAssertTrue(
            navigationBar.exists,
            "Thread navigation bar is unavailable for safe-top measurement",
            file: file,
            line: line
        )
        let safeTop = navigationBar.frame.maxY
        XCTAssertGreaterThanOrEqual(menu.frame.minX, windowFrame.minX, file: file, line: line)
        XCTAssertLessThanOrEqual(menu.frame.maxX, windowFrame.maxX, file: file, line: line)
        XCTAssertGreaterThanOrEqual(
            menu.frame.minY,
            safeTop,
            "Skills popup entered the navigation and safe-top area",
            file: file,
            line: line
        )
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

    @discardableResult
    private func proofDrag(
        from element: XCUIElement,
        offset: CGVector,
        velocity: XCUIGestureVelocity,
        selector: String,
        postcondition: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> String? {
        let applicationFrame = app.frame
        XCTAssertGreaterThan(applicationFrame.width, 0, file: file, line: line)
        XCTAssertGreaterThan(applicationFrame.height, 0, file: file, line: line)
        XCTAssertGreaterThan(element.frame.width, 0, file: file, line: line)
        XCTAssertGreaterThan(element.frame.height, 0, file: file, line: line)
        let startPoint = CGPoint(x: element.frame.midX, y: element.frame.midY)
        let endPoint = CGPoint(x: startPoint.x + offset.dx, y: startPoint.y + offset.dy)

        func normalizedApplicationPoint(_ point: CGPoint) -> CGPoint {
            CGPoint(
                x: min(1, max(0, (point.x - applicationFrame.minX) / applicationFrame.width)),
                y: min(1, max(0, (point.y - applicationFrame.minY) / applicationFrame.height))
            )
        }

        let start = element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let actionID = proofEvents.recordSwipe(
            selector: selector,
            from: normalizedApplicationPoint(startPoint),
            to: normalizedApplicationPoint(endPoint),
            duration: 0.6,
            postcondition: postcondition
        )
        start.press(
            forDuration: 0.15,
            thenDragTo: start.withOffset(offset),
            withVelocity: velocity,
            thenHoldForDuration: 0.1
        )
        return actionID
    }

    private func assertCommandPaletteClosed(
        _ message: String,
        settlingFor settleInterval: TimeInterval = 1,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let drawer = app.descendants(matching: .any)["command-palette-drawer"].firstMatch
        XCTAssertTrue(drawer.waitForNonExistence(timeout: 2), message, file: file, line: line)
        let deadline = Date().addingTimeInterval(settleInterval)
        repeat {
            XCTAssertFalse(drawer.exists, message, file: file, line: line)
            RunLoop.current.run(until: min(deadline, Date().addingTimeInterval(0.1)))
        } while Date() < deadline
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
