# Gitea Issues for Herdr

A side panel for the [Herdr](https://herdr.dev) desktop app that shows the open
Gitea issues of the project you are working in. It follows the focused pane:
switch to a terminal in another repository and the panel switches with it.

All Gitea access goes through the official [`gt`](https://gitea.com/gitea/cli)
CLI, so the panel uses the accounts you have already logged in with.

- Stat tiles: open issues and the two most used labels
- Label chips with counts, in each label's Gitea colour; click one to filter
- A text filter over number, title, labels and author
- Issue cards with coloured label pills
- Click an issue to read it inside the panel: markdown body and comments,
  with a link to open it in the browser
- Refreshes when you switch project, every two minutes, and on demand

Repositories that are not hosted on a Gitea instance known to `gt` (GitHub,
no remote, not a repository) show an empty panel.

## Requirements

- Herdr desktop app (`herdr-app`)
- `gt` (Gitea CLI) on your `PATH`, logged in to your instance:

  ```sh
  gt auth login --host https://gitea.example.org
  ```

## Install

### Ask your agent

In a Herdr terminal, ask your coding agent:

> Add the Herdr mod from https://github.com/oquinena/gitea-herdr (the
> `gitea-issues` mod) to my window as a right side panel toggled with
> cmd-shift-i.

The agent follows `~/.config/herdr-app/AGENTS.md`: it copies the mod, adds a
panel block to your layout, binds the key and runs `herdr-app check`.

### By hand

1. Copy the mod into Herdr's home:

   ```sh
   git clone https://github.com/oquinena/gitea-herdr.git
   cp -R gitea-herdr/mods/gitea-issues ~/.config/herdr-app/mods/
   herdr-app check ~/.config/herdr-app/mods/gitea-issues
   ```

   Copy the folder rather than symlinking it: Herdr does not hot reload a
   symlinked mod.

2. Add the panel to a layout you own. Herdr's shipped layouts are read-only,
   so clone one first if you have not already:

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
   ```

   In `~/.config/herdr-app/layouts/my-layout.json`, add this block as a
   sibling of the main terminal area (in the default layout: inside the
   `work-body` row, after `panel`):

   ```json
   { "id": "issues", "type": "block", "hidden": true,
     "size": { "px": 368 }, "min": 280, "max": 900,
     "content": { "mod": "gitea-issues" } }
   ```

3. Bind a key to toggle it, in the `global` section of
   `~/.config/herdr-app/keys.json`:

   ```json
   "cmd-shift-i": "layout.toggle:issues"
   ```

4. Check that Herdr accepted the edits: there should be no `layout.error` or
   `keys.error` file next to them. Then press cmd-shift-i in a terminal that is
   inside a Gitea repository.

## How it finds the project

For the focused pane's folder the panel runs `git rev-parse --show-toplevel`
and `git remote get-url origin`, and compares the origin's host with the hosts
from `gt auth status --json host`. Only then does it run `gt issue list`. For a
space on another machine, every command runs on that machine.

## Limits

- Shows at most 100 open issues, so tile and chip counts stop at 100.
- Read-only: no commenting, closing or creating issues yet.
- "Open in browser" uses `open`, so it works on macOS only.

## Development

```sh
node --test test/
```

`mods/gitea-issues/gitea.js` holds every `git` and `gt` call and the pure
logic (tested); `main.js` is the panel. After editing, copy the folder into
`~/.config/herdr-app/mods/` again. Herdr reloads a running mod reliably only
after a layout switch.
