import { expect, afterEach } from "vite-plus/test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { MotionGlobalConfig } from "motion/react";
import { toast } from "sonner";
import { pinClockWhileLoadingAndBeforeEachTest } from "../test-clock";

pinClockWhileLoadingAndBeforeEachTest();

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// Motion animations (dialogs, tooltips, tabs, …) finish at once under test, so
// assertions never catch a surface mid-fade or still mounted for its exit.
MotionGlobalConfig.skipAnimations = true;

// jsdom lacks the Pointer Capture, scroll-into-view and ResizeObserver APIs
// Radix primitives (Select, Dropdown, Tooltip, …), cmdk and the command menu rely on. Minimal stubs — enough for the
// interaction paths exercised by component tests; not a faithful polyfill.
if (typeof window !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

// <html> and <body> attributes as the file found them. Overlays write to them
// (Radix sets and then empties body's style), and a pinned snapshot of the body
// would otherwise record what an earlier test left behind.
const rootAttributes = (el: Element) =>
  new Map(Array.from(el.attributes, (a) => [a.name, a.value]));
const initialAttributes =
  typeof document === "undefined"
    ? []
    : [document.documentElement, document.body].map((el) => [el, rootAttributes(el)] as const);

// Cleanup after each test
afterEach(() => {
  cleanup();
  // Sonner keeps toasts in module state and replays the active ones to the
  // next Toaster that mounts, so a test would see the previous test's toasts.
  toast.dismiss();
  for (const [el, attributes] of initialAttributes) {
    // A copy: removing from the live NamedNodeMap while walking it skips entries.
    for (const { name } of Array.from(el.attributes)) {
      if (!attributes.has(name)) el.removeAttribute(name);
    }
    for (const [name, value] of attributes) el.setAttribute(name, value);
  }
});
