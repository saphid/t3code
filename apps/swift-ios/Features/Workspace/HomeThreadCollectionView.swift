import SwiftUI
import UIKit

enum HomeThreadSwipeActionKind: Equatable {
    case delete
    case restore
    case unpin
    case settle
    case reopen
    case archive
}

enum HomeThreadSwipeActions {
    static func kinds(
        for thread: FeatureThread,
        isArchived: Bool,
        now: Date
    ) -> [HomeThreadSwipeActionKind] {
        if isArchived {
            return [.restore, .delete]
        }

        var kinds: [HomeThreadSwipeActionKind] = []
        if thread.canToggleSettlement {
            kinds.append(thread.isEffectivelySettled(at: now) ? .reopen : .settle)
        }
        if thread.pinnedAt != nil, thread.canTogglePin {
            kinds.append(.unpin)
        }
        if kinds.isEmpty {
            kinds.append(.archive)
        }
        kinds.append(.delete)
        return kinds
    }
}

struct HomeThreadPendingMetadataRefreshes<Identifier: Hashable> {
    private(set) var identifiers = Set<Identifier>()

    mutating func recordCompletion(
        matching: Set<Identifier>,
        refreshed: Set<Identifier>
    ) {
        identifiers.formUnion(matching.subtracting(refreshed))
    }

    mutating func consume(_ identifier: Identifier) -> Bool {
        identifiers.remove(identifier) != nil
    }

    mutating func prune(to current: Set<Identifier>) {
        identifiers.formIntersection(current)
    }
}

/// A recycled, diffable Home surface. SwiftUI still owns the surrounding shell,
/// while UIKit keeps row creation and updates proportional to visible threads.
struct HomeThreadCollectionView: UIViewRepresentable {
    let presentation: HomePresentation
    let projectFaviconClient: any FeatureClient
    let query: String
    let selectedThreadID: String?
    let forceRichRows: Bool
    let showThreadDoneDuration: Bool
    let isSnoozedExpanded: Bool
    let isSettledExpanded: Bool
    let isArchiveExpanded: Bool
    let settledLimit: Int
    let onOpen: (String) -> Void
    let onToggleSnoozed: () -> Void
    let onToggleSettled: () -> Void
    let onToggleArchive: () -> Void
    let onShowMoreSettled: () -> Void
    let regeneratingThreadIDs: Set<String>
    let canCreateThread: (FeatureThread) -> Bool
    let onNewThreadOnBranch: (FeatureThread) -> Void
    let onRename: (FeatureThread) -> Void
    let onRegenerateTitle: (FeatureThread) -> Void
    let onArchive: (FeatureThread, Bool) -> Void
    let onSettle: (FeatureThread, Bool) -> Void
    let onSnooze: (FeatureThread, Date?) -> Void
    let onPin: (FeatureThread, Bool) -> Void
    let canCopyPath: (FeatureThread) -> Bool
    let onCopyPath: (FeatureThread) -> Void
    let onCopyBranch: (FeatureThread) -> Void
    let onCopyThreadID: (FeatureThread) -> Void
    let onDelete: (FeatureThread) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UICollectionView {
        var configuration = UICollectionLayoutListConfiguration(appearance: .plain)
        configuration.backgroundColor = T3Colors.uiBackground
        configuration.showsSeparators = false
        configuration.headerMode = .none
        configuration.footerMode = .none
        configuration.trailingSwipeActionsConfigurationProvider = { [weak coordinator = context.coordinator] indexPath in
            coordinator?.trailingSwipeActions(at: indexPath)
        }

        let collectionView = UICollectionView(
            frame: .zero,
            collectionViewLayout: UICollectionViewCompositionalLayout.list(using: configuration)
        )
        collectionView.backgroundColor = T3Colors.uiBackground
        collectionView.alwaysBounceVertical = true
        collectionView.keyboardDismissMode = .interactive
        collectionView.contentInset = UIEdgeInsets(top: 4, left: 0, bottom: 74, right: 0)
        collectionView.verticalScrollIndicatorInsets = UIEdgeInsets(top: 4, left: 0, bottom: 74, right: 0)
        collectionView.delegate = context.coordinator
        context.coordinator.configure(collectionView)
        return collectionView
    }

    func updateUIView(_ collectionView: UICollectionView, context: Context) {
        context.coordinator.update(parent: self, collectionView: collectionView)
    }

