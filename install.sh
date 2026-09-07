#!/usr/bin/env bash
# Bootstrap a new Mac from this dotfiles repo.
#   git clone https://github.com/frailbongat/dotfiles.git ~/.config
#   ~/.config/install.sh
set -euo pipefail

CONFIG="$HOME/.config"
cd "$CONFIG"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  info "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# 2. Packages
info "Installing packages from Brewfile"
brew bundle --file="$CONFIG/Brewfile"

# 3. Home dotfiles -> symlinks into ~
info "Linking home dotfiles"
for src in "$CONFIG"/home/.*; do
  name="$(basename "$src")"
  case "$name" in .|..) continue ;; esac
  dest="$HOME/$name"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    mv "$dest" "$dest.backup-$(date +%Y%m%d%H%M%S)"
    echo "    backed up existing $dest"
  fi
  ln -sfn "$src" "$dest"
  echo "    $dest -> $src"
done

# 4. Git identity. Never committed, so create it here.
if [ ! -f "$HOME/.gitconfig.local" ]; then
  info "Creating ~/.gitconfig.local (git identity)"
  printf 'Git name: '  >&2; read -r GIT_NAME
  printf 'Git email: ' >&2; read -r GIT_EMAIL
  cat > "$HOME/.gitconfig.local" <<LOCAL
# Private. Never committed. Lives outside the dotfiles repo.
[user]
	name = $GIT_NAME
	email = $GIT_EMAIL
LOCAL
  chmod 600 "$HOME/.gitconfig.local"
fi

