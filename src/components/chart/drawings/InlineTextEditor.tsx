"use client";

import { useRef } from "react";

/**
 * The on-chart text editor: a `<textarea>` in a `<foreignObject>`, opened in
 * place of a label. Enter (without Shift) or blur finishes with the typed
 * value; Escape cancels. Shared by the text tool and the line tools' labels.
 *
 * `x`/`y` are the text's baseline anchor, as for an SVG `<text>`; `align`
 * mirrors its `text-anchor`, so the box opens where the label reads from.
 */
export function InlineTextEditor({
  x,
  y,
  fontSize,
  color,
  initialValue,
  onFinish,
  onCancel,
  align = "start",
  bold = false,
  italic = false,
  placeholder,
}: {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  initialValue: string;
  onFinish: (value: string) => void;
  onCancel: () => void;
  align?: "start" | "middle" | "end";
  bold?: boolean;
  italic?: boolean;
  placeholder?: string;
}) {
  // Escape unmounts the textarea, which some browsers follow with a blur —
  // only the first of finish/cancel counts.
  const doneRef = useRef(false);
  function done(fn: () => void) {
    if (doneRef.current) return;
    doneRef.current = true;
    fn();
  }
  const width = 220;
  const left = align === "middle" ? x - width / 2 : align === "end" ? x - width : x;

  return (
    <foreignObject x={left} y={y - fontSize} width={width} height={90} style={{ overflow: "visible" }}>
      <textarea
        autoFocus
        defaultValue={initialValue}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          const value = e.currentTarget.value;
          done(() => onFinish(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLTextAreaElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            done(onCancel);
          }
          e.stopPropagation();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="resize-none rounded border border-tv-blue bg-tv-panel px-1 py-0.5 outline-none"
        style={{
          pointerEvents: "auto",
          color,
          fontSize,
          fontWeight: bold ? "bold" : undefined,
          fontStyle: italic ? "italic" : undefined,
          textAlign: align === "middle" ? "center" : align === "end" ? "right" : undefined,
          width: 210,
          minHeight: fontSize + 8,
          lineHeight: 1.2,
        }}
      />
    </foreignObject>
  );
}
