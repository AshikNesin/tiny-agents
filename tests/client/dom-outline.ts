import { getRoles, prettyDOM } from "@testing-library/react";

const NAMED_BY_CONTENT = new Set(["button", "link", "heading", "tab", "menuitem", "option"]);
const UNINTERESTING_ROLES = new Set(["generic", "presentation", "none", "paragraph"]);
const STATES = [
  "aria-selected",
  "aria-expanded",
  "aria-haspopup",
  "aria-live",
  "aria-hidden",
  "aria-orientation",
  "aria-modal",
  "aria-disabled",
] as const;

const squash = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

function normalized(root: Element): Element {
  const clone = root.cloneNode(true) as Element;
  clone.normalize();
  for (const svg of clone.querySelectorAll("svg")) svg.replaceChildren();
  for (const attr of ["data-starting-style", "data-ending-style", "data-instant"]) {
    for (const el of clone.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  }
  if (clone instanceof HTMLElement && clone.tagName === "BODY") {
    clone.style.removeProperty("overflow");
    if (!clone.getAttribute("style")) clone.removeAttribute("style");
  }
  for (const el of clone.querySelectorAll<HTMLElement>("[style]")) {
    el.style.removeProperty("opacity");
    el.style.removeProperty("transform");
    el.style.removeProperty("animation-duration");
    el.style.removeProperty("animation-name");
    el.style.removeProperty("transition-duration");
    el.style.removeProperty("--collapsible-panel-height");
    el.style.removeProperty("--collapsible-panel-width");
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  return clone;
}

function numberIds(text: string): string {
  const ids = new Map<string, string>();
  return text.replace(/«[^»]*»|_[rR]_[0-9a-zA-Z]+_|:r[0-9a-z]+:/g, (id) => {
    if (!ids.has(id)) ids.set(id, `<id${ids.size + 1}>`);
    return ids.get(id)!;
  });
}

function iconName(svg: Element): string {
  const cls = svg.getAttribute("class") ?? "";
  const names = cls.split(/\s+/).filter((c) => c.startsWith("lucide-"));
  return names.join(" ") || "svg";
}

const rolesOf = getRoles as (
  container: HTMLElement,
  options: { hidden: boolean },
) => ReturnType<typeof getRoles>;

export function outline(root: Element = document.body): string {
  const tree = normalized(root);
  const roles = new Map<Element, string>();
  for (const [role, elements] of Object.entries(rolesOf(tree as HTMLElement, { hidden: true }))) {
    if (UNINTERESTING_ROLES.has(role)) continue;
    for (const element of elements) if (!roles.has(element)) roles.set(element, role);
  }
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    let pending = "";
    const flush = () => {
      const text = squash(pending);
      if (text) lines.push(`${pad}${JSON.stringify(text)}`);
      pending = "";
    };
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        pending += child.textContent ?? "";
        continue;
      }
      if (child.nodeType !== 1) continue;
      flush();
      const el = child as Element;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      if (el.tagName.toLowerCase() === "svg") {
        const label = el.getAttribute("aria-label");
        lines.push(`${pad}icon ${iconName(el)}${label ? ` ${JSON.stringify(label)}` : ""}`);
        continue;
      }
      const role = roles.get(el);
      const name =
        el.getAttribute("aria-label") ??
        (role && NAMED_BY_CONTENT.has(role) ? squash(el.textContent) : "");
      const attrs: string[] = [];
      const testId = el.getAttribute("data-testid");
      if (testId) attrs.push(`testid=${testId}`);
      const title = el.getAttribute("title");
      if (title) attrs.push(`title=${JSON.stringify(title)}`);
      const href = el.getAttribute("href");
      if (href) attrs.push(`href=${href}`);
      if (el.hasAttribute("disabled")) attrs.push("disabled");
      for (const state of STATES) {
        const value = el.getAttribute(state);
        if (value !== null) attrs.push(`${state}=${value}`);
      }
      if (role || attrs.length > 0) {
        const head = `${role ?? el.tagName.toLowerCase()}${name ? ` ${JSON.stringify(name)}` : ""}`;
        lines.push(`${pad}${head}${attrs.length ? ` [${attrs.join(", ")}]` : ""}`);
        walk(el, depth + 1);
      } else {
        walk(el, depth);
      }
    }
    flush();
  };
  walk(tree, 0);
  return numberIds(lines.join("\n"));
}

export function markup(root: Element = document.body): string {
  return numberIds(
    prettyDOM(normalized(root), Number.POSITIVE_INFINITY, { highlight: false }) || "",
  );
}
