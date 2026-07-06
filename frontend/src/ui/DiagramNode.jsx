import React, { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { nodesApi } from "../api/endpoints.js";
import ReconstructedDiagram from "./ReconstructedDiagram.jsx";

/**
 * Resolves a `<diagram_* id="X" />` tag from the tutor stream into a rendered
 * diagram. The tutor chooses the representation (plan §5 Diagram Decision Rules):
 *
 *   variant="sketch"               → interactive UVSS ReconstructedDiagram
 *   variant="original|cleaned|…"   → the rendered image asset
 *
 * Auth-gated routes are loaded via axios (bearer token) as blobs → object URLs.
 * Degrades gracefully: a "sketch" whose UVSS is missing/low-confidence falls
 * back to the cleaned (then original) image, so a tag never renders an error.
 */

// Auth'd <img> that loads a node image variant as a blob and revokes on unmount.
function NodeImage({ id, variant, title }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url = null;
    let alive = true;
    setSrc(null);
    setFailed(false);
    nodesApi
      .image(id, variant)
      .then((u) => {
        if (alive) { url = u; setSrc(u); }
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id, variant]);

  if (failed) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-slate-800/60">
        <ImageOff className="h-4 w-4" /> Diagram image unavailable.
      </div>
    );
  }
  if (!src) {
    return <div className="my-3 h-48 w-full animate-pulse rounded-2xl bg-slate-100 dark:bg-white/5" />;
  }
  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900">
      <img src={src} alt={title || "Your diagram"} className="mx-auto max-h-[460px] w-auto" />
      <figcaption className="border-t border-slate-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-white/10">
        {variant === "original" ? "Your original drawing"
          : variant === "normalized" ? "Idealized sketch"
          : variant === "isolated" ? "Isolated from your notes"
          : "Cleaned drawing"}
        {title ? ` — ${title}` : ""}
      </figcaption>
    </figure>
  );
}

export default function DiagramNode({ id, variant = "sketch" }) {
  const wantsSketch = variant === "sketch";
  const [schema, setSchema] = useState(undefined); // undefined=loading, null=none
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!wantsSketch) return;
    let alive = true;
    setSchema(undefined);
    nodesApi
      .schema(id)
      .then((d) => {
        if (!alive) return;
        setMeta(d);
        setSchema(d?.has_schema && d?.schema ? d.schema : null);
      })
      .catch(() => alive && setSchema(null));
    return () => { alive = false; };
  }, [id, wantsSketch]);

  // Image variants render directly.
  if (!wantsSketch) return <NodeImage id={id} variant={variant} />;

  if (schema === undefined) {
    return <div className="my-3 h-64 w-full animate-pulse rounded-3xl bg-slate-100 dark:bg-white/5" />;
  }
  // Sketch requested but no usable UVSS → fall back to the cleaned image.
  if (!schema) return <NodeImage id={id} variant="cleaned" title={meta?.title} />;

  return <ReconstructedDiagram data={schema} />;
}
