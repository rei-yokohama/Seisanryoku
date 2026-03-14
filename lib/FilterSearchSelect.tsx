"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export function FilterSearchSelect({
  value,
  onChange,
  options,
  allLabel = "すべて",
  allValue = "",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
  allValue?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const selectedLabel = value === allValue
    ? allLabel
    : (options.find((o) => o.value === value)?.label || allLabel);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    setSearch("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleSelect = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  return (
    <div ref={containerRef} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={handleOpen}
        className={clsx(
          "w-full rounded-md border bg-white px-3 py-2 text-left text-sm font-bold outline-none transition",
          value !== allValue
            ? "border-orange-300 text-orange-800 bg-orange-50/40"
            : "border-slate-200 text-slate-800",
        )}
      >
        <span className="truncate block pr-5">{selectedLabel}</span>
        <span className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-400">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
          {options.length >= 5 && (
            <div className="p-1.5">
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="検索..."
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-orange-400"
              />
            </div>
          )}
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelect(allValue)}
              className={clsx(
                "w-full px-3 py-1.5 text-left text-xs font-bold transition hover:bg-orange-50",
                value === allValue ? "bg-orange-50 text-orange-700" : "text-slate-700",
              )}
            >
              {allLabel}
            </button>
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => handleSelect(o.value)}
                className={clsx(
                  "w-full px-3 py-1.5 text-left text-xs font-bold transition hover:bg-orange-50",
                  o.value === value ? "bg-orange-50 text-orange-700" : "text-slate-800",
                )}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && search.trim() && (
              <div className="px-3 py-2 text-center text-[10px] font-bold text-slate-400">該当なし</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
