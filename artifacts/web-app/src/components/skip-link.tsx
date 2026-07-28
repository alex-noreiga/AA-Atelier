/**
 * "Skip to content" link — the first focusable element on the page, hidden until
 * it receives keyboard focus, that jumps past the fixed navbar straight to the
 * page's <main>. It lets keyboard and screen-reader users bypass the repeated
 * navigation on every route instead of tabbing through it each time.
 *
 * Pairs with the `id="main-content"` + `tabIndex={-1}` on PageShell's <main>
 * (the jump target) and the route-change focus management in <RouteFocus />.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      data-testid="skip-to-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-xs focus:uppercase focus:tracking-[0.15em] focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
    >
      Skip to content
    </a>
  );
}
