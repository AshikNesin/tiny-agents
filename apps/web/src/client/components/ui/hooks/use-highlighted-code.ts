import * as React from "react";

import { importHighlighter } from "../lib/highlighter";

type Highlighter = NonNullable<Awaited<ReturnType<typeof importHighlighter>>>;
type GrammarState = Parameters<Highlighter["highlight"]>[1];

export function useHighlightedCode(value: string, language: string): React.ReactNode[] {
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;
  const [loaded, setLoaded] = React.useState<{
    language: string;
    highlighter: Highlighter | null;
  } | null>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;

  React.useEffect(() => {
    let cancelled = false;

    importHighlighter(language)
      .then((next) => {
        if (!cancelled) {
          setLoaded({ language, highlighter: next });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [language]);

  const [done, setDone] = React.useState<{
    highlighter: Highlighter | null;
    text: string;
    lines: React.ReactNode[];
    state?: GrammarState;
  }>({ highlighter: null, text: "", lines: [] });

  let next = done;

  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, text: "", lines: [] };
  }

  const end = code.lastIndexOf("\n") + 1;

  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state);

    next = {
      highlighter,
      text: code.slice(0, end),
      lines: [...next.lines, ...result.lines],
      state: result.state,
    };
  }

  if (next !== done) {
    setDone(next);
  }

  const tail = code.slice(end);

  return React.useMemo(() => {
    if (!highlighter) {
      return code.split("\n");
    }

    return [...next.lines, highlighter.highlight(tail, next.state).lines[0]];
  }, [code, highlighter, next, tail]);
}