# 5. pi config -> symlinks into ~/.pi/agent. Auth and history stay local.
#    mcp/mcp.json is already in place at ~/.config/mcp/mcp.json, which is
#    pi's highest-precedence global MCP config. Nothing to link.
info "Linking pi config"
mkdir -p "$HOME/.pi/agent"
for src in "$CONFIG"/pi/agent/*; do
  [ -e "$src" ] || continue
  dest="$HOME/.pi/agent/$(basename "$src")"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    mv "$dest" "$dest.backup-$(date +%Y%m%d%H%M%S)"
    echo "    backed up existing $dest"
  fi
  ln -sfn "$src" "$dest"
  echo "    $dest"
done

# 6. Agent skills library -> ~/.agents. Separate repo, read by pi and other agents.
if [ -d "$HOME/.agents/.git" ]; then
  info "Agent skills already present at ~/.agents"
elif [ -e "$HOME/.agents" ]; then
  mv "$HOME/.agents" "$HOME/.agents.backup-$(date +%Y%m%d%H%M%S)"
  info "Backed up existing ~/.agents, cloning agent skills"
  git clone https://github.com/frailbongat/agents.git "$HOME/.agents"
else
  info "Cloning agent skills into ~/.agents"
  git clone https://github.com/frailbongat/agents.git "$HOME/.agents"
fi

# 7. macOS defaults
#    workspaces-auto-swoosh is "When switching to an application, switch to a
#    Space with open windows for the application". macOS applies it even when
#    the app has zero open windows, so a closed-but-running app drags you back
#    to its old space. Off. ~/.config/yabai/travel.sh does the travelling
#    instead, and only when there is actually a window to travel to.
info "Setting macOS defaults"
defaults write com.apple.dock workspaces-auto-swoosh -bool NO
killall Dock 2>/dev/null || true

# 8. Build sketchybar C helpers
if [ -d "$CONFIG/sketchybar/helpers" ]; then
  info "Building sketchybar helpers"
  make -C "$CONFIG/sketchybar/helpers"
fi

# 9. Paseo: portable config + plugins.
#    ~/.paseo holds per-device identity (daemon-keypair.json, server-id,
#    cli-client-id, push-tokens.json). Those are never synced. Only the
#    portable settings live in this repo, as paseo/config.template.json.
#
#    The `plugins` block is deliberately NOT in the template. Paseo records
#    every plugin as an absolute path, even ones installed from Git, where the
#    path is a managed checkout under ~/.paseo/plugins. That path is
#    meaningless on another machine, so each device writes its own by running
#    `paseo plugin install` below.
PASEO_BIN="/Applications/Paseo.app/Contents/Resources/bin/paseo"
PASEO_HOME="$HOME/.paseo"
PASEO_CONFIG="$PASEO_HOME/config.json"
PASEO_TEMPLATE="$CONFIG/paseo/config.template.json"
PASEO_APP_SUPPORT="$HOME/Library/Application Support/Paseo"
PASEO_DESKTOP_SETTINGS="$PASEO_APP_SUPPORT/desktop-settings.json"
PASEO_DESKTOP_TEMPLATE="$CONFIG/paseo/desktop-settings.template.json"

PASEO_PLUGINS=(
  "https://github.com/frailbongat/paseo-composer-pills.git"
  "https://github.com/frailbongat/paseo-ticket-board.git"
)

if [ ! -x "$PASEO_BIN" ]; then
  info "Paseo not installed, skipping. Install Paseo.app, then re-run this script."
else
  info "Applying Paseo config"
  mkdir -p "$PASEO_HOME"
  if [ -f "$PASEO_CONFIG" ]; then
    # Template wins on the keys it defines. Everything else in the existing
    # config survives, including the device's own `plugins` block.
    tmp="$(mktemp)"
    jq -s '.[0] * .[1]' "$PASEO_CONFIG" "$PASEO_TEMPLATE" > "$tmp"
    mv "$tmp" "$PASEO_CONFIG"
    echo "    merged template into existing $PASEO_CONFIG"
  else
    cp "$PASEO_TEMPLATE" "$PASEO_CONFIG"
    echo "    seeded $PASEO_CONFIG"
  fi

  # Plugin install needs a running daemon. On a cold machine there isn't one,
  # so treat failure as "do it later" rather than aborting the whole script.
  info "Installing Paseo plugins"
  for repo in "${PASEO_PLUGINS[@]}"; do
    name="$(basename "$repo" .git)"
    if "$PASEO_BIN" plugin ls 2>/dev/null | grep -q "^$name "; then
      echo "    $name already installed"
    elif "$PASEO_BIN" plugin install "$repo" >/dev/null 2>&1; then
      echo "    $name installed"
    else
      echo "    $name FAILED. Start Paseo, then: $PASEO_BIN plugin install $repo"
    fi
  done
fi

# 10. Paseo app settings, which live in two different places.
#
#     desktop-settings.json is the Electron shell's own file, holding the
#     release channel and how it manages the daemon. It sits in the Electron
#     profile next to window-state.json, cookies, and caches. Its `migrations`
#     block is per-device bookkeeping, so the template leaves it out.
#
#     Everything you set inside the app -- theme, fonts, font sizes, diff
#     layout, default agent provider -- is not a file at all. Paseo keeps it in
#     the renderer's localStorage, which on disk is a Chromium LevelDB. Only
#     paseo/app-settings.mjs can read and write that, so it does.
#
#     Both need Paseo closed. It holds a lock on the LevelDB while it runs and
#     rewrites desktop-settings.json on quit, which would undo the merge.
#     pgrep does not see the Electron main process by name on macOS, hence the
#     exact match on its executable path in the full process list.
info "Applying Paseo app settings"
if ps -Axo comm= | grep -qx '/Applications/Paseo.app/Contents/MacOS/Paseo'; then
  echo "    Paseo is running. Quit it and re-run this script to apply."
else
  mkdir -p "$PASEO_APP_SUPPORT"
  if [ -f "$PASEO_DESKTOP_SETTINGS" ]; then
    tmp="$(mktemp)"
    jq -s '.[0] * .[1]' "$PASEO_DESKTOP_SETTINGS" "$PASEO_DESKTOP_TEMPLATE" > "$tmp"
    mv "$tmp" "$PASEO_DESKTOP_SETTINGS"
    echo "    merged template into existing $PASEO_DESKTOP_SETTINGS"
  else
    cp "$PASEO_DESKTOP_TEMPLATE" "$PASEO_DESKTOP_SETTINGS"
    echo "    seeded $PASEO_DESKTOP_SETTINGS"
  fi

  # Needs Paseo to have launched at least once, so the LevelDB exists.
  if [ -d "$PASEO_APP_SUPPORT/Local Storage/leveldb" ]; then
    node "$CONFIG/paseo/app-settings.mjs" apply
  else
    echo "    no local storage yet. Launch Paseo once, quit it, re-run this script."
  fi
fi

cat <<'EOF'

Done. yabai, skhd, sketchybar, pi, agent skills, macOS defaults, and VS Code
settings are in place.

Still manual:
  - Paseo needs to be running before plugins can install. If step 9
    reported a failure, open Paseo.app and re-run this script.
  - Start the services:
      yabai --start-service
      skhd --start-service
      brew services start sketchybar
  - System Settings > Privacy & Security > Accessibility:
      grant access to yabai and skhd, or hotkeys will not fire.
  - pi needs its API keys again (auth.json is never synced):
      pi
  - Oh My Zsh + powerlevel10k, required by .zshrc:
      sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  - Reload the shell:
      exec zsh
EOF
