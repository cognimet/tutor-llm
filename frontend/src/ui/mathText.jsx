import React, { useMemo } from "react";
import katex from "katex";

/**
 * Shared LaTeX/math helpers for plain-text UI contexts (quiz questions & options,
 * card titles, SVG labels) where the tutor emits inline math like `$2x + 10^\circ$`
 * but the surrounding element renders text verbatim — so without this the raw
 * source (`$…$`, `^\circ`) leaks to the screen.
 */

const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", x: "ˣ", i: "ⁱ" };
const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

// Convert a handful of LaTeX tokens to Unicode for PLAIN-TEXT contexts (SVG
// labels etc.) where we can't run a full KaTeX layout. Best-effort: anything we
// don't recognise is left as readable text rather than corrupted.
export function latexToUnicode(input) {
  let s = String(input ?? "");
  // Drop math delimiters, keep the inner text.
  s = s
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\$([^$]*)\$/g, "$1");
  // Degrees first (so the caret is consumed): ^\circ / ^circ / ^{\circ} → °
  s = s
    .replace(/\^\s*\{?\s*\\?circ\s*\}?/g, "°")
    .replace(/\\circ\b/g, "°")
    .replace(/\\degree\b/g, "°");
  // Common operators / Greek letters.
  s = s
    .replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·")
    .replace(/\\div\b/g, "÷")
    .replace(/\\pm\b/g, "±")
    .replace(/\\leq\b/g, "≤")
    .replace(/\\geq\b/g, "≥")
    .replace(/\\neq\b/g, "≠")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\rightarrow\b/g, "→")
    .replace(/\\Rightarrow\b/g, "⇒")
    .replace(/\\to\b/g, "→")
    .replace(/\\pi\b/g, "π")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\gamma\b/g, "γ")
    .replace(/\\Delta\b/g, "Δ")
    .replace(/\\angle\b/g, "∠")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  // Single-token superscripts/subscripts: x^2 → x², a_1 → a₁
  s = s.replace(/\^\{?([0-9+\-nxi])\}?/g, (_, c) => SUP[c] || "^" + c);
  s = s.replace(/_\{?([0-9+\-])\}?/g, (_, c) => SUB[c] || "_" + c);
  // Strip leftover braces / lone backslashes from unknown commands.
  s = s.replace(/[{}]/g, "").replace(/\\([a-zA-Z]+)/g, "$1");
  return s;
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function renderInlineKatex(src) {
  try {
    return katex.renderToString(String(src).trim(), {
      displayMode: false,
      throwOnError: false,
      output: "html",
      strict: false,
    });
  } catch {
    return null;
  }
}

// Plain-text segment → escaped HTML with **bold** support and LaTeX→unicode for
// any stray commands outside math delimiters.
function renderPlain(text) {
  let out = escapeHtml(latexToUnicode(text));
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

// Match $$…$$ | \(…\) | $…$  (inline math islands inside a line of prose).
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;

function toMathHtml(text) {
  const raw = String(text ?? "");
  if (!raw) return "";
  if (raw.indexOf("$") === -1 && raw.indexOf("\\") === -1) {
    // Fast path: no math at all.
    return renderPlain(raw);
  }
  let out = "";
  let last = 0;
  let m;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(raw)) !== null) {
    out += renderPlain(raw.slice(last, m.index));
    const body = m[1] ?? m[2] ?? m[3];
    const k = renderInlineKatex(body);
    out += k != null ? k : renderPlain(m[0]);
    last = m.index + m[0].length;
  }
  out += renderPlain(raw.slice(last));
  return out;
}

/**
 * Inline math-aware text. Renders `$…$` / `\(…\)` via KaTeX and converts stray
 * LaTeX tokens (e.g. `^\circ`) to Unicode, so questions, options and titles show
 * real symbols (2x + 10°) instead of raw source. Safe: KaTeX output is trusted
 * and all non-math text is HTML-escaped.
 */
export default function MathText({ text, className = "", as: Tag = "span" }) {
  const html = useMemo(() => toMathHtml(text), [text]);
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
