import { StrictMode, useSyncExternalStore, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./look.css";
import { reset } from "./chain";
import StepSetup from "./scenes/StepSetup";
import StepAsk from "./scenes/StepAsk";
import StepApprove from "./scenes/StepApprove";

// Mounts each demo into its slot on the page: <div data-demo="setup">. The
// slot's static fallback (the picture it held before) is replaced, so the
// page still reads with scripts off.

const DEMOS: Record<string, ComponentType> = {
  setup: StepSetup,
  ask: StepAsk,
  approve: StepApprove,
};

// Replay: one counter every demo keys on, so the chain restarts as one story
let run = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const getRun = () => run;

export function replay() {
  reset();
  run += 1;
  listeners.forEach((fn) => fn());
}

function Slot({ demo: Demo }: { demo: ComponentType }) {
  const key = useSyncExternalStore(subscribe, getRun);
  return <Demo key={key} />;
}

for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-demo]"))) {
  const Demo = DEMOS[el.dataset.demo ?? ""];
  if (!Demo) continue;
  el.replaceChildren();
  el.classList.add("is-live");
  createRoot(el).render(
    <StrictMode>
      <Slot demo={Demo} />
    </StrictMode>,
  );
}

for (const button of Array.from(document.querySelectorAll<HTMLElement>("[data-demo-replay]"))) {
  button.hidden = false;
  button.addEventListener("click", replay);
}
