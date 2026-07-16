import { Link } from "wouter";
import { AtSign, Mail, MapPin } from "lucide-react";
import {
  CONTACT_EMAIL,
  CONTACT_LOCATION,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
} from "@/lib/contact-info";

// Global site footer, rendered once in App.tsx below the routed page. It's the
// home for the studio's contact details (from lib/contact-info), secondary
// navigation, and the legal/policy links — none of which live in the top navbar.
//
// Editorial tokens mirror the navbar: serif brand mark, uppercase wide-tracked
// link groups, muted foreground, a hairline top border.

const EXPLORE_LINKS: { to: string; label: string }[] = [
  { to: "/about", label: "About" },
  { to: "/services", label: "Services" },
  { to: "/shop", label: "Shop" },
  { to: "/contact", label: "Contact" },
];

const COMPANY_LINKS: { to: string; label: string }[] = [
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" },
  { to: "/shipping-returns", label: "Shipping & Returns" },
];

const testId = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

function LinkColumn({
  heading,
  links,
  prefix,
}: {
  heading: string;
  links: { to: string; label: string }[];
  prefix: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs tracking-[0.25em] uppercase text-foreground">
        {heading}
      </h3>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
              data-testid={`footer-${prefix}-${testId(link.label)}`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative z-10 border-t border-border/60 bg-background">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="flex flex-col gap-4">
            <Link
              to="/"
              className="font-serif text-xl tracking-[0.2em] uppercase text-foreground hover:text-primary transition-colors"
              data-testid="footer-brand"
            >
              A.A Atelier
            </Link>
            <p className="text-sm text-muted-foreground font-light leading-relaxed max-w-xs">
              Bespoke figure skating and dance costumes, handcrafted and made to
              measure.
            </p>
          </div>

          {/* Explore */}
          <LinkColumn
            heading="Explore"
            links={EXPLORE_LINKS}
            prefix="explore"
          />

          {/* Company / legal */}
          <LinkColumn
            heading="Company"
            links={COMPANY_LINKS}
            prefix="company"
          />

          {/* Contact */}
          <div className="flex flex-col gap-4">
            <h3 className="text-xs tracking-[0.25em] uppercase text-foreground">
              Contact
            </h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="inline-flex items-center gap-2 hover:text-primary transition-colors"
                  data-testid="footer-email"
                >
                  <Mail className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                {CONTACT_LOCATION}
              </li>
              <li>
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 hover:text-primary transition-colors"
                  data-testid="footer-instagram"
                >
                  <AtSign className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  {INSTAGRAM_HANDLE}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground/70">
            © {year} A.A Atelier
          </p>
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground/50 font-light">
            Bespoke · Handcrafted · Made to measure
          </p>
        </div>
      </div>
    </footer>
  );
}
