# The sandbox VM as a container: what `tiny-agents-vm` gives bots (a shell,
# the browser's Chrome on a VNC display, the computer's XFCE desktop and the
# terminal's tmux), reached over plain SSH with a key instead of Tailscale.
# See docs/guides/local-sandbox.md. Built and run by `pnpm sandbox:up`.
#
# The app installs what it needs on first use (`browser-vm-setup.ts`,
# `computer-vm-setup.ts`); this image installs it ahead of time and leaves
# the same markers, so the first bot call doesn't wait on apt. The package
# lists mirror those files; tests/server/app/agent/local-sandbox.test.ts
# keeps them in step.
#
# It builds for the host's architecture, so Apple Silicon runs it natively
# (no amd64 emulation, whose QEMU CPU lacks the AVX that Claude Code's and
# Bun's binaries need). Debian rather than Ubuntu because Debian ships
# Chromium as a .deb for arm64, where Google Chrome has no Linux build.
ARG BASE_IMAGE=debian:trixie
FROM ${BASE_IMAGE}

# Debian packages to preinstall besides the desktop (e.g. "libreoffice-calc gimp").
ARG EXTRA_PACKAGES=""

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Packages over HTTPS, with retries. The base image's sources are plain HTTP
# (http://deb.debian.org), so a caching proxy on the path (Docker's or
# Colima's network layer, a VPN, a corporate network) or a mirror mid-sync
# can serve a .deb that fails apt's hash check — the "Hash Sum mismatch"
# build failure. TLS pins the stream; retries ride out flaky fetches. The
# base image ships no CA bundle, so the one bootstrap install below still
# runs over HTTP — everything after it, including tzdata and the desktop,
# goes over HTTPS.
RUN printf 'Acquire::Retries "5";\n' > /etc/apt/apt.conf.d/80-retries \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends ca-certificates \
 && for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources; do \
      if [ -f "$f" ]; then sed -i 's|http://|https://|g' "$f"; fi; \
    done \
 && rm -rf /var/lib/apt/lists/*

# Base: sshd (key-only), sudo, tmux for the terminal, and the tools the
# app's scripts and bots' commands expect on the VM.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      openssh-server sudo tini tmux locales ca-certificates curl wget gnupg \
      python3 python3-pip python3-venv git jq less nano vim-tiny unzip zip \
      procps psmisc util-linux iproute2 iputils-ping bind9-dnsutils build-essential \
 && rm -rf /var/lib/apt/lists/*

# Browser stack (browser-vm-setup.ts installStackCommand). The app starts
# `google-chrome-stable`: Google Chrome on amd64, as on the VM; Debian's
# Chromium on arm64 (Chrome has no Linux arm64 build), under the same name
# via the wrapper below.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      tigervnc-standalone-server tigervnc-common \
      fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
 && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
      curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
      && apt-get install -y -qq /tmp/chrome.deb \
      && rm -f /tmp/chrome.deb; \
    else \
      apt-get install -y -qq --no-install-recommends chromium \
      && ln -s /usr/bin/chromium /usr/bin/google-chrome-stable \
      && echo 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --test-type"' > /etc/chromium.d/tiny-agents; \
    fi \
 && rm -rf /var/lib/apt/lists/*

# Computer stack (computer-vm-setup.ts COMPUTER_PACKAGES) plus the extras.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      tigervnc-standalone-server tigervnc-common tigervnc-tools \
      xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings xfconf \
      thunar xfce4-terminal mousepad \
      xdotool scrot xclip wmctrl dbus-x11 xdg-utils libgtk-3-bin python3 \
      fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
      ${EXTRA_PACKAGES} \
 && rm -rf /var/lib/apt/lists/*

# Chrome's own sandbox needs user namespaces, which Docker's default seccomp
# profile denies. The container is the boundary here, so every way of
# starting Chrome (the app's launch, the desktop's menu and panel) goes
# through a wrapper that adds --no-sandbox: the real launcher is diverted.
# (On arm64 that is the symlink to Chromium, whose own menu entry gets the
# flag from /etc/chromium.d above.)
# Chrome's own "Save password?" prompt stays off: the vault keeps sign-ins.
COPY chrome-policy.json /etc/opt/chrome/policies/managed/tiny-agents.json
COPY chrome-policy.json /etc/chromium/policies/managed/tiny-agents.json
COPY --chmod=755 chrome-wrapper.sh /usr/local/lib/tiny-agents/google-chrome-stable
RUN dpkg-divert --local --rename --add /usr/bin/google-chrome-stable \
 && ln -s /usr/local/lib/tiny-agents/google-chrome-stable /usr/bin/google-chrome-stable

# The desktop's "Terminal Emulator" and "Web Browser" launchers: apt picks
# whichever x-terminal-emulator sorts first (zutty, which needs OpenGL), so
# name XFCE's own terminal and Chrome explicitly.
RUN update-alternatives --set x-terminal-emulator /usr/bin/xfce4-terminal.wrapper \
 && sed -i -e 's/^TerminalEmulator=.*/TerminalEmulator=xfce4-terminal/' \
           -e 's/^WebBrowser=.*/WebBrowser=google-chrome/' /etc/xdg/xfce4/helpers.rc

