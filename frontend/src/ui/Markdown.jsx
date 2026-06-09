import React, { useMemo, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";

marked.setOptions({ gfm: true, breaks: true });

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Custom renderer: fenced code blocks get a header bar (language + copy button)
// and links open safely in a new tab.
marked.use({
  renderer: {
    code({ text, lang }) {
      const label = (lang || "").trim().split(/\s+/)[0] || "code";
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      return (
        `<div class="md-code">` +
          `<div class="md-code-bar">` +
            `<span class="md-code-lang">${escapeHtml(label)}</span>` +
            `<button type="button" class="md-code-copy" data-code-copy aria-label="Copy code">Copy</button>` +
          `</div>` +
          `<pre><code${cls}>${escapeHtml(text)}\n</code></pre>` +
        `</div>`
      );
    },
    link({ href, title, text }) {
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

// Render a LaTeX snippet to HTML, degrading gracefully to the raw source.
function renderMath(src, displayMode) {
  try {
    return katex.renderToString(src.trim(), {
      displayMode,
      throwOnError: false,
      output: "html",
      strict: false,
    });
  } catch {
    return null;
  }
}

// Pull math out first (so Markdown doesn't mangle it), parse + sanitize the
// rest, then splice the trusted KaTeX HTML back in via placeholders.
function toHtml(text) {
  if (!text) return "";

  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `@@KMATH${tokens.length - 1}@@`;
  };

  let out = String(text)
    // Display math: $$ ... $$  and  \[ ... \]
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, body) => {
      const html = renderMath(body, true);
      return html ? stash(html) : m;
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, body) => {
      const html = renderMath(body, true);
      return html ? stash(html) : m;
    })
    // Inline math: \( ... \)  and  $ ... $  (single line, no leading/trailing space)
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, body) => {
      const html = renderMath(body, false);
      return html ? stash(html) : m;
    })
    .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (m, body) => {
      const html = renderMath(body, false);
      return html ? stash(html) : m;
    });

  let html = marked.parse(out);
  html = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });

  // Re-insert KaTeX (library-generated, not user free-form HTML).
  html = html.replace(/@@KMATH(\d+)@@/g, (_, i) => tokens[Number(i)] ?? "");
  return html;
}

/**
 * Renders tutor Markdown (with LaTeX math) safely. Add `streaming` while a
 * reply is still arriving to show a blinking caret. Code blocks expose a
 * one-click copy button handled here via event delegation.
 */
export default function Markdown({ text, streaming = false, className = "" }) {
  const html = useMemo(() => toHtml(text), [text]);

  const onClick = useCallback((e) => {
    const btn = e.target.closest("[data-code-copy]");
    if (!btn) return;
    const pre = btn.closest(".md-code")?.querySelector("pre");
    const code = pre?.innerText ?? "";
    navigator.clipboard?.writeText(code.replace(/\n$/, "")).then(() => {
      btn.classList.add("is-copied");
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.textContent = "Copy";
      }, 1400);
    }).catch(() => { /* clipboard unavailable */ });
  }, []);

  return (
    <div
      onClick={onClick}
      className={`md ${streaming ? "md-stream" : ""} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
