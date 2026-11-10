---
name: thread-house
description: Assign a BB thread to the Git repository it works on, so Thread House can organize the enabled Project's sidebar.
---

Use `bb thread-house assign --path /absolute/repository/path` when a thread starts in a parent directory and works in a nested repository. The command defaults to the current thread; use `--thread <id>` to select one explicitly.

Choose the repository this thread edits. Worktrees are supported. Repository assignments are thread metadata and do not change files or Git state.

Use `bb thread-house clear` to remove the assignment and restore automatic discovery from the environment or parent thread.

The plugin must be enabled for this thread's Project in Settings → Installed plugins → Thread House → Enabled Project. Commands reject other Projects.

Collapsed repository and virtual folders retain busy threads and threads with unread activity or a host-reported BB status indicator, together with their parent threads and nested folder paths. Quiet branches stay hidden. The disclosure arrow points down while any retained row is visible and points right when the collapsed folder shows nothing. A collapsed parent thread keeps its children hidden; collapsing the surrounding folder does not expand that thread. When work and attention clear, the rows disappear without reopening the folder. The **Updated** filter still applies.

The currently opened thread and its parent path remain in the tree even when idle, outside **Updated**, or beneath collapsed folders, parent threads, or a Project. Navigating to another thread moves this exception without changing saved collapse preferences.

Parents projected into their children's other folders appear as compact, muted links without subtitles or selected highlighting. Their own folder keeps the full row, including when a parent is retained by **Updated** for a recent child. Each copy expands independently and navigates to the parent. Thread subtitles omit machine names. The fork icon with the **Git worktree** tooltip appears only when BB explicitly reports `environment.isWorktree === true`.

An opened internal helper thread also appears while selected; other hidden helper threads stay hidden.

The sidebar's **Pinned** section shows visible, unarchived pinned threads from every Project in BB's pin order, independently of **Updated**. Pin and unpin through the normal BB thread actions. Pinned entries also retain their repository or virtual-folder location.

Repository loading automatically retries temporary network failures up to three attempts and retains previously loaded folders. Use **Retry** after the final failure; backend logs include the failed SDK or host operation and its network cause when available.
