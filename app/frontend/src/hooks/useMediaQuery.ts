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

/**
 * THE BREAKPOINTS. These numbers are duplicated in globals.css's @media blocks
 * and the two MUST agree — a component that switches to a drawer at 1024 while
 * the stylesheet re-pads at 768 leaves a 256px-wide band where the layout is
 * half one thing and half the other.
 *
 *   phone   ≤ 768     single column, sheet/drawer UI, thumb-sized targets
 *   tablet  769–1024  still too narrow for map + 372px panel side by side
 *   desktop > 1024    the full console
 */
export const BP = { phone: 768, tablet: 1024 } as const;

/** Phone width. Use for content decisions inside a page. */
export const useIsMobile = () => useMediaQuery(`(max-width: ${BP.phone}px)`);

/** Tablet only — neither phone nor full desktop. */
export const useIsTablet = () =>
  useMediaQuery(`(min-width: ${BP.phone + 1}px) and (max-width: ${BP.tablet}px)`);

/**
 * Phone OR tablet — what the admin console keys its LAYOUT off.
 *
 * Below ~1024px a full-bleed map cannot also carry a 372px side panel and a
 * floating control rail; something has to become an overlay. The console used
 * to jump straight from the phone sheet to the full desktop layout at 769px,
 * so every tablet and half-width laptop window got a map barely wider than its
 * own toolbar, with the queue squeezing it further.
 */
export const useIsCompact = () => useMediaQuery(`(max-width: ${BP.tablet}px)`);

/** Coarse pointer (finger, not mouse) — the real reason to grow hit targets. */
export const useIsTouch = () => useMediaQuery("(pointer: coarse)");
