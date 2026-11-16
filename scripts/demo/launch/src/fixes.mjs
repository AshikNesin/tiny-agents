// Edits applied to an app snapshot when a scene includes it (tools/build.mjs):
//   <div class="appwin" data-snap="desktop/x" data-fix="name:arg; other"></div>
// Each one only rearranges, hides or relabels markup the app rendered. The
// sidebar is staged once (tools/stage-inbox.mjs) and swapped into the other
// areas' snapshots, whose own instances only had one bot.

const rows = (win) => [...win.querySelectorAll('section[aria-label="Bots"] li')];
const rowOf = (win, name) =>
  rows(win).find((li) => li.querySelector("a .truncate")?.textContent === name);
const mode = (win) => (win.classList.contains("m") ? "mobile" : "desktop");

/** Runs on every snapshot. */
export function always(win, ctx) {
  codenav(win, ctx);
  // The app's feedback button is not part of the product story.
  for (const el of win.querySelectorAll(".fbx")) el.remove();
  // The staging instances answer with the test model; the picker shows a real one's name.
  const walk = win.ownerDocument.createTreeWalker(win, 4);
  while (walk.nextNode())
    if (walk.currentNode.nodeValue.includes("Test Model (faux)"))
      walk.currentNode.nodeValue = walk.currentNode.nodeValue.replace(
        "Test Model (faux)",
        "Claude Sonnet 5.5",
      );
}

/** sidebar:<state> swaps in the sidebar of snap/<mode>/side-<state>. */
export function sidebar(win, { loadSnap, args }) {
  const from = loadSnap(`${mode(win)}/side-${args[0]}`).querySelector(
    'aside[aria-label="Sidebar"]',
  );
  const to = win.querySelector('aside[aria-label="Sidebar"]');
  if (from && to) to.replaceWith(from);
  codenav(win, { loadSnap });
}

/** active:<Bot> moves the open-chat highlight to that bot's row. */
export function active(win, { args }) {
  for (const li of rows(win)) {
    const a = li.querySelector("a");
    const on = li === rowOf(win, args[0]);
    a.classList.toggle("bg-sidebar-accent", on);
    a.classList.toggle("hover:bg-sidebar-accent", !on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/** read:<Bot> clears that row's unread dot or waiting count. */
export function read(win, { args }) {
  const slot = rowOf(win, args[0])?.querySelector("a > span:last-child");
  if (slot) slot.innerHTML = "";
}

/** unread:<Bot> gives that row the unread dot, copied from a row the app drew one on. */
export function unread(win, { loadSnap, args }) {
  const dot = loadSnap(`${mode(win)}/side-researcher`).querySelector(
    'section[aria-label="Bots"] [aria-label="Unread"]',
  );
  const slot = rowOf(win, args[0])?.querySelector("a > span:last-child");
  if (dot && slot) slot.innerHTML = dot.outerHTML;
}

/** codenav adds the sidebar's Code link, which the app shows once a coding agent is set up. */
export function codenav(win, { loadSnap }) {
  const nav = win.querySelector('aside nav[aria-label="Primary"]');
  if (!nav || nav.querySelector('a[aria-label="Code"]')) return;
  const link = loadSnap(`${mode(win)}/codebuddy-chat`).querySelector(
    'aside nav a[aria-label="Code"]',
  );
  const tasks = nav.querySelector('a[aria-label="Tasks"]');
  if (link && tasks) tasks.after(link);
}
