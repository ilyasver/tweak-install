# installer/tools.sh: Node 22, GitHub's gh, and git, each only when missing, into ~/Tweak/tools.
# Public tools only: nothing from Wix. No administrator, nothing outside ~/Tweak, the person's
# shell settings untouched (Tweak's icon carries its own PATH). Every download is checked against
# its publisher's checksum.
TOOLS="$HOME/Tweak/tools"
NARCH=$(uname -m | sed 's/x86_64/x64/'); GARCH=$(uname -m | sed 's/x86_64/amd64/')
export PATH="$TOOLS/node/bin:$TOOLS/gh/bin:$TOOLS/git/bin:$PATH"

_fake() { mkdir -p "$TOOLS/$1/bin"; printf '#!/bin/sh\necho fake-%s 99.0.0\n' "$1" > "$TOOLS/$1/bin/$1"; chmod +x "$TOOLS/$1/bin/$1"; }

# GitHub's tools come from github.com's release downloads, never from GitHub's API: the API allows 60 calls an hour
# per address without a sign-in, an office shares one address, and the sign-in only comes at step 2. (2026-11-16, 09:21:
# the office's 60 were used up, the API answered 403, and a new tester's install stopped here.)
GH_PINNED=v2.104.0   # gh when github.com's "latest" names no release; any gh from 2.40 on works
# GitHub Desktop's portable git, pinned: its file names carry a build hash that only the API lists. To move it, take the
# tag, the hash and both macOS .tar.gz.sha256 files from https://github.com/desktop/dugite-native/releases.
DUGITE_TAG=v2.56.1 DUGITE_BUILD=238326e
DUGITE_SHA256_arm64=a882ec6882416b57d212a22bac845ae27944f96cf73453a864f6a12c17863a79
DUGITE_SHA256_x64=3fdb0c2f102fe0273d64b5d5fb77315c19f2b4648a154593723cb9ed98f2bc7d
TOOLS_WHY=""   # why a GitHub tool did not download, in words install.sh shows the person
GET_CODE=""    # the last GitHub download's HTTP code

_latest_tag() { # owner/repo: the newest release's tag, from github.com's own redirect to it
  curl -sS --max-time 20 -o /dev/null -w '%{redirect_url}' "https://github.com/$1/releases/latest" \
    | sed -n 's#^https://github\.com/[^/]*/[^/]*/releases/tag/\(v[0-9][0-9.]*\)$#\1#p'
}
_get() { # url file: one download from GitHub; when it fails, TOOLS_WHY says why
  local rc
  GET_CODE=$(curl -sSL --connect-timeout 30 --speed-limit 1024 --speed-time 60 -o "$2" -w '%{http_code}' "$1"); rc=$?
  [ "$rc" = 0 ] && [ "$GET_CODE" = 200 ] && return 0
  rm -f "$2"; echo "GitHub download failed: HTTP $GET_CODE, curl exit $rc, $1"
  case "$GET_CODE" in
    403|429) TOOLS_WHY="GitHub refused the download (HTTP $GET_CODE): it limits how much one office network downloads in an hour. Wait an hour before you try again.";;
    *) if [ "$rc" != 0 ]; then TOOLS_WHY="The download from GitHub did not finish (it stopped, or nothing answered). Check the internet connection."
       else TOOLS_WHY="GitHub answered HTTP $GET_CODE."; fi;;
  esac
  return 1
}
_sum_ok() { # sum file: the file matches the publisher's checksum, else it is removed
  printf '%s  %s\n' "$1" "$2" | shasum -a 256 -c - >/dev/null && return 0
  rm -f "$2"; echo "checksum failed: $2"; TOOLS_WHY="The download did not match its published checksum."; return 1
}

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
  TOOLS_WHY=""
  local tag; tag=$(_latest_tag cli/cli); tag=${tag:-$GH_PINNED}
  # A newest release without our file (still uploading, or renamed) falls back to the pinned one.
  _gh_from "$tag" || { [ "$GET_CODE" = 404 ] && [ "$tag" != "$GH_PINNED" ] && TOOLS_WHY="" && _gh_from "$GH_PINNED"; }
}
_gh_from() { # tag: gh from that release, checked against the release's own checksums
  local base="https://github.com/cli/cli/releases/download/$1" z="gh_${1#v}_macOS_${GARCH}.zip" sum
  _get "$base/gh_${1#v}_checksums.txt" gh-checksums.txt || return 1
  sum=$(awk -v z="$z" '$2 == z {print $1}' gh-checksums.txt); rm -f gh-checksums.txt
  _get "$base/$z" "$z" && _sum_ok "$sum" "$z" || return 1
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
  TOOLS_WHY=""
  local f sum="DUGITE_SHA256_$NARCH"; sum=${!sum:-}; f="dugite-native-$DUGITE_TAG-$DUGITE_BUILD-macOS-$NARCH.tar.gz"
  _get "https://github.com/desktop/dugite-native/releases/download/$DUGITE_TAG/$f" "$f" && _sum_ok "$sum" "$f" || return 1
  tar -xzf "$f" -C git && rm "$f"
  git_env
  git --version >/dev/null && git ls-remote https://github.com/desktop/dugite-native HEAD >/dev/null
}