    static func dismantleUIView(_ collectionView: UICollectionView, coordinator: Coordinator) {
        coordinator.invalidateTimer()
        coordinator.invalidatePullRequestLookups()
        coordinator.invalidatePullRequestObserver()
        collectionView.delegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, UICollectionViewDelegate {
        private enum Section: Hashable {
            case main
        }

        private var parent: HomeThreadCollectionView
        private var dataSource: UICollectionViewDiffableDataSource<Section, HomeCollectionItem.ID>?
        private var registration: UICollectionView.CellRegistration<HomeCollectionCell, HomeCollectionItem.ID>?
        private var itemsByID: [HomeCollectionItem.ID: HomeCollectionItem] = [:]
        private var pullRequestIdentifiersByKey: [
            PullRequestLookupKey: Set<HomeCollectionItem.ID>
        ] = [:]
        private var selectedThreadID: String?
        private weak var collectionView: UICollectionView?
        private var timer: Timer?
        private var timerTick = 0
        private var timerInterval: TimeInterval = 0
        private var pullRequestCache: [PullRequestLookupKey: PullRequestCacheEntry] = [:]
        private var stalePullRequestKeys = Set<PullRequestLookupKey>()
        private var pullRequestQueue: [PullRequestLookupRequest] = []
        private var pullRequestWorker: Task<Void, Never>?
        private var activePullRequestLookupKey: PullRequestLookupKey?
        private var pendingPullRequestRefreshes = HomeThreadPendingMetadataRefreshes<
            HomeCollectionItem.ID
        >()
        private var foregroundObserver: NSObjectProtocol?

        init(parent: HomeThreadCollectionView) {
            self.parent = parent
            selectedThreadID = parent.selectedThreadID
        }

        func configure(_ collectionView: UICollectionView) {
            self.collectionView = collectionView
            foregroundObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.willEnterForegroundNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.refreshPullRequestsAfterForeground()
                }
            }

            let registration = UICollectionView.CellRegistration<HomeCollectionCell, HomeCollectionItem.ID> {
                [weak self] cell, _, identifier in
                self?.configure(cell, identifier: identifier, now: .now)
            }
            self.registration = registration

            dataSource = UICollectionViewDiffableDataSource<Section, HomeCollectionItem.ID>(
                collectionView: collectionView
            ) { [weak self] collectionView, indexPath, identifier in
                guard let self, let registration = self.registration else { return nil }
                return collectionView.dequeueConfiguredReusableCell(
                    using: registration,
                    for: indexPath,
                    item: identifier
                )
            }

            update(parent: parent, collectionView: collectionView)
        }

        func update(parent: HomeThreadCollectionView, collectionView: UICollectionView) {
            let previousItems = itemsByID
            let previousSelection = selectedThreadID
            let doneDurationPreferenceChanged =
                self.parent.showThreadDoneDuration != parent.showThreadDoneDuration
            self.parent = parent
            selectedThreadID = parent.selectedThreadID

            var seenIdentifiers = Set<HomeCollectionItem.ID>()
            let items = parent.collectionItems.filter { item in
                seenIdentifiers.insert(item.id).inserted
            }
            itemsByID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
            pullRequestIdentifiersByKey = items.reduce(into: [:]) { index, item in
                guard case let .thread(thread, _, _, _, _) = item else { return }
                index[PullRequestLookupKey(thread: thread), default: []].insert(item.id)
            }
            pendingPullRequestRefreshes.prune(to: Set(items.map(\.id)))
            prunePullRequestLookups()
            // After items land: picks 1 Hz when a working thread is present,
            // 60s otherwise, and is a no-op when the interval is unchanged.
            startTimer()

            guard let dataSource else { return }
            let currentIdentifiers = dataSource.snapshot().itemIdentifiers
            let newIdentifiers = items.map(\.id)

            if currentIdentifiers == newIdentifiers {
                let changed = newIdentifiers.filter { previousItems[$0] != itemsByID[$0] }
                let selectionChanged = [previousSelection, selectedThreadID]
                    .compactMap { $0.map(HomeCollectionItem.ID.thread) }
                    .filter { newIdentifiers.contains($0) }
                let preferenceChanged = doneDurationPreferenceChanged
                    ? doneIdentifiers(in: newIdentifiers)
                    : []
                let identifiers = Array(Set(changed + selectionChanged + preferenceChanged))
                if !identifiers.isEmpty {
                    var snapshot = dataSource.snapshot()
                    snapshot.reconfigureItems(identifiers)
                    dataSource.apply(snapshot, animatingDifferences: false)
                }
            } else {
                var snapshot = NSDiffableDataSourceSnapshot<Section, HomeCollectionItem.ID>()
                snapshot.appendSections([.main])
                snapshot.appendItems(newIdentifiers, toSection: .main)
                if doneDurationPreferenceChanged {
                    snapshot.reconfigureItems(doneIdentifiers(in: newIdentifiers))
                }
                dataSource.apply(snapshot, animatingDifferences: false)
            }

            synchronizeSelection(in: collectionView)
        }

        func invalidateTimer() {
            timer?.invalidate()
            timer = nil
        }

        func invalidatePullRequestLookups() {
            pullRequestWorker?.cancel()
            pullRequestWorker = nil
            activePullRequestLookupKey = nil
            pullRequestQueue.removeAll()
        }

