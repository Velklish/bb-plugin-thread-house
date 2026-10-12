Thread House groups the enabled BB Project's sidebar by Git repository, preserving parent and child threads. Select Enabled Project in the plugin settings. Other Projects use a plain thread list, without repository probes or assignments. The sidebar renderer itself is global in BB.

Create virtual folders with New folder, nest folders by dropping onto their center, and reorder them by dropping at the top or bottom edge. Every folder has a menu and a right-click menu for Pin folder, Sort by, and folder management. No folders are pinned automatically.
Drag threads by the Drag to organize handle to reorder siblings or organize a task and its children in a folder. Text keeps BB split drag. Checkout paths and repository metadata stay intact. Automatic folder and Restore thread locations undo manual thread placement, including after clone merging.
Clones with the same network origin on one machine group automatically under the repository name, including release checkouts. SSH and HTTPS origin addresses are normalized without credentials. Repositories without a network origin remain separate by Git directory.
Use Group with… to override grouping; Keep checkouts separate restores the current clones as individual groups and persists the exception. Folder nesting and clone merging are separate operations.

## Find recent work

Select Last 24 hours, Last 3 days, Last 7 days, or All. The filter uses BB's last-update timestamp. Parents stay visible when a child matches. Your period and expanded groups persist in this client.
Needs input shows approvals and questions awaiting your response regardless of the period, with ancestor context. Recent shows up to ten root tasks, promoted by descendant updates, with aggregate need input and running counts. Workers are not listed separately in Recent. Layout preferences persist in this client.

## Know where agents work

Repository discovery runs on each environment's machine without fetching. Worktrees sharing a Git directory and clones sharing a network origin appear together. Each thread appears in its repository group. Different BB projects, machines and remote namespaces stay separate. Ancestors from another repository appear as Parent context and do not increase the group count. You can expand these parent copies independently in each group. Thread rows show their branch, machine and actual checkout label when it differs from the group.

For threads running from a workspace root, assign their repository through the row's Repository menu or `bb thread-house assign --path /absolute/repository/path`.

## Requirements

BB 0.46.0 with Plugin SDK 0.6.37, and Git on each environment's machine. Sidebar and host entry APIs are experimental. This view shows non-archived threads and uses plugin-owned virtual folders rather than BB custom sections. Choose the original Thread list in Settings to return to that view.
