import XCTest
@testable import T3Code

final class ThreadMetadataCopyTests: XCTestCase {
    func testCompleteMetadataHasStableLabelsAndOrder() {
        let thread = FeatureThread(
            id: "scoped-thread-id",
            wireID: " thread-1 ",
            projectID: "project-1",
            environmentID: " environment-1 ",
            title: " Copy metadata ",
            branch: " feature/copy-metadata "
        )
        let context = ThreadMetadataCopyContext(
            projectName: " pingdotgg/t3code ",
            environmentName: " Studio Mac "
        )

        let payload = ThreadMetadataCopyModel.payload(for: thread, context: context)

        XCTAssertEqual(
            payload?.text,
            """
            Thread: Copy metadata
            Thread ID: thread-1
            Project: pingdotgg/t3code
            Branch: feature/copy-metadata
            Environment: Studio Mac
            URL: https://app.t3.codes/environment-1/thread-1
            """
        )
        XCTAssertEqual(payload?.confirmation, "Thread metadata copied")
    }

    func testUnavailableMetadataIsOmittedWithoutBlankLines() {
        let thread = FeatureThread(
            id: " scoped-thread-id ",
            wireID: " \n ",
            projectID: "project-1",
            environmentID: nil,
            title: " Fallback identity ",
            branch: "\t"
        )
        let context = ThreadMetadataCopyContext(
            projectName: nil,
            environmentName: "  "
        )

        let payload = ThreadMetadataCopyModel.payload(for: thread, context: context)

        XCTAssertEqual(
            payload?.text,
            """
            Thread: Fallback identity
            Thread ID: scoped-thread-id
            """
        )
        XCTAssertFalse(payload?.text.contains("Project:") ?? true)
        XCTAssertFalse(payload?.text.contains("Branch:") ?? true)
        XCTAssertFalse(payload?.text.contains("Environment:") ?? true)
        XCTAssertFalse(payload?.text.contains("URL:") ?? true)
    }

    func testURLPercentEncodesEachRouteIdentityAsOnePathSegment() {
        let thread = FeatureThread(
            id: "scoped-thread-id",
            wireID: "thread/one",
            projectID: "project-1",
            environmentID: "studio one",
            title: "Encoded route"
        )

        let payload = ThreadMetadataCopyModel.payload(
            for: thread,
            context: ThreadMetadataCopyContext(projectName: nil, environmentName: nil)
        )

        XCTAssertTrue(
            payload?.text.contains("URL: https://app.t3.codes/studio%20one/thread%2Fone") == true
        )
    }

    func testRowContextSuppliesProjectAndEnvironmentURLFallback() throws {
        let thread = FeatureThread(
            id: "scoped-thread-id",
            wireID: "thread-1",
            projectID: "project-1",
            title: "Context metadata"
        )
        let snapshot = FeatureSnapshot(
            environments: [
                FeatureEnvironment(
                    id: "environment-1",
                    name: "Studio Mac",
                    endpoint: "https://studio.example"
                ),
            ],
            projects: [
                FeatureProject(
                    id: "project-1",
                    environmentID: "environment-1",
                    name: "t3code",
                    path: "/work/t3code"
                ),
            ],
            threads: [thread]
        )
        let rowContext = try XCTUnwrap(
            HomeThreadRowContext.index(snapshot: snapshot)[thread.id]
        )

        let payload = ThreadMetadataCopyModel.payload(
            for: thread,
            context: rowContext.metadataCopyContext
        )

        XCTAssertTrue(payload?.text.contains("Project: t3code") == true)
        XCTAssertTrue(payload?.text.contains("Environment: Studio Mac") == true)
        XCTAssertTrue(
            payload?.text.contains("URL: https://app.t3.codes/environment-1/thread-1") == true
        )
    }

    func testReusedRowRequestUsesCurrentThread() {
        let first = FeatureThread(
            id: "first",
            wireID: "wire-first",
            projectID: "project-1",
            environmentID: "environment-1",
            title: "First",
            branch: "feature/first"
        )
        let second = FeatureThread(
            id: "second",
            wireID: "wire-second",
            projectID: "project-2",
            environmentID: "environment-2",
            title: "Second",
            branch: "feature/second"
        )

        let firstPayload = ThreadMetadataCopyModel.payload(
            for: first,
            context: ThreadMetadataCopyContext(
                projectName: "One",
                environmentName: "Mac One"
            )
        )
        let secondPayload = ThreadMetadataCopyModel.payload(
            for: second,
            context: ThreadMetadataCopyContext(
                projectName: "Two",
                environmentName: "Mac Two"
            )
        )

        XCTAssertTrue(firstPayload?.text.contains("wire-first") == true)
        XCTAssertFalse(firstPayload?.text.contains("Second") ?? true)
        XCTAssertTrue(secondPayload?.text.contains("wire-second") == true)
        XCTAssertFalse(secondPayload?.text.contains("First") ?? true)
    }

    func testNoAvailableValuesProducesNoPayload() {
        let thread = FeatureThread(
            id: " \n ",
            wireID: nil,
            projectID: "project-1",
            title: "\t",
            branch: nil
        )

        XCTAssertNil(
            ThreadMetadataCopyModel.payload(
                for: thread,
                context: ThreadMetadataCopyContext(projectName: nil, environmentName: nil)
            )
        )
    }
}