# The VM's user: `exedev`, passwordless sudo (the app's installers use
# `sudo -n apt-get`), bash, a home that a named volume keeps across rebuilds.
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd --create-home --shell /bin/bash --uid 1000 exedev \
 && echo 'exedev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/exedev \
 && chmod 440 /etc/sudoers.d/exedev \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
 && mkdir -p /run/sshd /etc/ssh/host-keys /etc/ssh/authorized-keys

# The install markers the app checks (STACK_VERSION, COMPUTER_STACK_VERSION).
ARG BROWSER_STACK_VERSION=v2
ARG COMPUTER_STACK_VERSION=v1
RUN su exedev -c "mkdir -p ~/.tiny-agents \
 && touch ~/.tiny-agents/browser-stack-${BROWSER_STACK_VERSION} \
          ~/.tiny-agents/computer-stack-${COMPUTER_STACK_VERSION}"

# Claude Code for the Claude plan engine (packages/agent/src/engines/claude-code/
# sandbox-setup.ts): Node, the Agent SDK and the Claude Code CLI, pinned, in
# the directory the app looks in first. The app uploads and starts the
# worker itself; the owner only signs Claude Code in (Settings → Models → Claude plan).
# Outside the home volume, so a rebuild brings new pins even to an old volume.
ARG CLAUDE_WORKER_STACK_VERSION=v1
ARG CLAUDE_WORKER_NODE_VERSION=24.22.2
ARG CLAUDE_AGENT_SDK_VERSION=0.3.318
ARG CLAUDE_CODE_VERSION=2.1.318
ARG CLAUDE_WORKER_WS_VERSION=8.22.0
ARG CLAUDE_WORKER_ZOD_VERSION=4.6.7
RUN set -e; \
    DIR=/opt/tiny-agents/claude-worker; \
    case "$(dpkg --print-architecture)" in amd64) NA=x64 ;; arm64) NA=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    mkdir -p "$DIR"; \
    curl -fsSL "https://nodejs.org/dist/v${CLAUDE_WORKER_NODE_VERSION}/node-v${CLAUDE_WORKER_NODE_VERSION}-linux-${NA}.tar.gz" | tar -xz -C "$DIR"; \
    mv "$DIR/node-v${CLAUDE_WORKER_NODE_VERSION}-linux-${NA}" "$DIR/node"; \
    printf '{"name":"tiny-agents-claude-worker","private":true,"type":"module","dependencies":{"@anthropic-ai/claude-agent-sdk":"%s","@anthropic-ai/claude-code":"%s","ws":"%s","zod":"%s"}}\n' \
      "$CLAUDE_AGENT_SDK_VERSION" "$CLAUDE_CODE_VERSION" "$CLAUDE_WORKER_WS_VERSION" "$CLAUDE_WORKER_ZOD_VERSION" > "$DIR/package.json"; \
    cd "$DIR" && PATH="$DIR/node/bin:$PATH" npm install --omit=dev --no-audit --no-fund --loglevel=error; \
    test -x "$DIR/node_modules/.bin/claude"; \
    touch "$DIR/.stack-${CLAUDE_WORKER_STACK_VERSION}"; \
    chown -R exedev:exedev /opt/tiny-agents

# Shelley (https://github.com/boldsoftware/shelley), a web-based coding agent,
# started by the entrypoint and served on 127.0.0.1:9000 (compose.yml). Owned
# by exedev so Shelley's own in-UI upgrade can replace it. SHELLEY_VERSION is
# a release tag or `latest`; a failed download doesn't fail the build, since
# the entrypoint installs Shelley on start when it finds none. Build with
# INSTALL_SHELLEY=0 to leave it out of the image (it is then fetched on the
# first start unless SANDBOX_SHELLEY=0).
ARG INSTALL_SHELLEY=1
ARG SHELLEY_VERSION=latest
COPY --chmod=755 install-shelley.sh /usr/local/lib/tiny-agents/install-shelley
COPY --chmod=755 shelley-run.sh /usr/local/lib/tiny-agents/shelley-run
RUN if [ "$INSTALL_SHELLEY" = 1 ]; then \
      /usr/local/lib/tiny-agents/install-shelley /usr/local/bin/shelley "$SHELLEY_VERSION" \
      && chown exedev:exedev /usr/local/bin/shelley \
      || echo "Shelley was not installed at build time; the entrypoint will install it on start." >&2; \
    fi

# The prerequisite CLIs: gh (GitHub's CLI, from its signed apt repository)
# and codex (OpenAI's Codex CLI, from its GitHub release). Like Shelley, a
# failed download doesn't fail the build: the entrypoint checks for both on
# every start and installs whichever is missing. CODEX_VERSION is a release
# tag or `latest`; build with INSTALL_CLIS=0 to leave both to the first start
# (unless SANDBOX_CLIS=0).
ARG INSTALL_CLIS=1
ARG CODEX_VERSION=latest
COPY --chmod=755 install-clis.sh /usr/local/lib/tiny-agents/install-clis
RUN if [ "$INSTALL_CLIS" = 1 ]; then \
      /usr/local/lib/tiny-agents/install-clis "$CODEX_VERSION" \
      || echo "gh or codex was not installed at build time; the entrypoint will install it on start." >&2; \
    fi

COPY sshd_config /etc/ssh/sshd_config
COPY --chmod=755 entrypoint.sh /usr/local/bin/sandbox-entrypoint

EXPOSE 22 9000
# tini reaps the browsers and desktops the app starts with setsid/nohup.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-entrypoint"]
