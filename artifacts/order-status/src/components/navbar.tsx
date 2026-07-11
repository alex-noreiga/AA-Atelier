import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/order", label: "Custom Order" },
  { to: "/status", label: "Order Status" },
  { to: "/about", label: "About" },
  { to: "/services", label: "Services" },
  { to: "/shop", label: "Shop" },
  { to: "/contact", label: "Contact" },
] as const;

function isActive(current: string, to: string) {
  if (to === "/") return current === "/";
  return current === to || current.startsWith(to + "/");
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

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`text-xs tracking-[0.15em] uppercase transition-colors relative group ${
                isActive(location, link.to)
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {link.label}
              <span
                className={`absolute -bottom-1 left-0 h-[1px] bg-primary transition-all duration-300 ${
                  isActive(location, link.to) ? "w-full" : "w-0 group-hover:w-full"
                }`}
              />
            </Link>
          ))}
        </div>

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
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setOpen(false)}
                    className={`font-serif text-2xl transition-colors ${
                      isActive(location, link.to)
                        ? "text-primary"
                        : "text-foreground hover:text-primary"
                    }`}
                    data-testid={`nav-mobile-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