        func invalidatePullRequestObserver() {
            guard let foregroundObserver else { return }
            NotificationCenter.default.removeObserver(foregroundObserver)
            self.foregroundObserver = nil
        }

        private func refreshPullRequestsAfterForeground() {
            invalidatePullRequestLookups()
            stalePullRequestKeys.formUnion(pullRequestCache.keys)
            refreshVisibleRows()
        }

        private func refreshVisibleRows() {
            guard let collectionView, let dataSource else { return }
            for indexPath in collectionView.indexPathsForVisibleItems {
                guard let identifier = dataSource.itemIdentifier(for: indexPath),
                      let cell = collectionView.cellForItem(at: indexPath) as? HomeCollectionCell else {
                    continue
                }
                configure(cell, identifier: identifier, now: .now)
            }
        }

        func collectionView(
            _ collectionView: UICollectionView,
            willDisplay cell: UICollectionViewCell,
            forItemAt indexPath: IndexPath
        ) {
            guard let dataSource,
                  let identifier = dataSource.itemIdentifier(for: indexPath),
                  let cell = cell as? HomeCollectionCell,
                  pendingPullRequestRefreshes.consume(identifier) else { return }
            configure(cell, identifier: identifier, now: .now)
        }

        func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
            guard let item = item(at: indexPath) else { return }
            switch item {
            case let .thread(thread, _, _, _, _):
                let previousSelection = selectedThreadID
                selectedThreadID = thread.id
                parent.onOpen(thread.id)
                refreshSelection(
                    in: collectionView,
                    ids: [previousSelection, thread.id].compactMap { $0 }
                )
            case let .shelfHeader(shelf, _, _):
                collectionView.deselectItem(at: indexPath, animated: false)
                toggle(shelf)
            case .showMoreSettled:
                collectionView.deselectItem(at: indexPath, animated: false)
                parent.onShowMoreSettled()
            case .empty, .searchEmpty, .pinnedDivider:
                collectionView.deselectItem(at: indexPath, animated: false)
            }
        }

        func collectionView(
            _ collectionView: UICollectionView,
            contextMenuConfigurationForItemAt indexPath: IndexPath,
            point: CGPoint
        ) -> UIContextMenuConfiguration? {
            guard case let .thread(thread, _, _, isArchived, _) = item(at: indexPath) else {
                return nil
            }

            return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
                guard let self else { return nil }
                return UIMenu(children: self.menuActions(for: thread, isArchived: isArchived))
            }
        }

        func trailingSwipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
            guard case let .thread(thread, _, _, isArchived, _) = item(at: indexPath) else {
                return nil
            }

            let actions = HomeThreadSwipeActions.kinds(
                for: thread,
                isArchived: isArchived,
                now: .now
            ).map { swipeAction($0, for: thread) }
            let configuration = UISwipeActionsConfiguration(actions: actions)
            configuration.performsFirstActionWithFullSwipe = true
            return configuration
        }

        private func swipeAction(
            _ kind: HomeThreadSwipeActionKind,
            for thread: FeatureThread
        ) -> UIContextualAction {
            switch kind {
            case .delete:
                let action = UIContextualAction(style: .destructive, title: "Delete") {
                    [weak self] _, _, finish in
                    self?.parent.onDelete(thread)
                    finish(true)
                }
                action.image = UIImage(systemName: "trash")
                return action
            case .restore:
                let action = UIContextualAction(style: .normal, title: "Restore") {
                    [weak self] _, _, finish in
                    self?.parent.onArchive(thread, false)
                    finish(true)
                }
                action.image = UIImage(systemName: "arrow.uturn.backward")
                action.backgroundColor = .systemBlue
                return action
            case .unpin:
                let action = UIContextualAction(style: .normal, title: "Unpin") {
                    [weak self] _, _, finish in
                    self?.parent.onPin(thread, false)
                    finish(true)
                }
                action.image = UIImage(systemName: "pin.slash")
                action.backgroundColor = .systemBlue
                return action
            case .settle, .reopen:
                let isSettled = kind == .reopen
                let action = UIContextualAction(
                    style: .normal,
                    title: isSettled ? "Reopen" : "Settle"
                ) { [weak self] _, _, finish in
                    self?.parent.onSettle(thread, !isSettled)
                    finish(true)
                }
                action.image = UIImage(
                    systemName: isSettled ? "arrow.counterclockwise" : "checkmark"
                )
                action.backgroundColor = isSettled ? .systemBlue : .systemGreen
                return action
            case .archive:
                let action = UIContextualAction(style: .normal, title: "Archive") {
                    [weak self] _, _, finish in
                    self?.parent.onArchive(thread, true)
                    finish(true)
                }
                action.image = UIImage(systemName: "archivebox")
                action.backgroundColor = .systemGray
                return action
            }
        }

        private func configure(
            _ cell: HomeCollectionCell,
            identifier: HomeCollectionItem.ID,
            now: Date
        ) {
            guard let item = itemsByID[identifier] else { return }
            _ = pendingPullRequestRefreshes.consume(identifier)
            let resolvedPullRequest: FeaturePullRequest?
            if case let .thread(thread, _, _, _, _) = item {
                loadPullRequestIfNeeded(for: thread)
                resolvedPullRequest = pullRequest(for: thread)
            } else {
                resolvedPullRequest = nil
            }
            cell.contentConfiguration = UIHostingConfiguration {
                HomeCollectionCellContent(
                    item: item,
                    projectFaviconClient: parent.projectFaviconClient,
                    isSelected: identifier.threadID == selectedThreadID,
                    now: now,
                    pullRequest: resolvedPullRequest,
                    showThreadDoneDuration: parent.showThreadDoneDuration
                )
            }
            .margins(.all, 0)

            cell.backgroundConfiguration = UIBackgroundConfiguration.clear()
            cell.accessories = []
            cell.tintColor = T3Colors.uiTextPrimary
            cell.contentView.accessibilityElementsHidden = true
            configureAccessibility(cell, item: item, now: now)
        }

        private func pullRequest(for thread: FeatureThread) -> FeaturePullRequest? {
            let key = PullRequestLookupKey(thread: thread)
            return pullRequestCache[key]?.pullRequest
        }

        private func loadPullRequestIfNeeded(for thread: FeatureThread) {
            let key = PullRequestLookupKey(thread: thread)
            guard key.branch != nil else { return }
            // sourceControlStatus is an explicit, cache-busting server refresh.
            // Resolve each checkout identity only once while this Home
            // coordinator lives; row timer ticks must never become VCS polling.
            guard pullRequestCache[key] == nil || stalePullRequestKeys.remove(key) != nil else { return }
            guard pullRequestQueue.allSatisfy({ $0.key != key }),
                  activePullRequestLookupKey != key else { return }

            pullRequestQueue.append(PullRequestLookupRequest(key: key, thread: thread))
            startNextPullRequestLookup()
        }

        private func startNextPullRequestLookup() {
            guard pullRequestWorker == nil else { return }
            guard !pullRequestQueue.isEmpty else { return }
            // Requests enter this queue only while UIKit is configuring an
            // on-screen cell, including initial configuration before UIKit has
            // published its visible index paths.
            let request = pullRequestQueue.removeFirst()

            let client = parent.projectFaviconClient
            activePullRequestLookupKey = request.key
            pullRequestWorker = Task { [weak self] in
                let result: Result<FeaturePullRequest?, Error>
                do {
                    let status = try await client.sourceControlStatus(threadID: request.thread.id)
                    result = .success(HomeThreadPullRequest.related(to: request.thread, in: status))
                } catch {
                    result = .failure(error)
                }
                guard !Task.isCancelled, let self else { return }
                pullRequestWorker = nil
                activePullRequestLookupKey = nil
                switch result {
                case let .success(pullRequest):
                    pullRequestCache[request.key] = PullRequestCacheEntry(pullRequest: pullRequest)
                case .failure:
                    // A failed explicit refresh is terminal until Home is
                    // foregrounded again, avoiding a background failure loop.
                    pullRequestCache[request.key] = PullRequestCacheEntry(pullRequest: nil)
                }
                refreshThreadRows(matching: request.key)
                startNextPullRequestLookup()
            }
        }

        private func refreshThreadRows(matching key: PullRequestLookupKey) {
            guard let collectionView, let dataSource else { return }

            // Pull-request lookups complete one row at a time during cold launch.
            // Reapplying the diffable snapshot for every result repeatedly resets
            // collection-view interaction while the user is starting a scroll.
            // Live cells consume metadata directly without touching the
            // diffable snapshot. Rows without a cell refresh when UIKit next
            // displays them, keeping lookup completion out of scroll handling.
            let matchingIdentifiers = pullRequestIdentifiersByKey[key] ?? []
            var refreshedIdentifiers = Set<HomeCollectionItem.ID>()
            for identifier in matchingIdentifiers {
                guard let indexPath = dataSource.indexPath(for: identifier),
                      let cell = collectionView.cellForItem(at: indexPath)
                          as? HomeCollectionCell else {
                    continue
                }
                configure(cell, identifier: identifier, now: .now)
                refreshedIdentifiers.insert(identifier)
            }
            pendingPullRequestRefreshes.recordCompletion(
                matching: matchingIdentifiers,
                refreshed: refreshedIdentifiers
            )
        }

        private func prunePullRequestLookups() {
            let validKeys = Set(parent.presentation.allThreads.map(PullRequestLookupKey.init))
            pullRequestCache = pullRequestCache.filter { validKeys.contains($0.key) }
            stalePullRequestKeys.formIntersection(validKeys)
            pullRequestQueue.removeAll { !validKeys.contains($0.key) }
            if let activePullRequestLookupKey,
               !validKeys.contains(activePullRequestLookupKey) {
                pullRequestWorker?.cancel()
                pullRequestWorker = nil
                self.activePullRequestLookupKey = nil
                startNextPullRequestLookup()
            }
        }

        private func configureAccessibility(
            _ cell: HomeCollectionCell,
            item: HomeCollectionItem,
            now: Date
        ) {
            switch item {
            case let .thread(thread, context, _, _, _):
                cell.isAccessibilityElement = true
                cell.accessibilityTraits = selectedThreadID == thread.id
                    ? [.button, .selected]
                    : .button
                cell.accessibilityLabel = thread.title
                let baseValue = threadAccessibilityValue(thread, context: context, now: now)
                cell.accessibilityHint = "Opens task"
                if let pullRequest = pullRequest(for: thread),
                   let url = pullRequest.safeExternalURL {
                    cell.accessibilityValue = "\(baseValue). Pull request \(pullRequest.number), \(pullRequest.state)."
                    cell.accessibilityCustomActions = [
                        UIAccessibilityCustomAction(
                            name: "Open pull request \(pullRequest.number), \(pullRequest.state)"
                        ) { _ in
                            UIApplication.shared.open(url)
                            return true
                        },
                    ]
                } else {
                    cell.accessibilityValue = baseValue
                    cell.accessibilityCustomActions = nil
                }
                cell.onAccessibilityActivate = { [weak self] in
                    guard let self else { return }
                    let previousSelection = self.selectedThreadID
                    self.selectedThreadID = thread.id
                    self.parent.onOpen(thread.id)
                    if let collectionView = self.collectionView {
                        self.refreshSelection(
                            in: collectionView,
                            ids: [previousSelection, thread.id].compactMap { $0 }
                        )
                    }
                }
            case let .shelfHeader(shelf, count, isExpanded):
                cell.accessibilityCustomActions = nil
                cell.isAccessibilityElement = true
                cell.accessibilityTraits = .button
                cell.accessibilityLabel = "\(shelf.title), \(count) tasks"
                cell.accessibilityValue = isExpanded ? "Expanded" : "Collapsed"
                cell.accessibilityHint = nil
                cell.onAccessibilityActivate = { [weak self] in self?.toggle(shelf) }
            case let .showMoreSettled(remaining):
                cell.accessibilityCustomActions = nil
                cell.isAccessibilityElement = true
                cell.accessibilityTraits = .button
                cell.accessibilityLabel = "Show \(remaining) more settled tasks"
                cell.accessibilityValue = nil
                cell.accessibilityHint = nil
                cell.onAccessibilityActivate = { [weak self] in
                    self?.parent.onShowMoreSettled()
                }
            case let .empty(shelf):
                cell.accessibilityCustomActions = nil
                cell.isAccessibilityElement = true
                cell.accessibilityTraits = .staticText
                cell.accessibilityLabel = shelf == .active ? "No active tasks" : "No \(shelf.title.lowercased()) tasks"
                cell.accessibilityValue = nil
                cell.accessibilityHint = nil
                cell.onAccessibilityActivate = nil
            case .searchEmpty:
                cell.accessibilityCustomActions = nil
                cell.isAccessibilityElement = true
                cell.accessibilityTraits = .staticText
                cell.accessibilityLabel = "No matching tasks"
                cell.accessibilityValue = nil
                cell.accessibilityHint = nil
                cell.onAccessibilityActivate = nil
            case .pinnedDivider:
                cell.accessibilityCustomActions = nil
                cell.isAccessibilityElement = false
                cell.onAccessibilityActivate = nil
            }
        }

        private func threadAccessibilityValue(
            _ thread: FeatureThread,
            context: HomeThreadRowContext,
            now: Date
        ) -> String {
            var values = [thread.homeStatusLabel ?? "Ready", "Project \(context.projectName)"]
            values.append("Harness \(context.providerName)")
            if let duration = thread.homeWorkingDuration(at: now) {
                values.append("for \(duration)")
            }
            if parent.showThreadDoneDuration,
               let duration = thread.homeDoneAccessibilityDuration(at: now) {
                values.append("done for \(duration)")
            }
            if let environment = context.environmentLabel {
                values.append("on \(environment)")
            }
            return values.joined(separator: ". ")
        }

        private func synchronizeSelection(in collectionView: UICollectionView) {
            for indexPath in collectionView.indexPathsForSelectedItems ?? [] {
                guard dataSource?.itemIdentifier(for: indexPath)?.threadID != selectedThreadID else {
                    continue
                }
                collectionView.deselectItem(at: indexPath, animated: false)
            }
            guard let selectedThreadID,
                  let indexPath = dataSource?.indexPath(for: .thread(selectedThreadID)),
                  !collectionView.indexPathsForSelectedItems.orEmpty.contains(indexPath) else {
                return
            }
            collectionView.selectItem(at: indexPath, animated: false, scrollPosition: [])
        }

        private func refreshSelection(in collectionView: UICollectionView, ids: [String]) {
            for id in ids {
                guard let indexPath = dataSource?.indexPath(for: .thread(id)),
                      let cell = collectionView.cellForItem(at: indexPath) as? HomeCollectionCell else {
                    continue
                }
                configure(cell, identifier: .thread(id), now: .now)
            }
        }

        private func item(at indexPath: IndexPath) -> HomeCollectionItem? {
            guard let identifier = dataSource?.itemIdentifier(for: indexPath) else { return nil }
            return itemsByID[identifier]
        }

        private func toggle(_ shelf: HomeShelf) {
            switch shelf {
            case .snoozed: parent.onToggleSnoozed()
            case .settled: parent.onToggleSettled()
            case .archived: parent.onToggleArchive()
            case .active: break
            }
        }

        private func menuActions(for thread: FeatureThread, isArchived: Bool) -> [UIMenuElement] {
            let sections = ThreadContextMenuModel.sections(
                for: thread,
                isArchived: isArchived,
                canCreateThread: parent.canCreateThread(thread),
                canCopyPath: parent.canCopyPath(thread)
            )
            return sections.map { section in
                UIMenu(
                    options: .displayInline,
                    children: menuElements(for: section, thread: thread)
                )
            }
        }

        private func menuElements(
            for items: [ThreadContextMenuItem],
            thread: FeatureThread
        ) -> [UIMenuElement] {
            items.map { item in
                switch item {
                case let .newThread(branch):
                    return UIAction(
                        title: "New thread on \(branch)",
                        image: UIImage(systemName: "plus.bubble")
                    ) { [weak self] _ in
                        self?.parent.onNewThreadOnBranch(thread)
                    }
                case .rename:
                    return UIAction(
                        title: "Rename thread",
                        image: UIImage(systemName: "pencil")
                    ) { [weak self] _ in
                        self?.parent.onRename(thread)
                    }
                case .regenerateTitle:
                    let action = UIAction(
                        title: parent.regeneratingThreadIDs.contains(thread.id)
                            ? "Regenerating…"
                            : "Regenerate title",
                        image: UIImage(systemName: "sparkles")
                    ) { [weak self] _ in
                        self?.parent.onRegenerateTitle(thread)
                    }
                    if parent.regeneratingThreadIDs.contains(thread.id) {
                        action.attributes = .disabled
                    }
                    return action
                case let .archive(archived):
                    return UIAction(
                        title: archived ? "Restore" : "Archive",
                        image: UIImage(
                            systemName: archived ? "arrow.uturn.backward" : "archivebox"
                        )
                    ) { [weak self] _ in
                        self?.parent.onArchive(thread, !archived)
                    }
                case let .pin(pinned):
                    return UIAction(
                        title: pinned ? "Unpin thread" : "Pin thread",
                        image: UIImage(systemName: pinned ? "pin.slash" : "pin")
                    ) { [weak self] _ in
                        self?.parent.onPin(thread, !pinned)
                    }
                case let .settle(settled):
                    return UIAction(
                        title: settled ? "Reopen thread" : "Settle thread",
                        image: UIImage(
                            systemName: settled ? "arrow.counterclockwise" : "checkmark"
                        )
                    ) { [weak self] _ in
                        self?.parent.onSettle(thread, !settled)
                    }
                case let .snooze(presets, enabled):
                    let actions = presets.map { preset in
                        let action = UIAction(title: preset.menuTitle) { [weak self] _ in
                            self?.parent.onSnooze(thread, preset.until)
                        }
                        if !enabled { action.attributes = .disabled }
                        return action
                    }
                    return UIMenu(
                        title: "Snooze",
                        image: UIImage(systemName: "clock"),
                        children: actions
                    )
                case .unsnooze:
                    return UIAction(
                        title: "Wake thread",
                        image: UIImage(systemName: "bell")
                    ) { [weak self] _ in
                        self?.parent.onSnooze(thread, nil)
                    }
                case .copyPath:
                    return UIAction(
                        title: "Copy path",
                        image: UIImage(systemName: "doc.on.doc")
                    ) { [weak self] _ in
                        self?.parent.onCopyPath(thread)
                    }
                case .copyBranch:
                    return UIAction(
                        title: "Copy branch",
                        image: UIImage(systemName: "arrow.triangle.branch")
                    ) { [weak self] _ in
                        self?.parent.onCopyBranch(thread)
                    }
                case .copyThreadID:
                    return UIAction(
                        title: "Copy Thread ID",
                        image: UIImage(systemName: "number")
                    ) { [weak self] _ in
                        self?.parent.onCopyThreadID(thread)
                    }
                case .delete:
                    return UIAction(
                        title: "Delete",
                        image: UIImage(systemName: "trash"),
                        attributes: .destructive
                    ) { [weak self] _ in
                        self?.parent.onDelete(thread)
                    }
                }
            }
        }

        /// Working rows show a live per-second duration, so they need a 1 Hz
        /// tick. Without any, relative ages only change by the minute, and the
        /// timer idles down to match instead of waking the main thread every
        /// second for the lifetime of the sidebar.
        private func startTimer() {
            let interval = HomeThreadRefreshCadence.interval(
                threads: threads(),
                showDoneDuration: parent.showThreadDoneDuration,
                now: .now
            )

            if timer != nil, timerInterval == interval { return }
            invalidateTimer()
            timerInterval = interval
            timerTick = 0
            timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.refreshVisibleTimes()
                }
            }
            timer?.tolerance = interval * 0.12
        }

        private func refreshVisibleTimes() {
            guard let collectionView, let dataSource else { return }
            timerTick = (timerTick + 1) % 60
            let refreshRelativeAges = timerInterval >= 60 || timerTick == 0
            let now = Date.now
            let cadenceChanged = timerInterval == 1
                && HomeThreadRefreshCadence.interval(
                    threads: threads(),
                    showDoneDuration: parent.showThreadDoneDuration,
                    now: now
                ) != timerInterval

            for indexPath in collectionView.indexPathsForVisibleItems {
                guard let identifier = dataSource.itemIdentifier(for: indexPath),
                      case let .thread(thread, _, _, _, _) = itemsByID[identifier],
                      refreshRelativeAges
                        || thread.homeStatus == .working
                        || (cadenceChanged && thread.homeStatus == .done)
                        || (parent.showThreadDoneDuration
                            && thread.homeStatus == .done
                            && HomeThreadRefreshCadence.needsSecondPrecisionRefresh(
                                thread,
                                now: now
                            )),
                      let cell = collectionView.cellForItem(at: indexPath) as? HomeCollectionCell else {
                    continue
                }
                configure(cell, identifier: identifier, now: now)
            }
            if cadenceChanged {
                startTimer()
            }
        }

        private func threads() -> some Sequence<FeatureThread> {
            itemsByID.values.lazy.compactMap { item in
                guard case let .thread(thread, _, _, _, _) = item else { return nil }
                return thread
            }
        }

        private func doneIdentifiers(
            in identifiers: [HomeCollectionItem.ID]
        ) -> [HomeCollectionItem.ID] {
            identifiers.filter { identifier in
                guard case let .thread(thread, _, _, _, _) = itemsByID[identifier] else {
                    return false
                }
                return thread.homeStatus == .done
            }
        }
    }

    private var collectionItems: [HomeCollectionItem] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedQuery.isEmpty {
            if presentation.searchResults.isEmpty {
                return [.searchEmpty(normalizedQuery)]
            }
            return presentation.searchResults.map {
                .thread(
                    $0,
                    presentation.rowContexts[$0.id] ?? .fallback,
                    .rich,
                    $0.isArchived,
                    forceRichRows
                )
            }
        }

        var items = presentation.pinned.map {
            HomeCollectionItem.thread(
                $0,
                presentation.rowContexts[$0.id] ?? .fallback,
                .rich,
                false,
                forceRichRows
            )
        }
        if !presentation.pinned.isEmpty, !presentation.active.isEmpty {
            items.append(.pinnedDivider)
        }
        if presentation.active.isEmpty, presentation.pinned.isEmpty {
            items.append(.empty(.active))
        } else {
            items.append(contentsOf: presentation.active.map {
                .thread(
                    $0,
                    presentation.rowContexts[$0.id] ?? .fallback,
                    .rich,
                    false,
                    forceRichRows
                )
            })
        }

        items.append(.shelfHeader(.snoozed, presentation.snoozed.count, isSnoozedExpanded))
        if isSnoozedExpanded {
            items.append(contentsOf: presentation.snoozed.isEmpty
                ? [.empty(.snoozed)]
                : presentation.snoozed.map {
                    .thread(
                        $0,
                        presentation.rowContexts[$0.id] ?? .fallback,
                        forceRichRows ? .rich : .slim,
                        false,
                        forceRichRows
                    )
                })
        }

        items.append(.shelfHeader(.settled, presentation.settled.count, isSettledExpanded))
        if isSettledExpanded {
            items.append(contentsOf: presentation.settled.prefix(settledLimit).map {
                .thread(
                    $0,
                    presentation.rowContexts[$0.id] ?? .fallback,
                    forceRichRows ? .rich : .slim,
                    false,
                    forceRichRows
                )
            })
            if presentation.settled.count > settledLimit {
                items.append(.showMoreSettled(presentation.settled.count - settledLimit))
            }
        }

        if !presentation.archived.isEmpty {
            items.append(.shelfHeader(.archived, presentation.archived.count, isArchiveExpanded))
            if isArchiveExpanded {
                items.append(contentsOf: presentation.archived.map {
                    .thread(
                        $0,
                        presentation.rowContexts[$0.id] ?? .fallback,
                        forceRichRows ? .rich : .slim,
                        true,
                        forceRichRows
                    )
                })
            }
        }
        return items
    }
}

