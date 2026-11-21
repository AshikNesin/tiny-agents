import { expect, afterEach } from "vite-plus/test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { MotionGlobalConfig } from "motion/react";
import { toast } from "sonner";
import { pinClockWhileLoadingAndBeforeEachTest } from "../test-clock";

pinClockWhileLoadingAndBeforeEachTest();

expect.extend(matchers);

MotionGlobalConfig.skipAnimations = true;

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

const rootAttributes = (el: Element) =>
  new Map(Array.from(el.attributes, (a) => [a.name, a.value]));
const initialAttributes =
  typeof document === "undefined"
    ? []
    : [document.documentElement, document.body].map((el) => [el, rootAttributes(el)] as const);

afterEach(() => {
  cleanup();
  toast.dismiss();
  for (const [el, attributes] of initialAttributes) {
    for (const { name } of Array.from(el.attributes)) {
      if (!attributes.has(name)) el.removeAttribute(name);
    }
    for (const [name, value] of attributes) el.setAttribute(name, value);
  }
});
