import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { cn } from "@groot/ui/lib/utils";
import { Textarea } from "@groot/ui/textarea";
import { useTheme } from "@groot/shell/lib/theme";

export interface CodeMirrorLinkRange {
  from: number;
  to: number;
  href: string;
}

const loadEditorModules = () =>
  Promise.all([
    import("@uiw/react-codemirror"),
    import("@codemirror/lang-json"),
    import("@codemirror/view"),
  ]).then(([cm, langJson, view]) => ({
    CodeMirror: cm.default as ComponentType<Record<string, unknown>>,
    json: langJson.json,
    Decoration: view.Decoration,
    EditorView: view.EditorView,
  }));

type EditorModules = Awaited<ReturnType<typeof loadEditorModules>>;

type EditorLoad =
  | { status: "loading" }
  | { status: "ready"; modules: EditorModules }
  | { status: "failed" };

let editorLoad: EditorLoad = { status: "loading" };
const editorLoaded: Promise<EditorLoad> = loadEditorModules().then(
  (modules) => (editorLoad = { status: "ready", modules }),
  (error: unknown) => {
    console.error("Code editor failed to load; using a plain text field", error);
    return (editorLoad = { status: "failed" });
  },
);

interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  height?: string;
  editable?: boolean;
  lineWrapping?: boolean;
  basicSetup?: ReactCodeMirrorProps["basicSetup"];
  linkRanges?: CodeMirrorLinkRange[];
  onLinkClick?: (href: string) => void;
}

export function CodeMirrorEditor({
  value,
  onChange,
  height,
  editable = true,
  lineWrapping = false,
  basicSetup,
  linkRanges = [],
  onLinkClick,
}: CodeMirrorEditorProps) {
  const [load, setLoad] = useState(() => editorLoad);
  const mods = load.status === "ready" ? load.modules : null;
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let live = true;
    void editorLoaded.then((settled) => live && setLoad(settled));
    return () => {
      live = false;
    };
  }, []);

  const extensions = useMemo<Extension[]>(() => {
    if (!mods) return [];

    const extensions: Extension[] = [mods.json()];
    if (lineWrapping) extensions.push(mods.EditorView.lineWrapping);

    if (linkRanges.length > 0 && onLinkClick) {
      const linkMark = mods.Decoration.mark({ class: "cm-json-link" });
      const decorations = mods.Decoration.set(
        linkRanges.map((range) => linkMark.range(range.from, range.to)),
        true,
      );

      extensions.push(
        mods.EditorView.decorations.of(decorations),
        mods.EditorView.domEventHandlers({
          click(event, view) {
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const range =
              position === null
                ? undefined
                : linkRanges.find(({ from, to }) => position >= from && position <= to);
            if (!range) return false;
            onLinkClick(range.href);
            return true;
          },
        }),
      );
    }

    return extensions;
  }, [mods, lineWrapping, linkRanges, onLinkClick]);

  if (load.status === "failed") {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={!editable}
        spellCheck={false}
        aria-label="JSON"
        className={cn(
          "font-mono",
          !lineWrapping && "whitespace-pre",
          height && "[field-sizing:fixed]",
        )}
        style={{ height }}
      />
    );
  }
  if (!mods) return <div style={{ height }} />;

  const { CodeMirror } = mods;

  return (
    <CodeMirror
      value={value}
      height={height}
      extensions={extensions}
      onChange={onChange}
      editable={editable}
      theme={resolvedTheme}
      basicSetup={basicSetup}
    />
  );
}