private final class HomeCollectionCell: UICollectionViewListCell {
    var onAccessibilityActivate: (() -> Void)?

    override func accessibilityActivate() -> Bool {
        guard let onAccessibilityActivate else { return super.accessibilityActivate() }
        onAccessibilityActivate()
        return true
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        onAccessibilityActivate = nil
        accessibilityCustomActions = nil
    }
}

private enum HomeShelf: String, Hashable {
    case active
    case snoozed
    case settled
    case archived

    var title: String {
        rawValue.capitalized
    }
}

private enum HomeCollectionItem: Equatable {
    enum ID: Hashable {
        case thread(String)
        case shelfHeader(HomeShelf)
        case empty(HomeShelf)
        case showMoreSettled
        case searchEmpty
        case pinnedDivider

        var threadID: String? {
            guard case let .thread(id) = self else { return nil }
            return id
        }
    }

    case thread(FeatureThread, HomeThreadRowContext, FeatureThreadRow.Style, Bool, Bool)
    case shelfHeader(HomeShelf, Int, Bool)
    case empty(HomeShelf)
    case showMoreSettled(Int)
    case searchEmpty(String)
    case pinnedDivider

    var id: ID {
        switch self {
        case let .thread(thread, _, _, _, _): .thread(thread.id)
        case let .shelfHeader(shelf, _, _): .shelfHeader(shelf)
        case let .empty(shelf): .empty(shelf)
        case .showMoreSettled: .showMoreSettled
        case .searchEmpty: .searchEmpty
        case .pinnedDivider: .pinnedDivider
        }
    }
}

