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
- Children using the same environment inherit their parent's repository assignment.
- Clones with the same Git origin can share a folder while retaining their individual checkout labels. Folder actions can separate them again.
- Create, nest, rename, pin, sort, and reorder virtual folders. Drag threads between folders and reorder siblings.
- Filter the selected Project by **Updated**: **Last 24 hours**, **Last 3 days**, **Last 7 days**, or **All**. Other Projects are not affected by this filter.
- Open **Actions → Repository → Choose path…** when a thread starts in a parent directory and edits a nested repository.

Virtual folder layout is stored separately for each enabled Project in the browser. Repository assignments are stored in the thread's plugin metadata; neither changes Git files or the index.

```sh
bb thread-house assign --path /projects/sample-app
bb thread-house assign --thread thr_example --path /projects/sample-app --json
bb thread-house clear --thread thr_example --json
```

`clear` removes only this plugin's `repository` assignment. Commands reject threads outside the enabled Project. Git failures are displayed rather than silently treated as empty repositories.

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
