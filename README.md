# dotfiles

My Mac config. This repo *is* `~/.config`.

`.gitignore` is a **whitelist**. Everything is ignored by default. A folder only reaches
GitHub if it has an `!/name/` line. Adding a new folder to `~/.config` cannot leak it by accident.

## New machine

```sh
git clone https://github.com/frailbongat/dotfiles.git ~/.config
~/.config/install.sh
```

`install.sh` also clones two repos it does not own:
[frailbongat/agents](https://github.com/frailbongat/agents) into `~/.agents` for vendored skills, and
[frailbongat/pi-config](https://github.com/frailbongat/pi-config) into `~/.pi` for the pi agent config.

## What is tracked

| Folder | What it is |
| --- | --- |
| `yabai/` | Tiling window manager rules |
| `skhd/` | Global keyboard shortcuts |
| `sketchybar/` | Menu bar replacement. Lua config plus C helpers you compile with `make`. |
| `.vscode/` | VS Code settings and extension list |
| `home/` | Files that belong in `~`: `.zshrc`, `.zprofile`, `.gitconfig`, `.p10k.zsh`. Symlinked out by `install.sh`. |
| `mcp/mcp.json` | Global MCP servers. This is pi's highest-precedence MCP config. |
| `paseo/` | Paseo templates: daemon config, desktop settings, and in-app settings. Merged into place by `install.sh`. `paseo/icons/` holds project icons you set by hand in the app. |
| `Brewfile` | Every brew formula and cask |

Everything else in `~/.config` stays on this machine only.

## Agent skills live in a second repo

`~/.agents` is not part of this repo. It is [frailbongat/agents](https://github.com/frailbongat/agents),
a public skill library that mostly vendors other people's MIT and Apache work, so it keeps its own
LICENSE and NOTICE.md. `install.sh` clones it for you.

The line is: pi-specific config (`settings.json`, `models.json`, `themes/`, `extensions/`, `prompts/`)
lives here. Tool-agnostic skills live in `~/.agents/skills/`. pi reads both.

`~/.config/mcp/mcp.json` stays here on purpose. It is precedence 1. `~/.agents/mcp.json` is only
precedence 2, so moving it would demote it.

## Git identity is not in here

`home/.gitconfig` holds settings only. Your name and email live in `~/.gitconfig.local`,
which sits outside the repo and is ignored twice over. `install.sh` prompts for them on a new machine.

Use a GitHub noreply address so your real email never appears in a commit:

```sh
gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'
```

## pi moved out of this repo

pi config used to live here under `pi/agent/`, symlinked into `~/.pi/agent` by `install.sh`.
Commit `b61f248` removed it on 2026-09-15, and
[frailbongat/pi-config](https://github.com/frailbongat/pi-config) replaced it the next day. That repo
is `~/.pi` itself, so there is nothing left to symlink.

The split cost me a day of debugging, so it is worth stating why. A machine set up before the move
kept working, because its symlinks still pointed at a real directory in an old checkout. It just
never saw another update. Two weeks later `/ship refs` failed there with `Unrecognized argument
"refs"` while the same command worked here. Nothing looked broken, the files simply matched a
source that had been retired.

So `install.sh` no longer symlinks anything into `~/.pi`. It clones the repo, and moves a
pre-repo `~/.pi` to `~/.pi.backup-<timestamp>` first, carrying over `auth.json`,
`cliproxyapi.json`, and `trust.json`. Then it runs `~/.pi/setup.sh`, which links extension
dependencies and clones [frailbongat/skills](https://github.com/frailbongat/skills) into `~/skills`.

To fix a machine still on the old layout, run `~/.config/install.sh` again. It detects that `~/.pi`
is not a git checkout and does the swap.

## MCP

pi reads MCP config in this order, first match wins:

1. `~/.config/mcp/mcp.json`  <- tracked here
2. `~/.agents/mcp.json`
3. `~/.agents/mcp/mcp.json`
4. `~/.pi/agent/mcp.json`
5. `.mcp.json` (project)
6. `.pi/mcp.json` (project)

Edit number 1. It is the shared global config, and Crush, Cursor, and Codex do not override it.

## Paseo, specifically

Three templates, because Paseo keeps its settings in three places:

```
paseo/config.template.json            -> ~/.paseo/config.json                     daemon
paseo/desktop-settings.template.json  -> .../Paseo/desktop-settings.json          Electron shell
paseo/app-settings.template.json      -> .../Paseo/Local Storage/leveldb          everything in-app
```

The first two are plain JSON files, and `install.sh` deep-merges them with `jq`. The template wins
on the keys it names and everything else on the machine survives.

The third is the interesting one. Everything you set inside the app, theme, fonts, font sizes, diff
layout, default agent provider, is not stored in a file. Paseo keeps it in the renderer's
localStorage, which on disk is a Chromium LevelDB. `paseo/app-settings.mjs` reads and writes that
store directly, using `classic-level` installed once into `~/.cache`:

```sh
node paseo/app-settings.mjs export   # live app -> app-settings.template.json
node paseo/app-settings.mjs apply    # app-settings.template.json -> live app
```

Run `export` after changing settings in the app, then commit the diff. `install.sh` runs `apply`
for you. It backs the store up first and rolls back if the write fails, because the same store
holds your composer drafts and window layout.

The daemon config has no export command. It is a plain file, so refresh it by hand after changing
anything under a host's settings, minus the per-device `plugins` block:

```sh
jq 'del(.plugins)' ~/.paseo/config.json > paseo/config.template.json
```

### Which settings screen ends up where

| Settings screen | Template |
| --- | --- |
| Appearance: theme, fonts, syntax, detail level, chat outline | `app-settings` |
| Open location, Editor, agent defaults in the composer | `app-settings` |
| Changes: diff layout, wrapping, whitespace | `app-settings` |
| Notifications, Release channel, daemon management | `desktop-settings` |
| Orchestration, Metadata generation, terminal profiles, providers | `config` (per host) |
| Plugins | none. `install.sh` reinstalls them from Git, since paths differ per device |
| Connections, Pair devices | none. Device identity, and it should differ per device |
| Permissions | none. macOS grants these, not Paseo |

Left out on purpose:

```
~/.paseo/daemon-keypair.json  server-id  cli-client-id  push-tokens.json   per-device identity
config.json > plugins                    absolute paths, rewritten per device by `paseo plugin install`
desktop-settings.json > migrations       per-device bookkeeping
@paseo:client-id-v1, daemon-registry     device identity and paired hosts
@paseo/provider-snapshot/*               rebuildable cache, full of absolute paths
workspace-layout-state, sidebar-*        per-workspace layout
window-state.json, Cookies, Cache        Electron profile junk
```

Quit Paseo before running `install.sh`. It holds a lock on the LevelDB while running and rewrites
`desktop-settings.json` on quit, so both merges would be lost. The script checks and tells you.

Fonts are not carried by the settings, only their names. `Space Grotesk` comes from the Brewfile.
`Dank Mono` is paid and hand-installed, so copy it into `~/Library/Fonts` yourself or the app falls
back to a default mono.

## Adding a folder later

Add one line to `.gitignore`, then check what it pulls in before committing:

```sh
echo '!/foldername/' >> .gitignore
git status --short
```

## Rules

- After installing new brew stuff: `brew bundle dump --file=Brewfile --force`
- Before committing, skim `git status`. The whitelist should make surprises impossible, but look anyway.
