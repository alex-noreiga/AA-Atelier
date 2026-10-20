// The studio's identity as it prints on a PDF invoice or receipt: the wordmark
// and the contact line beneath it. The web app's `lib/contact-info.ts` re-exports
// the email and location from here, so the printed document, the Contact page
// and the footer all name the same studio and can't drift.
export const STUDIO_NAME = "A.A Atelier";
export const STUDIO_WEBSITE = "a3iceanddance.com";
export const STUDIO_EMAIL = "hello@a3iceanddance.com";
export const STUDIO_LOCATION = "Huntsville, Alabama · by appointment";

// The contact line under the wordmark and in the document footer.
export const STUDIO_CONTACT_LINES = [
  STUDIO_EMAIL,
  STUDIO_WEBSITE,
  STUDIO_LOCATION,
];
