import React from "react";

/**
 * Bento grid (Fancy Learning spec §2) — lays cards side-by-side for comparisons
 * (e.g. similarities vs differences, herbs vs shrubs) instead of a heavy vertical
 * stack. Collapses to a single column on small screens.
 */
export default function BentoGrid({ children, cols = 2 }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const colClass = (cols >= 3 || items.length >= 3) ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div className={`my-3 grid grid-cols-1 gap-3 ${colClass}`}>
      {items.map((child, i) => (
        <div key={i} className="transition-transform duration-300 hover:scale-[1.01] [&>*]:my-0 [&>*]:h-full">
          {child}
        </div>
      ))}
    </div>
  );
}
