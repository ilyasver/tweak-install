# Tweak installer

The one line that installs Tweak on a Mac:

    curl -fsSL https://raw.githubusercontent.com/ilyasver/tweak-install/main/install.sh | bash

This repo holds only the installer: the tools (Node, GitHub's gh, git), the sign-in page, and the
steps. Tweak itself is private; the sign-in decides who gets it. Made from `installer/` in
ilyasver/tweak-app; change it there, then copy the files here.
