import { Check, Roll, Stage, States, Text, type Act } from "../parts";
import { after, done } from "../chain";
import "./approve.css";

// Step 3, "Say yes when it counts": the approval card the agent stops on
// before it pays. The cursor presses Approve; the button goes busy on
// itself, then reads Paid; the card's kicker rolls from "Needs your
// approval" to "Approved", amber to green, and Deny steps back.
//
// Real strings: the kicker, the title, the flight and card, the two buttons.
//
// Framing: one component shown whole at real size, a 24px gutter all round,
// the way the page's other step cards sit on their tile.

type S = { pay: "ask" | "busy" | "paid" };

const initial: S = { pay: "ask" };
const poster: S = { pay: "paid" };

async function script(a: Act<S>) {
  await after("ask");
  await a.wait(400);
  a.mark("press");
  await a.click({ at: "approve", x: 0.78, y: 0.7 });
  a.put({ pay: "busy" });
  await a.wait(1100);
  a.mark("paid");
  a.put({ pay: "paid" });
  // Off the button, so "Paid" reads clear
  await a.move({ x: 318, y: 238 });
  await a.wait(2400);
  done("approve");
}

export default function StepApprove() {
  const kicker = (s: S) => (s.pay === "paid" ? "Approved" : "Needs your approval");
  return (
    <Stage
      width={360}
      height={252}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      cursor={{ at: { x: 330, y: 244 }, ripple: true }}
      className="ta ta-approve"
    >
      {(s) => (
        <div className="ta-card ta-approve__card" data-state={s.pay}>
          <span className="ta-approve__kicker">
            <Roll variant="fade">{kicker(s)}</Roll>
          </span>
          <Text className="ta-approve__title">Pay ₹3,412 for 1 ticket</Text>
          <div className="ta-approve__facts">
            <Text className="ta-approve__k">Flight</Text>
            <Text className="ta-approve__v">MAA → BLR · Fri 18:40</Text>
            <Text className="ta-approve__k">Seat</Text>
            <Text className="ta-approve__v">14A · Window</Text>
            <Text className="ta-approve__k">Card</Text>
            <Text className="ta-approve__v">Visa ···· 4242 · Vault</Text>
          </div>
          <div className="ta-approve__actions">
            <span className="ta-approve__btn ta-approve__deny">Deny</span>
            <span
              className="ta-approve__btn ta-approve__yes"
              data-target="approve"
              data-cursor="pointer"
            >
              <States
                value={s.pay}
                states={{
                  ask: <span>Approve</span>,
                  busy: <Check on={false} pending size={14} />,
                  paid: (
                    <span className="ta-approve__paid">
                      <Check on size={14} />
                      Paid
                    </span>
                  ),
                }}
              />
            </span>
          </div>
        </div>
      )}
    </Stage>
  );
}
