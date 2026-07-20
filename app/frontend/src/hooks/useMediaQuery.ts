"use client";
import { useState, useEffect } from "react";

/** True when the media query matches. SSR-safe (starts false, resolves on mount). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Phone-width breakpoint (<= 768px). */
export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
