#!/bin/sh
# Installed in place of /usr/bin/google-chrome-stable (the original is
# diverted to google-chrome-stable.distrib). Chrome's sandbox can't create
# user namespaces under Docker's default seccomp profile, so it runs without
# it; the container is the boundary. --test-type hides the "unsupported
# command-line flag" bar that would otherwise sit in the live view. exec
# keeps the PID the app records for teardown.
exec /usr/bin/google-chrome-stable.distrib --no-sandbox --test-type "$@"
