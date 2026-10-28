#!/bin/bash
# Tweak's one-line install (Ilya 2026-10-24: "much faster and easier, not with Claude Code").
#   curl -fsSL https://raw.githubusercontent.com/ilyasver/tweak-install/main/install.sh | bash
# Public on purpose, and holds no Wix code. Before the sign-in: public tools only. After a sign-in
# that found an active wix-private member: the private app and its packages (installer/test/order.test.sh).
# The person watches one Tweak window (Chrome's app window, installer/page.mjs); Terminal only starts it.
set -uo pipefail
REF="${TWEAK_INSTALL_REF:-main}"
RAW="https://raw.githubusercontent.com/ilyasver/tweak-install/$REF"
APP_URL="${TWEAK_APP_URL:-https://github.com/ilyasver/tweak-app.git}"
APP_BRANCH="${TWEAK_APP_BRANCH:-main}"
APP="$HOME/Tweak/tweak-app"
DIR="$HOME/Tweak/installer"
PROG="$HOME/Tweak/install-progress.json"
LOG="$HOME/Tweak/install.log"
PAGE_PID="$DIR/page.pid"
mkdir -p "$HOME/Tweak" "$DIR"

progress() { # step pct label [line] [vpn]
  printf '{"step":%s,"of":5,"pct":%s,"label":"%s","line":"%s","vpn":%s}\n' "$1" "$2" "$3" "${4:-}" "${5:-false}" > "$PROG.tmp" && mv "$PROG.tmp" "$PROG"
  printf '%s of 5  %s\n' "$1" "$3"
}
stop() {
  printf '{"step":0,"of":5,"pct":0,"label":"Stopped","failed":"%s","next":"Paste the same line in Terminal again. If it stops again, send ~/Tweak/install.log to Ilya."}\n' "$1" > "$PROG"
  printf '\n%s\nPaste the same line again to retry. If it stops again, send ~/Tweak/install.log to Ilya.\n' "$1" >&2
  exit 1
}

# Everything runs inside main, so bash has read the whole script before it starts (a download cut
# short never runs half), and nothing below can eat the rest of a piped script by reading stdin.
# The body is not indented: installer/test/order.test.sh finds its steps by line start.
main() {
exec < /dev/null

[ "$(uname)" = Darwin ] || stop "Tweak runs on a Mac."
[ "$(sw_vers -productVersion | cut -d. -f1)" -ge 13 ] || stop "Tweak needs macOS 13 or newer."
if [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then open https://www.google.com/chrome; stop "Tweak opens in Google Chrome. Install Chrome, then paste the same line again."; fi

# The installer's own files: from the public repo, or from a local folder in a test run.
if [ -n "${TWEAK_INSTALL_LOCAL:-}" ]; then cp "$TWEAK_INSTALL_LOCAL"/tools.sh "$TWEAK_INSTALL_LOCAL"/page.mjs "$DIR/"
else for f in tools.sh page.mjs; do curl -fsSLo "$DIR/$f" "$RAW/$f" || stop "Could not download the installer. Check the internet connection."; done; fi
source "$DIR/tools.sh"

# A check only, nothing downloaded: say early that the VPN will be needed.
VPN_NOTE=""
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 https://npm.dev.wixpress.com/ 2>/dev/null | cut -c1)" = 2 ] || VPN_NOTE="Turn on the Wix VPN now. Tweak needs it in a few minutes."

progress 1 5 "Getting the tools" "$VPN_NOTE"
ensure_node >> "$LOG" 2>&1 || stop "Node did not download."
ensure_gh >> "$LOG" 2>&1 || stop "GitHub's tool did not download."
ensure_git >> "$LOG" 2>&1 || stop "git did not download."
ensure_pm >> "$LOG" 2>&1 || true   # a project can still install without them (package-manager.mjs makes them too)

progress 2 15 "Sign in" "$VPN_NOTE"
# Stop an older page from an earlier run, and only that: by the process number it wrote, and only
# if that process is still our page.mjs. (A pattern kill could match a person's unrelated process.)
# The new page stays up until a minute after Tweak opens: it stops itself, this script never does.
if [ -f "$PAGE_PID" ]; then
  OLD=$(cat "$PAGE_PID" 2>/dev/null)
  case "$(ps -p "${OLD:-0}" -o command= 2>/dev/null)" in *"$DIR/page.mjs"*) kill "$OLD" 2>/dev/null; sleep 1;; esac
  rm -f "$PAGE_PID"
fi
rm -f "$HOME/Tweak/.signin.json"
nohup node "$DIR/page.mjs" >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PAGE_PID"
echo "A Tweak window opened. Sign in there; this window can stay in the back."
for _ in $(seq 1 900); do [ -f "$HOME/Tweak/.signin.json" ] && break; sleep 2; done
grep -q '"ok":true' "$HOME/Tweak/.signin.json" 2>/dev/null || stop "The sign-in did not finish within 30 minutes."
WIX=$(node -p "require('$HOME/Tweak/.signin.json').wixAccount")
TOKEN=$(gh auth token --hostname github.com --user "$WIX" 2>/dev/null || gh auth token --hostname github.com)   # a GH_TOKEN sign-in has no name to ask by

progress 3 25 "Getting Tweak"
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64)"
if [ ! -d "$APP/.git" ]; then
  git -c http.extraheader="$AUTH" clone -q --branch "$APP_BRANCH" "$APP_URL" "$APP" >> "$LOG" 2>&1 \
    || stop "Your account $WIX cannot open Tweak yet. Ask Ilya to invite your work email in Share this team, then paste the same line again."
