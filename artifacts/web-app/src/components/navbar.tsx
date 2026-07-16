import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, Menu, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { CartButton } from "@/components/cart-drawer";

type NavLink = {
  to: string;
  label: string;
  children?: readonly { to: string; label: string }[];
};

const NAV_LINKS: readonly NavLink[] = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  {
    to: "/services",
    label: "Services",
    children: [
      { to: "/services", label: "Overview" },
      { to: "/order", label: "Place an Order" },
      { to: "/appointments", label: "Book an Appointment" },
      { to: "/shop/status", label: "Track Your Order" },
      { to: "/shop/order-status", label: "Track a Shop Order" },
    ],
  },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/shop", label: "Shop" },
  { to: "/contact", label: "Contact" },
];

const testId = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

// Exact match only: /shop/status belongs to the Services group, so a prefix
// match on /shop would light up the wrong link.
function isActive(current: string, link: NavLink) {
  return (
    current === link.to ||
    (link.children?.some((c) => c.to === current) ?? false)
  );
}

export default function Navbar() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 inset-x-0 z-50 bg-background/70 backdrop-blur-md border-b border-border/60">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Brand */}
        <Link
          to="/"
          className="font-serif text-xl tracking-[0.2em] uppercase text-foreground hover:text-primary transition-colors"
          data-testid="link-brand"
        >
          A.A Atelier
        </Link>

        <div className="flex items-center gap-1 md:gap-5">
          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((link) => {
              const active = isActive(location, link);
              const linkClass = `text-xs tracking-[0.15em] uppercase transition-colors relative group ${
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`;
              const underline = (
                <span
                  className={`absolute -bottom-1 left-0 h-[1px] bg-primary transition-all duration-300 ${
                    active ? "w-full" : "w-0 group-hover:w-full"
                  }`}
                />
              );

              if (!link.children) {
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={linkClass}
                    data-active={active}
                    data-testid={`nav-${testId(link.label)}`}
                  >
                    {link.label}
                    {underline}
                  </Link>
                );
              }

              return (
                <DropdownMenu key={link.to}>
                  <DropdownMenuTrigger
                    className={`${linkClass} flex items-center gap-1 outline-hidden`}
                    data-active={active}
                    data-testid={`nav-${testId(link.label)}`}
                  >
                    {link.label}
                    <ChevronDown
                      className="w-3 h-3 transition-transform duration-300 group-data-[state=open]:rotate-180"
                      strokeWidth={1.5}
                    />
                    {underline}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={12}
                    className="bg-background/95 backdrop-blur-md border-border/60 min-w-48"
                  >
                    {link.children.map((child) => (
                      <DropdownMenuItem key={child.to} asChild>
                        <Link
                          to={child.to}
                          className={`text-xs tracking-[0.15em] uppercase transition-colors ${
                            location === child.to
                              ? "text-primary"
                              : "text-muted-foreground focus:text-foreground"
                          }`}
                          data-testid={`nav-${testId(child.label)}`}
                        >
                          {child.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </div>

          {/* Cart — visible on every breakpoint */}
          <CartButton />

          {/* Mobile menu */}
          <div className="md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                className="text-foreground hover:text-primary transition-colors p-2 -mr-2"
                aria-label="Open menu"
                data-testid="button-menu"
              >
                <Menu className="w-5 h-5" strokeWidth={1.5} />
              </SheetTrigger>
              <SheetContent
                side="right"
                className="bg-background border-l border-border w-72 [&>button]:hidden"
              >
                <div className="flex items-center justify-between mb-12">
                  <span className="font-serif text-lg tracking-[0.2em] uppercase">
                    A.A Atelier
                  </span>
                  <SheetClose
                    className="text-muted-foreground hover:text-primary transition-colors"
                    aria-label="Close menu"
                  >
                    <X className="w-5 h-5" strokeWidth={1.5} />
                  </SheetClose>
                </div>
                <div className="flex flex-col gap-8">
                  {NAV_LINKS.map((link) =>
                    link.children ? (
                      <div key={link.to} className="flex flex-col gap-4">
                        <span
                          className={`font-serif text-2xl ${
                            isActive(location, link)
                              ? "text-primary"
                              : "text-foreground"
                          }`}
                        >
                          {link.label}
                        </span>
                        <div className="flex flex-col gap-3 pl-4">
                          {link.children.map((child) => (
                            <Link
                              key={child.to}
                              to={child.to}
                              onClick={() => setOpen(false)}
                              className={`text-sm tracking-[0.15em] uppercase transition-colors ${
                                location === child.to
                                  ? "text-primary"
                                  : "text-muted-foreground hover:text-primary"
                              }`}
                              data-testid={`nav-mobile-${testId(child.label)}`}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => setOpen(false)}
                        className={`font-serif text-2xl transition-colors ${
                          isActive(location, link)
                            ? "text-primary"
                            : "text-foreground hover:text-primary"
                        }`}
                        data-testid={`nav-mobile-${testId(link.label)}`}
                      >
                        {link.label}
                      </Link>
                    ),
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </header>
  );
}
