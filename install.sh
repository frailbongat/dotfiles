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

cat <<'EOF'

Done. yabai, skhd, sketchybar, pi, agent skills, macOS defaults, and VS Code
settings are in place.

Still manual:
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
