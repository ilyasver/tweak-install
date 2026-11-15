# Tweak installer

The one line that installs Tweak on a Mac:

    curl -fsSL https://raw.githubusercontent.com/ilyasver/tweak-install/main/install.sh | bash

This repo holds only the installer: the tools (Node, GitHub's gh, git), the sign-in page, and the
steps. Tweak itself is private; the sign-in decides who gets it. Made from `installer/` in
ilyasver/tweak-app; change it there, then copy the files here.

The install reports how far it got to Wix's monitoring (installer/telemetry.mjs): each step's time, the step that
stopped it with the first line of its error, and its finish. Never a file, a token, a path with the home folder, or the
GitHub login (only a hash of it). To turn it off, end the line with `| TWEAK_TELEMETRY=0 bash` instead of `| bash`.
