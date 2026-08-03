// Invisible anti-spam helpers shared by the public, anonymous forms (contact,
// back-in-stock notify, newsletter). Two zero-friction signals the server reads:
//
//   • a honeypot field a real visitor never sees or fills, and
//   • how long the visitor spent on the form before submitting (`elapsedMs`).
//
// Both are optional on the generated request contract, so a form that omits them
// still works. Kept here so the hidden field, the form schema, and the markup
// can't drift apart across the forms that use them.

import { useRef } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

// The honeypot field name — shared so the hidden input, each form's local zod
// schema, and the server all agree. Named to look tempting to autofill bots and
// plainly irrelevant to these forms.
export const HONEYPOT_FIELD = "website";

// Zod fragment spread into each anonymous form's local schema, so `register`
// and the submit payload stay typed. Always optional; never shown to the user.
export const honeypotSchema = { [HONEYPOT_FIELD]: z.string().optional() };

/**
 * A visually hidden, off-screen field. Real users never see or tab to it; bots
 * that fill every input give themselves away. Uses off-screen positioning
 * rather than `display:none` (which some bots skip) and is removed from the
 * a11y tree so screen readers ignore it.
 */
export function HoneypotField({
  registration,
}: {
  registration: UseFormRegisterReturn;
}) {
  return (
    <div
      aria-hidden="true"
      className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden"
    >
      <label>
        Leave this field empty
        <input type="text" tabIndex={-1} autoComplete="off" {...registration} />
      </label>
    </div>
  );
}

/**
 * Measures how long the visitor spent on the form. Call the returned function at
 * submit time and send the result as the `elapsedMs` anti-spam signal.
 */
export function useSubmitTimer(): () => number {
  const mountedAt = useRef(Date.now());
  return () => Date.now() - mountedAt.current;
}
