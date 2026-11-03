import { Bar, Roll, Segmented, Stage, Text, type Act } from "../parts";
import { Face } from "../Face";
import { done } from "../chain";
import "./setup.css";

// Step 1, "Make it yours": the Travel Planner's tool permissions. The cursor
// sets Payments from Allow to Ask; the thumb slides and the row's note rolls
// from "Runs on its own" to "Asks you first". One gesture, then it holds.
//
// Real strings: the agent's name and status, the three tools, the segment
// labels and the Payments note. Everything else is bars.
//
// Framing: pinned, bottom bleed. The card is inset a 24px gutter top and
// sides and runs off the bottom just past its last row.

const SEG = ["Allow", "Ask", "Off"];

type S = { payments: number };

const initial: S = { payments: 0 };
const poster: S = { payments: 1 };

async function script(a: Act<S>) {
  await a.wait(700);
  a.mark("press");
  await a.click({ at: "payments-ask", x: 0.7, y: 0.66 });
  a.put({ payments: 1 });
  await a.wait(500);
  // Off the control, so the new label and note read clear
  await a.move({ x: 250, y: 236 });
  await a.wait(1400);
  done("setup");
  await a.wait(1200);
}

export default function StepSetup() {
  return (
    <Stage
      width={360}
      height={252}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: { x: 330, y: 240 }, ripple: true }}
      className="ta ta-setup"
    >
      {(s) => (
        <div className="ta-card ta-setup__card">
          <div className="ta-setup__head">
            <Face size={30} />
            <div className="ta-setup__who">
              <Text className="ta-setup__name">Travel Planner</Text>
              <span className="ta-setup__status">
                <span className="ta-setup__dot" />
                <Text>Online</Text>
              </span>
            </div>
          </div>
          <div className="ta-setup__rows">
            <div className="ta-setup__row">
              <div className="ta-setup__label">
                <Text className="ta-setup__tool">Browser</Text>
                <Bar w={72} h={5} tone={2} />
              </div>
              <Segmented className="ta-setup__seg" items={SEG} value={0} />
            </div>
            <div className="ta-setup__row">
              <div className="ta-setup__label">
                <Text className="ta-setup__tool">Payments</Text>
                <span className="ta-setup__note" data-ask={s.payments === 1 || undefined}>
                  <Roll variant="fade">
                    {s.payments === 1 ? "Asks you first" : "Runs on its own"}
                  </Roll>
                </span>
              </div>
              <Segmented
                className="ta-setup__seg"
                items={SEG}
                value={s.payments}
                targets={["payments-allow", "payments-ask", "payments-off"]}
                cursor="pointer"
              />
            </div>
            <div className="ta-setup__row">
              <div className="ta-setup__label">
                <Text className="ta-setup__tool">Terminal</Text>
                <Bar w={56} h={5} tone={2} />
              </div>
              <Segmented className="ta-setup__seg" items={SEG} value={2} />
            </div>
          </div>
        </div>
      )}
    </Stage>
  );
}
