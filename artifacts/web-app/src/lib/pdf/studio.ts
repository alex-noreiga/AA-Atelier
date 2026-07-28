import { CONTACT_EMAIL, CONTACT_LOCATION } from "@/lib/contact-info";

// The studio's identity as it prints on a PDF invoice or receipt: the wordmark
// and the contact line beneath it. Kept beside `contact-info` so the printed
// document and the site name the same studio and can't drift.
export const STUDIO_NAME = "A.A Atelier";
export const STUDIO_WEBSITE = "a3iceanddance.com";

// The contact line under the wordmark and in the document footer.
export const STUDIO_CONTACT_LINES = [
  CONTACT_EMAIL,
  STUDIO_WEBSITE,
  CONTACT_LOCATION,
];
