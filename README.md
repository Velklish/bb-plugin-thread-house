# Thread House

**Make room for every agent.** Repository folders, nested threads, and smart views for your BB Project.

Thread House turns a busy sidebar into a place you can navigate. Group threads by Git repository, keep child agents beneath their parent, and organize work with virtual folders and drag and drop. **Needs input** and **Recent** bring active work into view.

## Install and enable

Requires BB 0.46.0 or later and Plugin SDK 0.6.37 compatibility.

```sh
bb plugin install git:https://github.com/Velklish/bb-plugin-thread-house.git@v0.1.0
```

Open **Settings → Installed plugins → Thread House** and choose **Enabled Project**. The default is disabled. Each installation enables one Project; change the selection to move the enhanced view to another Project.

BB installs plugins on the server. Its sidebar replacement is global: Thread House renders the entire list, with repository folders and agent trees only for the selected Project. Other Projects retain a plain list with normal thread navigation and BB actions. Their repositories are not probed and their assignments cannot be changed by this plugin. Clearing **Enabled Project** restores a plain list for every Project.

Choose the sidebar provider under **Settings → Appearance → Sidebar** if another thread-list plugin is active.

## Find and organize work

- Git repositories and worktrees are detected from each thread's environment, on the machine that owns it.
- Worktrees that share a Git common directory use the same automatic repository folder. The folder label comes from the shared Git directory; assignments resolve to the actual checkout path.
- Children using the same environment inherit their parent's repository assignment.
- A parent with children in other folders appears there as a compact, muted link without metadata or selected highlighting. Its own folder keeps the full row. Each copy can be expanded independently.
- Thread subtitles show branch and checkout context without machine names. A fork icon with the **Git worktree** tooltip marks environments explicitly reported as worktrees by BB; plain checkouts and unknown environments have no worktree icon.
- Clones with the same Git origin can share a folder while retaining their individual checkout labels. Folder actions can separate them again.
- Create, nest, rename, pin, sort, and reorder virtual folders. Drag threads between folders and reorder siblings, or use **Move to…** in the thread or folder actions menu. Folder destinations exclude the folder itself and its descendants.
- Navigate rows with **Arrow Up/Down**, **Home/End**, and **Arrow Left/Right** to collapse, expand, or reach a parent. Navigation scrolls virtualized rows into view without opening a thread. **Enter** opens a focused thread; **Tab** reaches its actions.
- **Undo** restores the last layout change in this window, including moves, folder removal, sorting, and grouping. It preserves the current **Updated** filter and collapse state. A layout received from another window clears Undo so it cannot overwrite that window's work.
- Reordering siblings switches their folder to **Manual** sorting. Threads and folders that appear after a manual order was saved are shown above it, newest first. Choose another **Sort by** mode or **Reset folder order** to return to automatic ordering.
- A thread without its own location follows its nearest moved ancestor, so agents started later stay in their parent's folder. Drag one elsewhere to place it separately; **Automatic folder** returns it to its parent's folder. Moving or restoring a parent preserves children placed in other folders. Older duplicated placements that merely followed the parent are removed when that parent moves.
- Collapsed repository and virtual folders keep busy threads and threads with unread activity or a host-reported BB status indicator visible. Their parent threads and nested folder paths remain visible for context; quiet branches stay hidden. The disclosure arrow and its accessible action name follow the saved collapse state: a collapsed folder shows **Expand** even while active rows remain visible. Its tooltip explains that exception. Collapsing a folder does not expand a session that was already collapsed. Rows disappear when work and attention clear, while the folder stays collapsed. **Updated** still applies.
- The currently opened thread and its parent path remain in the tree even when idle, outside **Updated**, or beneath collapsed folders, parent threads, or a Project. Switching threads moves this exception to the newly opened thread without changing saved collapse preferences.
- An opened internal helper thread also appears while selected; other hidden helper threads stay hidden.
- **Pinned** at the top shows visible, unarchived pinned threads from every Project in BB's pin order. **Updated** does not hide these entries. Use the normal BB thread actions to pin or unpin; repository and virtual-folder entries remain in place.
- Filter the selected Project by **Updated**: **Last 24 hours**, **Last 3 days**, **Last 7 days**, or **All**. Other Projects are not affected by this filter. When the selected Project has no matches, **Show all** clears the time filter.
- Open **Actions → Repository → Choose path…** when a thread starts in a parent directory and edits a nested repository.

Virtual folder layout is stored separately for each enabled Project in the browser. Windows sharing that storage pick up each other's changes. A saved field that cannot be read falls back to its default without discarding the rest of the layout. Repository assignments are stored in the thread's plugin metadata; neither changes Git files or the index.

```sh
bb thread-house assign --path /projects/sample-app
bb thread-house assign --thread thr_example --path /projects/sample-app --json
bb thread-house clear --thread thr_example --json
```

`clear` removes only this plugin's `repository` assignment. Commands reject threads outside the enabled Project. Git failures are displayed rather than silently treated as empty repositories.

An environment whose checkout directory no longer exists is shown without an automatically detected repository. Explicit repository assignments remain available and use another discovered checkout of the same repository when possible. Choosing a missing path still reports an error.

Repository discovery limits concurrent SDK and host reads to eight across sidebar requests. Temporary network failures retry up to three attempts per load, with 250 ms and 750 ms delays. Previously loaded repository folders remain visible during failures. After the final attempt, **Retry** starts a fresh load. The toolbar shows refresh progress and disables duplicate manual requests. Events arriving during a load are combined into one subsequent load; reconnecting clients resume automatically. Threads remain navigable while repository discovery loads.

Errors from **Assign repository** stay with that operation: **Edit path…** reopens the failed path, and **Dismiss** clears the notice. Permanent errors remain visible without automatic retries. A thread that no longer exists is skipped, so the other threads still load. Backend logs identify the failed operation and the underlying network error when available. Environment Git probe timeouts are retried. A local Git failure while checking a saved assignment preserves that assignment and does not fail other environments; SDK and host transport failures still surface for retry.

Each load reads an environment once, even when several assignments refer to it. Concurrent automatic probes share work, successful results are cached for five minutes, and non-Git or failed probes are not cached. **Assign** always probes freshly. **Refresh** invalidates in-flight cache entries as well as completed ones, so an older probe cannot repopulate the new cache.

## Develop

With BB and Node.js installed:

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin install path:/absolute/path/to/bb-plugin-thread-house
```

Release commits include the generated `dist/` artifacts, so a Git install does not need development dependencies. Build with the supported BB/SDK versions before tagging a release.

### Architecture

- `repository-discovery.ts` owns probe sharing, cache lifetime, invalidation, and repository identity; `server.ts` connects it to BB host RPC and project-scoped assignments.
- `use-repository-data.ts` owns one active client load, queued refreshes, retries, reconnection, and retention of the last readable repository state.
- `use-layout-preferences.ts` owns persistence, cross-window adoption, and one-step layout Undo. `preferences.ts` and `folders.ts` define placement, inheritance, ordering, and valid folder moves.
- `app.tsx` composes these modules with BB thread actions, the virtual tree, keyboard focus, and dialogs. Tests exercise the RPC and rendered sidebar contracts, including delayed responses and storage events.
