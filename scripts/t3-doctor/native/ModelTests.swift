import Foundation

struct CheckFailure: Error { let message: String }

@main
enum ModelTests {
    static func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw CheckFailure(message: message) }
        print("PASS \(message)")
    }

    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("t3-doctor-native-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("incidents"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let status = #"""
        {"checked_at":"2027-01-15T08:00:00Z","server":{"state":"reachable"},
         "active":[{"thread_id":"t","run_id":"r","title":"Build app","provider":"codex","status":"running","quiet_seconds":8}],
         "waiting":[{"thread_id":"q","provider_name":"claude","pending_approval_count":1}],
         "findings":[{"key":"run:r","kind":"quiet-run","reason":"Quiet","thread_id":"t","evidence":{"run":{"run_id":"r","title":"Build app"}}}],
         "incidents":{"run:r":{"report":"/saved.json"}},"monitoring":{"interval":30,"quiet":900,"startup":180}}
        """#
        let statusURL = root.appendingPathComponent("status.json")
        try status.write(to: statusURL, atomically: true, encoding: .utf8)
        let repository = DoctorRepository(directory: root)
        let snapshot = await repository.read()
        guard let observation = snapshot.observation else { throw CheckFailure(message: snapshot.error ?? "No observation") }
        try check(observation.runs.count == 2 && observation.active[0].displayProvider == "codex", "decode live and legacy run fields")
        try check(observation.waiting[0].waitingReason == "Waiting for approval", "approval wait remains explicit")
        try check(observation.attention == 1, "confirmed finding is counted once")
        try check(observation.currentFindings[0].matches(observation.active[0]), "nested evidence retains its run ID")
        try check(!observation.isStale(at: now) && observation.isStale(at: now.addingTimeInterval(120)), "stale observations are detected")
        try check(parseDate("2026-09-18T01:08:53.819944+00:00") != nil && elapsed(900) == "15m 0s", "timestamp and duration formatting")
        let reportURL = root.appendingPathComponent("incidents/20260918T100000-1234567890abcdef.json")
        let report = #"{"key":"run:r","kind":"quiet-run","reason":"Quiet","evidence":{"run":{"title":"Native incident"}},"logs":{"provider.log":["A line of evidence"]}}"#
        try report.write(to: reportURL, atomically: true, encoding: .utf8)
        let withReport = await repository.read()
        try check(withReport.reports.first?.title == "No progress recorded" && withReport.reports.first?.subject == "Native incident", "incident summaries load from disk")
        let detail = try DoctorRepository.readReport(reportURL)
        try check(detail["logs"]["provider.log"].list.first?.text == "A line of evidence", "captured logs remain available as text")
        try report.replacingOccurrences(of: "\"key\":", with: "\"resolved_at\":\"2026-09-18T10:05:00Z\",\"key\":").write(to: reportURL, atomically: true, encoding: .utf8)
        let resolved = await repository.read()
        try check(resolved.reports.first?.resolved == true, "cached report notices resolution")
        try "broken".write(to: reportURL, atomically: true, encoding: .utf8)
        let brokenReport = await repository.read()
        try check(brokenReport.observation != nil && brokenReport.reportErrors.count == 1, "one broken report does not hide current observations")
        try FileManager.default.removeItem(at: statusURL)
        let missingStatus = await repository.read()
        try check(missingStatus.observation == nil && missingStatus.error != nil, "missing status cannot appear healthy")
        let provider = #"{"id":"work","name":"Work","driver":"codex","enabled":true,"state":"stale","auth":"unknown","message":"Diagnostic is old","source":"T3 diagnostics","active_runs":2}"#
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let health = try decoder.decode(ProviderHealth.self, from: Data(provider.utf8))
        try check(health.state == "stale" && health.activeRuns == 2, "provider readiness and active runs decode")
        let release = #"{"id":"server","name":"T3 server","state":"update_available","installed_version":"1.0.0","latest_version":"1.0.1","message":"Newer version available","release_url":"https://github.com/example/t3/releases"}"#
        let update = try decoder.decode(AppVersionCheck.self, from: Data(release.utf8))
        try check(update.latestVersion == "1.0.1" && update.releaseUrl != nil, "release comparison and link decode")
        let providerEvidence = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"name":"Work","auth":"unknown","binary_found":true,"version":"1.2.3"}"#.utf8))
        let readable = evidenceSummary(kind: "provider-warning", evidence: providerEvidence)
        try check(readable.facts.contains { $0.label == "Authentication" && $0.value == "Not verified by T3" }, "provider evidence explains unknown authentication")
        try check(readable.nextStep.contains("not proof"), "provider guidance does not claim an outage")
        let quietEvidence = try JSONDecoder().decode(JSONValue.self, from: Data(#"{"run":{"title":"Build","quiet_seconds":950,"status":"running"}}"#.utf8))
        try check(evidenceSummary(kind: "quiet-run", evidence: quietEvidence).facts.contains { $0.value == "15m 50s" }, "quiet-run evidence shows a readable duration")
        let trackedStatus = #"""
        {"checked_at":"2027-01-15T08:00:00Z","active":[],"waiting":[],
         "findings":[{"key":"a","kind":"overdue-worker","reason":"Quiet","fingerprint":"same","triage":{"status":"in_progress"}},
                     {"key":"b","kind":"overdue-worker","reason":"Quiet","fingerprint":"same","triage":{"status":"in_progress"}}],
         "incidents":{"a":{"fingerprint":"same","triage":{"status":"in_progress"}}}}
        """#
        let tracked = try decoder.decode(Observation.self, from: Data(trackedStatus.utf8))
        try check(tracked.attention == 0 && tracked.handled == 1 && tracked.currentFindings.count == 2, "handled duplicates remain observed and count as one issue")
        let reopened = try decoder.decode(Observation.self, from: Data(trackedStatus.replacingOccurrences(of: "in_progress", with: "needs_attention").utf8))
        try check(reopened.attention == 1 && reopened.handled == 0, "reopened duplicate incidents return to attention once")
        let linkedReport = #"{"key":"a","kind":"provider-warning","reason":"Unverified","fingerprint":"same","triage":{"status":"assigned","assignee":"Alex"},"investigation":{"thread_id":"diagnostic","prompt_sha256":"hash","stage":"verified"}}"#
        try linkedReport.write(to: reportURL, atomically: true, encoding: .utf8)
        let persisted = await repository.read()
        try check(persisted.reports.first?.investigation?.threadId == "diagnostic" && persisted.reports.first?.fingerprint == "same", "saved incident retains investigation and fingerprint")
        try check(persisted.reports.first?.handlingLabel == "Assigned" && persisted.reports.first?.resolved == false, "assignment does not claim recovery")
        let assessment = try decoder.decode(RelatedAssessment.self, from: Data(#"{"checked_at":"2026-09-18T10:00:00Z","compared":2,"model":"jev-test","matches":[{"fingerprint":"candidate","score":0.93,"thread_id":"diagnostic","title":"Authentication","reason":"Login renewal failed"}]}"#.utf8))
        try check(assessment.matches.first?.threadId == "diagnostic" && assessment.matches.first?.score == 0.93 && assessment.compared == 2, "Jev suggestions decode their score and existing thread link")
        try check(findingTitle(kind: "provider-warning", evidence: providerEvidence, reason: "Unverified") == "Provider authentication not verified", "finding heading describes the observed symptom")
        let oldUpdates = #"{"checked_at":"2027-01-15T08:00:00Z","active":[],"waiting":[],"findings":[{"key":"update:desktop:1","kind":"app-update","reason":"New release"}],"incidents":{"update:desktop:1":{"triage":{"status":"in_progress"}}}}"#
        let migratedObservation = try decoder.decode(Observation.self, from: Data(oldUpdates.utf8))
        try check(migratedObservation.currentFindings.isEmpty && migratedObservation.attention == 0 && migratedObservation.handled == 0, "legacy updates are excluded from findings and handling counts")
        let diverged = try decoder.decode(AppVersionCheck.self, from: Data(#"{"id":"desktop","name":"T3 desktop","state":"release_available","message":"Different channel","commit_status":"diverged","commits_behind":656,"commits_ahead":479}"#.utf8))
        try check(diverged.statusTitle == "Build histories differ" && diverged.commitDistance.contains("479 only in installed build"), "diverged histories do not imply a simple upgrade distance")
        let historyUpdate = #"{"key":"update:desktop:1","kind":"app-update","reason":"New release"}"#
        try historyUpdate.write(to: reportURL, atomically: true, encoding: .utf8)
        let filteredHistory = await repository.read()
        try check(filteredHistory.reports.isEmpty, "update reports are excluded from incident history")
        if CommandLine.arguments.contains("--live") {
            let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/state/t3-doctor")
            let live = await DoctorRepository(directory: directory).read()
            guard let observation = live.observation else { throw CheckFailure(message: live.error ?? "Live decode failed") }
            print("LIVE: \(observation.runs.count) runs, \(observation.currentFindings.count) findings, \(live.reports.count) reports, \(live.reportErrors.count) report errors")
        }
    }
}
