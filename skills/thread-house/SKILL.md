---
name: thread-house
description: Assign a BB thread to the Git repository it works on, so Thread House can organize the enabled Project's sidebar.
---

Use `bb thread-house assign --path /absolute/repository/path` when a thread starts in a parent directory and works in a nested repository. The command defaults to the current thread; use `--thread <id>` to select one explicitly.

Choose the repository this thread edits. Worktrees are supported. Repository assignments are thread metadata and do not change files or Git state.

Use `bb thread-house clear` to remove the assignment and restore automatic discovery from the environment or parent thread.

The plugin must be enabled for this thread's Project in Settings → Installed plugins → Thread House → Enabled Project. Commands reject other Projects.
