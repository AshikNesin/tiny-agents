import { ArrowUp, Globe } from "lucide-react";
import { Bar, Check, Collapse, Field, Stage, States, Stream, Text, type Act } from "../parts";
import { after, done } from "../chain";
import "./ask.css";

const Q = "Book a Friday evening flight to Bangalore";
const A = "Best fit: 18:40, 55 min, ₹3,412, window seat.";
const WORDS = A.split(" ").length;
const STRONG = new Set([2, 3, 4, 5]);

type S = {
  draft: string;
  sent: boolean;
  memory: boolean;
  tool: "idle" | "running" | "done";
  words: number;
};

const initial: S = { draft: "", sent: false, memory: false, tool: "idle", words: 0 };
const poster: S = { draft: "", sent: true, memory: true, tool: "done", words: WORDS };

async function script(a: Act<S>) {
  await after("setup");
  await a.wait(500);
  a.mark("type");
  await a.type("draft", Q, { interval: 34 });
  await a.wait(350);
  a.mark("send");
  a.put({ sent: true, draft: "" });
  await a.wait(750);
  a.mark("memory");
  a.put({ memory: true });
  await a.wait(800);
  a.mark("tool");
  a.put({ tool: "running" });
  await a.wait(1500);
  a.put({ tool: "done" });
  await a.wait(450);
  a.mark("answer");
  for (let i = 1; i <= WORDS; i++) {
    a.put({ words: i });
    await a.wait(70);
  }
  await a.wait(1400);
  done("ask");
  await a.wait(1200);
}

export default function StepAsk() {
  return (
    <Stage
      width={360}
      height={252}
      initial={initial}
      poster={poster}
      script={script}
      play="once"
      className="ta ta-ask"
    >
      {(s) => (
        <div className="ta-card ta-ask__panel">
          <div className="ta-ask__thread">
            {(
              [
                [140, "70%", "44%"],
                [120, "78%", "52%"],
                [160, "86%", "64%"],
              ] as const
            ).map(([q, a1, a2], i) => (
              <div className="ta-ask__past" aria-hidden="true" key={i}>
                <Bar w={q} h={26} r={13} tone={1} className="ta-ask__past-q" />
                <Bar w={a1} h={6} r={3} tone={2} />
                <Bar w={a2} h={6} r={3} tone={2} />
              </div>
            ))}
            <Collapse open={s.sent} reveal="drop" from="below">
              <div className="ta-ask__turn ta-ask__q">
                <Text>{Q}</Text>
              </div>
            </Collapse>
            <Collapse open={s.memory} reveal="drop" from="below">
              <div className="ta-ask__turn ta-ask__memory">
                <Text className="ta-ask__memory-label">Remembered</Text>
                <span className="ta-ask__chip">Window seat</span>
                <span className="ta-ask__chip">No red-eyes</span>
              </div>
            </Collapse>
            <Collapse open={s.tool !== "idle"} reveal="drop" from="below">
              <div className="ta-ask__turn">
                <div className="ta-ask__tool" data-done={s.tool === "done" || undefined}>
                  <Globe
                    className="ta-ask__globe"
                    size={14}
                    strokeWidth={1.75}
                    absoluteStrokeWidth
                    aria-hidden
                  />
                  <States
                    className="ta-ask__tool-label"
                    align="start"
                    value={s.tool === "done" ? "done" : "running"}
                    states={{
                      running: "Comparing fares on 3 sites",
                      done: "Compared fares on 3 sites",
                    }}
                  />
                  <Check on={s.tool === "done"} pending={s.tool === "running"} size={14} />
                </div>
              </div>
            </Collapse>
            <Collapse open={s.words > 0} reveal="drop" from="below">
              <div className="ta-ask__turn">
                <Stream
                  className="ta-ask__answer"
                  text={A}
                  count={s.words}
                  mark={(_, i) => STRONG.has(i)}
                />
              </div>
            </Collapse>
          </div>
          <Field
            className="ta-ask__composer"
            value={s.draft}
            focused={!s.sent || s.draft.length > 0}
            placeholder="Message Travel Planner"
            trailing={
              <span className="ta-ask__send" data-ready={s.draft.length > 0 || undefined}>
                <ArrowUp size={14} strokeWidth={2} absoluteStrokeWidth aria-hidden />
              </span>
            }
          />
        </div>
      )}
    </Stage>
  );
}