elif [ -z "$(git -C "$APP" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  # Pasted again: bring this copy up to the newest Tweak, so a Tweak that could not open gets the fix
  # (2026-10-25, Omer). Only a copy nobody changed, and only forward; otherwise it stays as it is.
  git -C "$APP" -c http.extraheader="$AUTH" fetch -q origin "$APP_BRANCH" >> "$LOG" 2>&1 && git -C "$APP" merge -q --ff-only FETCH_HEAD >> "$LOG" 2>&1 \
    || echo "This Tweak was not brought up to date; it opens as it is." >> "$LOG"
fi
cd "$APP" || stop "The Tweak folder is missing."
LOCK_SUM=$(shasum -a 256 package-lock.json 2>/dev/null | cut -c1-16)

progress 4 35 "Getting Tweak’s parts" "Under a gigabyte, once."
until curl -s -o /dev/null --max-time 6 https://npm.dev.wixpress.com/; do progress 4 35 "Getting Tweak’s parts" "" true; sleep 5; done
if [ -d node_modules ] && [ "$(cat "$HOME/Tweak/.parts-sum" 2>/dev/null)" = "$LOCK_SUM" ]; then ( true ) & CI=$!   # the same parts as last time: nothing to download
else ( npm ci --no-audit --no-fund >> "$LOG" 2>&1 && echo "$LOCK_SUM" > "$HOME/Tweak/.parts-sum" ) & CI=$!; fi
p=35; while kill -0 $CI 2>/dev/null; do sleep 3; [ $p -lt 80 ] && p=$((p + 1)); progress 4 $p "Getting Tweak’s parts" "Under a gigabyte, once. $(ls node_modules 2>/dev/null | wc -l | tr -d ' ') parts so far."; done
wait $CI || stop "Tweak’s parts did not download."
# The camera's own Chrome (about 100 MB) is optional: without it the camera borrows the person's Chrome.
# It keeps downloading after this script ends and is never waited on: on the Wix VPN it can stall, and an
# install would sit at "Opening Tweak" waiting for it (2026-10-25, Omer's Mac stopped there).
nohup npx --yes playwright-core install chromium-headless-shell >> "$LOG" 2>&1 < /dev/null &

progress 5 90 "Opening Tweak"
# The icon only, no window and no Finder: the person's sign-in window turns into Tweak (page.mjs).
# Then Tweak starts in the background, the way its icon starts it.
if [ -z "${TWEAK_INSTALL_NO_OPEN:-}" ]; then
npm run --silent app:install -- --no-open >> "$LOG" 2>&1 || stop "The Tweak icon could not be made."
TWEAK_NO_BROWSER=1 /bin/sh scripts/app/open.sh --no-window >> "$LOG" 2>&1 || stop "Tweak did not start."
fi
printf '{"step":5,"of":5,"pct":100,"label":"Tweak is open","open":true}\n' > "$PROG"
echo "Tweak is installed and open."
echo "To open Tweak later, press Cmd+Space and type Tweak, or find it in Launchpad."
}
main "$@"
