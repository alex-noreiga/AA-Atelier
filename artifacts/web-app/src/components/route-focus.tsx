import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Moves keyboard/screen-reader focus to the new page on every client-side route
 * change. Without this, a wouter navigation swaps the page content while focus
 * stays stranded on the just-clicked link, so screen-reader users aren't told
 * the page changed and keyboard users resume tabbing from the old location.
 *
 * It targets the page's <h1> (falling back to the <main> landmark) so the new
 * page's title is announced. Renderless — drop it once inside <WouterRouter>.
 */
export function RouteFocus() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Don't hijack focus on the initial load: the browser already starts the
    // user at the top of the document. Only manage it on subsequent navigation.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const main = document.getElementById("main-content");
    if (!main) return;

    // Prefer the page's heading so a screen reader announces the page title;
    // fall back to the <main> landmark itself.
    const target = main.querySelector<HTMLElement>("h1") ?? main;
    // An <h1> isn't focusable by default; make it programmatically focusable
    // without adding it to the tab order. The outline it would show is scoped
    // away for pointer users in index.css (kept for :focus-visible).
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
    }
    target.focus();
  }, [location]);

  return null;
}