private struct HomeCollectionCellContent: View {
    let item: HomeCollectionItem
    let projectFaviconClient: any FeatureClient
    let isSelected: Bool
    let now: Date
    let pullRequest: FeaturePullRequest?
    let showThreadDoneDuration: Bool

    @ViewBuilder
    var body: some View {
        switch item {
        case let .thread(thread, context, style, _, allowsMultilineTitle):
            FeatureThreadRow(
                thread: thread,
                context: context,
                projectFaviconClient: projectFaviconClient,
                isSelected: isSelected,
                style: style,
                now: now,
                allowsMultilineTitle: allowsMultilineTitle,
                pullRequest: pullRequest,
                showDoneDuration: showThreadDoneDuration
            )
        case let .shelfHeader(shelf, count, isExpanded):
            HomeShelfHeader(
                title: shelf.title,
                count: count,
                isExpanded: isExpanded,
                accent: shelf == .snoozed ? T3Colors.accent : nil
            )
        case let .empty(shelf):
            Text(shelf == .active ? "No active tasks" : "None")
                .font(T3Typography.homeMetadata)
                .foregroundStyle(T3Colors.textTertiary)
                .frame(maxWidth: .infinity, minHeight: shelf == .active ? 68 : 34, alignment: .center)
        case let .showMoreSettled(remaining):
            HStack {
                Text("Show more")
                Spacer()
                Text("\(remaining)")
                    .monospacedDigit()
                    .foregroundStyle(T3Colors.textTertiary)
            }
            .font(T3Typography.homeMetadata.weight(.semibold))
            .foregroundStyle(T3Colors.textSecondary)
            .padding(.horizontal, 34)
            .frame(minHeight: T3Metrics.minimumTapTarget)
        case .searchEmpty:
            ContentUnavailableView("No matching tasks", systemImage: "magnifyingglass")
                .foregroundStyle(T3Colors.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 160)
        case .pinnedDivider:
            Rectangle()
                .fill(T3Colors.textTertiary.opacity(0.18))
                .frame(height: 1)
                .padding(.horizontal, 18)
                .padding(.vertical, 3)
        }
    }
}

private struct PullRequestLookupKey: Hashable {
    let projectID: String
    let branch: String?
    let worktreePath: String?

    init(thread: FeatureThread) {
        projectID = thread.projectID
        branch = thread.branch?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        worktreePath = thread.worktreePath?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }
}

private struct PullRequestLookupRequest {
    let key: PullRequestLookupKey
    let thread: FeatureThread
}

private struct PullRequestCacheEntry {
    let pullRequest: FeaturePullRequest?
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private extension Optional where Wrapped == [IndexPath] {
    var orEmpty: [IndexPath] { self ?? [] }
}
