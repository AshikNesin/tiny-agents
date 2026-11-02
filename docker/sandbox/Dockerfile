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
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

# Debian packages to preinstall besides the desktop (e.g. "libreoffice-calc gimp").
ARG EXTRA_PACKAGES=""

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Base: sshd (key-only), sudo, tmux for the terminal, and the tools the
# app's scripts and bots' commands expect on the VM.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      openssh-server sudo tini tmux locales ca-certificates curl wget gnupg \
      python3 python3-pip python3-venv git jq less nano vim-tiny unzip zip \
      procps psmisc util-linux iproute2 iputils-ping dnsutils build-essential \
 && rm -rf /var/lib/apt/lists/*

# Browser stack (browser-vm-setup.ts installStackCommand).
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      tigervnc-standalone-server tigervnc-common \
      fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
 && ARCH="$(dpkg --print-architecture)" \
 && if [ "$ARCH" != amd64 ]; then echo "Google Chrome needs linux/amd64 (got $ARCH); build with --platform linux/amd64" >&2; exit 1; fi \
 && curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
 && apt-get install -y -qq /tmp/chrome.deb \
 && rm -f /tmp/chrome.deb \
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
ARG BROWSER_STACK_VERSION=v1
ARG COMPUTER_STACK_VERSION=v1
RUN su exedev -c "mkdir -p ~/.tiny-agents \
 && touch ~/.tiny-agents/browser-stack-${BROWSER_STACK_VERSION} \
          ~/.tiny-agents/computer-stack-${COMPUTER_STACK_VERSION}"

COPY sshd_config /etc/ssh/sshd_config
COPY --chmod=755 entrypoint.sh /usr/local/bin/sandbox-entrypoint

EXPOSE 22
# tini reaps the browsers and desktops the app starts with setsid/nohup.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-entrypoint"]
