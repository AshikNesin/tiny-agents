const rows = (win) => [...win.querySelectorAll('section[aria-label="Bots"] li')];
const rowOf = (win, name) =>
  rows(win).find((li) => li.querySelector("a .truncate")?.textContent === name);
const mode = (win) => (win.classList.contains("m") ? "mobile" : "desktop");

export function always(win, ctx) {
  codenav(win, ctx);
  for (const el of win.querySelectorAll(".fbx")) el.remove();
  const walk = win.ownerDocument.createTreeWalker(win, 4);
  while (walk.nextNode())
    if (walk.currentNode.nodeValue.includes("Test Model (faux)"))
      walk.currentNode.nodeValue = walk.currentNode.nodeValue.replace(
        "Test Model (faux)",
        "Claude Sonnet 5.5",
      );
}

export function sidebar(win, { loadSnap, args }) {
  const from = loadSnap(`${mode(win)}/side-${args[0]}`).querySelector(
    'aside[aria-label="Sidebar"]',
  );
  const to = win.querySelector('aside[aria-label="Sidebar"]');
  if (from && to) to.replaceWith(from);
  codenav(win, { loadSnap });
}

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

export function read(win, { args }) {
  const slot = rowOf(win, args[0])?.querySelector("a > span:last-child");
  if (slot) slot.innerHTML = "";
}

export function unread(win, { loadSnap, args }) {
  const dot = loadSnap(`${mode(win)}/side-researcher`).querySelector(
    'section[aria-label="Bots"] [aria-label="Unread"]',
  );
  const slot = rowOf(win, args[0])?.querySelector("a > span:last-child");
  if (dot && slot) slot.innerHTML = dot.outerHTML;
}

export function codenav(win, { loadSnap }) {
  const nav = win.querySelector('aside nav[aria-label="Primary"]');
  if (!nav || nav.querySelector('a[aria-label="Code"]')) return;
  const link = loadSnap(`${mode(win)}/codebuddy-chat`).querySelector(
    'aside nav a[aria-label="Code"]',
  );
  const tasks = nav.querySelector('a[aria-label="Tasks"]');
  if (link && tasks) tasks.after(link);
}
