import { use, useState } from "react";
import {
  CodeBlock,
  CodeBlockContainer,
  CodeBlockCopyButton,
  CodeBlockHeader,
  type CustomRendererProps,
} from "streamdown";
import { errorMessage } from "./errors";

type Drawn = { svg: string } | { error: string };

const drawings = new Map<string, Promise<Drawn>>();

function unparsable(error: unknown): Drawn {
  const lines = errorMessage(error, "Unknown diagram error.").split("\n");
  return { error: lines.length > 1 ? `${lines[0]} ${lines.at(-1)}` : lines[0] };
}

function draw(code: string): Promise<Drawn> {
  let drawn = drawings.get(code);
  if (!drawn) {
    drawn = import("pele/lazy")
      .then(({ renderAsync }) =>
        renderAsync(code, { fontFamily: getComputedStyle(document.body).fontFamily }),
      )
      .then(({ svg }) => ({ svg }), unparsable);
    drawings.set(code, drawn);
  }
  return drawn;
}

const toggleClass = "text-muted-foreground hover:text-foreground cursor-pointer px-1 text-xs";

export function MermaidBlock({ code, language, isIncomplete }: CustomRendererProps) {
  if (isIncomplete) return <CodeBlock code={code} language={language} isIncomplete />;
  return <Diagram code={code} language={language} />;
}

function Diagram({ code, language }: { code: string; language: string }) {
  const drawn = use(draw(code));
  const [source, setSource] = useState(false);
  if ("error" in drawn) {
    return (
      <div>
        <CodeBlock code={code} language={language}>
          <CodeBlockCopyButton />
        </CodeBlock>
        <p className="text-muted-foreground -mt-2 mb-2 text-xs">
          Couldn't draw this diagram: {drawn.error}
        </p>
      </div>
    );
  }
  const toggle = (
    <button type="button" className={toggleClass} onClick={() => setSource((s) => !s)}>
      {source ? "Show diagram" : "Show source"}
    </button>
  );
  if (source) {
    return (
      <CodeBlock code={code} language={language}>
        {toggle}
        <CodeBlockCopyButton />
      </CodeBlock>
    );
  }
  return (
    <CodeBlockContainer language={language}>
      <div className="relative">
        <CodeBlockHeader language={language} />
        <div className="absolute top-0 right-1 flex h-8 items-center gap-2">
          {toggle}
          <CodeBlockCopyButton code={code} />
        </div>
      </div>
      <div
        className="bg-background flex justify-center overflow-x-auto rounded-md border p-4"
        dangerouslySetInnerHTML={{ __html: drawn.svg }}
      />
    </CodeBlockContainer>
  );
}
