"use client";

import { useEffect, useMemo, useState } from "react";

type SetState<T> = (next: T | ((prev: T) => T)) => void;

function safeParseJson<T>(raw: string | null): { ok: true; value: T } | { ok: false } {
  if (!raw) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false };
  }
}

/**
 * LocalStorage 永続の簡易 state（client component 専用）
 * - 初回は localStorage -> なければ initialValue
 * - 値が変わるたび JSON で保存
 */
export function useLocalStorageState<T>(key: string, initialValue: T) {
  const initialJson = useMemo(() => JSON.stringify(initialValue), [initialValue]);
  const [state, setState] = useState<T>(initialValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const parsed = safeParseJson<T>(typeof window === "undefined" ? null : window.localStorage.getItem(key));
    if (parsed.ok) setState(parsed.value);
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore quota / private mode
    }
  }, [key, state, loaded]);

  const clear = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
    setState(JSON.parse(initialJson) as T);
  };

  return { state, setState: setState as SetState<T>, loaded, clear } as const;
}


