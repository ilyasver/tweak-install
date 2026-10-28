# installer/tools.sh: Node 22, GitHub's gh, and git, each only when missing, into ~/Tweak/tools.
# Public tools only: nothing from Wix. No administrator, nothing outside ~/Tweak, the person's
# shell settings untouched (Tweak's icon carries its own PATH). Every download is checked against
# its publisher's checksum.
TOOLS="$HOME/Tweak/tools"
NARCH=$(uname -m | sed 's/x86_64/x64/'); GARCH=$(uname -m | sed 's/x86_64/amd64/')
export PATH="$TOOLS/node/bin:$TOOLS/gh/bin:$TOOLS/git/bin:$PATH"

_fake() { mkdir -p "$TOOLS/$1/bin"; printf '#!/bin/sh\necho fake-%s 99.0.0\n' "$1" > "$TOOLS/$1/bin/$1"; chmod +x "$TOOLS/$1/bin/$1"; }

# The portable git needs to know where its parts are; said every time it is the git in use.
git_env() {
  if [ -x "$TOOLS/git/bin/git" ]; then
    export GIT_EXEC_PATH="$TOOLS/git/libexec/git-core" GIT_TEMPLATE_DIR="$TOOLS/git/share/git-core/templates"
  fi
}

ensure_node() {
  if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; then return 0; fi
  [ -n "${TWEAK_FAKE_DOWNLOAD:-}" ] && { _fake node; return 0; }
  mkdir -p "$TOOLS" && cd "$TOOLS" || return 1
  local sums f; sums=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt) || return 1
  f=$(printf '%s\n' "$sums" | awk -v a="darwin-$NARCH.tar.gz" '$2 ~ a"$" {print $2}')
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$f" && printf '%s\n' "$sums" | grep " $f\$" | shasum -a 256 -c - >/dev/null || return 1
  tar -xzf "$f" && ln -sfn "${f%.tar.gz}" node && rm "$f"
}

# pnpm and yarn as plain commands, from the corepack inside Tweak's own Node: a project's build that calls
# `pnpm` by name inside itself needs it on PATH (2026-10-28, Symphony's common-lib on Dolev's Mac).
# Only for Tweak's own Node; a person's own Node is left as it is.
ensure_pm() {
  local cp="$TOOLS/node/bin/corepack"
  [ -x "$cp" ] || return 0
  [ -e "$TOOLS/node/bin/pnpm" ] && [ -e "$TOOLS/node/bin/yarn" ] && return 0
  "$cp" enable pnpm yarn
}

ensure_gh() {
  if command -v gh >/dev/null && gh --version | head -1 | awk '{split($3,v,"."); exit !(v[1]>2 || (v[1]==2 && v[2]>=40))}'; then return 0; fi
  [ -n "${TWEAK_FAKE_DOWNLOAD:-}" ] && { _fake gh; return 0; }
  mkdir -p "$TOOLS" && cd "$TOOLS" || return 1
  local rel url z sums; rel=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest) || return 1
  url=$(printf '%s' "$rel" | grep -o "https://[^\"]*_macOS_${GARCH}\.zip" | head -1); z=$(basename "$url")
  sums=$(printf '%s' "$rel" | grep -o 'https://[^"]*_checksums\.txt' | head -1)
  curl -fsSLo "$z" "$url" && curl -fsSL "$sums" | grep " $z\$" | shasum -a 256 -c - >/dev/null || return 1
  unzip -qo "$z" && ln -sfn "${z%.zip}" gh && rm "$z"
}

# git: the Mac's own when Apple's developer tools are there, Homebrew's when it is, else GitHub
# Desktop's portable git. /usr/bin/git without the developer tools only opens Apple's install
# window, so it does not count.
ensure_git() {
  git_env
  if [ -x "$TOOLS/git/bin/git" ]; then return 0; fi
  if xcode-select -p >/dev/null 2>&1 || { command -v git >/dev/null && [ "$(command -v git)" != /usr/bin/git ]; }; then return 0; fi
  [ -n "${TWEAK_FAKE_DOWNLOAD:-}" ] && { _fake git; git_env; return 0; }
  mkdir -p "$TOOLS/git" && cd "$TOOLS" || return 1
  local rel url f sum; rel=$(curl -fsSL https://api.github.com/repos/desktop/dugite-native/releases/latest) || return 1
  url=$(printf '%s' "$rel" | grep -o "https://[^\"]*-macOS-${NARCH}\.tar\.gz" | head -1); f=$(basename "$url")
  sum=$(curl -fsSL "$url.sha256" | tr -d '[:space:]')
  curl -fsSLo "$f" "$url" && printf '%s  %s\n' "$sum" "$f" | shasum -a 256 -c - >/dev/null || return 1
  tar -xzf "$f" -C git && rm "$f"
  git_env
  git --version >/dev/null && git ls-remote https://github.com/desktop/dugite-native HEAD >/dev/null
}
