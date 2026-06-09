// Static Tailwind class maps so colors survive JIT purging.
export const TINTS = {
  indigo: { soft: "bg-indigo-50", text: "text-indigo-600", ring: "ring-indigo-200", solid: "bg-indigo-500", grad: "from-indigo-500 to-violet-500", dot: "bg-indigo-400", border: "border-indigo-200" },
  violet: { soft: "bg-violet-50", text: "text-violet-600", ring: "ring-violet-200", solid: "bg-violet-500", grad: "from-violet-500 to-fuchsia-500", dot: "bg-violet-400", border: "border-violet-200" },
  emerald: { soft: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-200", solid: "bg-emerald-500", grad: "from-emerald-500 to-teal-500", dot: "bg-emerald-400", border: "border-emerald-200" },
  amber: { soft: "bg-amber-50", text: "text-amber-600", ring: "ring-amber-200", solid: "bg-amber-500", grad: "from-amber-500 to-orange-500", dot: "bg-amber-400", border: "border-amber-200" },
  rose: { soft: "bg-rose-50", text: "text-rose-600", ring: "ring-rose-200", solid: "bg-rose-500", grad: "from-rose-500 to-pink-500", dot: "bg-rose-400", border: "border-rose-200" },
  sky: { soft: "bg-sky-50", text: "text-sky-600", ring: "ring-sky-200", solid: "bg-sky-500", grad: "from-sky-500 to-cyan-500", dot: "bg-sky-400", border: "border-sky-200" },
};
export const tint = (name) => TINTS[name] || TINTS.indigo;
