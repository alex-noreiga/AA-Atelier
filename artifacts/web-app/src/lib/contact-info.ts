// The atelier's public contact details, shared by the Contact page and the
// global footer so the two can't drift. The email and location come from
// `@workspace/documents`, which prints them on the PDF invoice and receipt —
// one source of truth for the studio's address on screen and on paper. To change
// any of them, edit there (or the Instagram handle here) and every surface
// updates.
import { STUDIO_EMAIL, STUDIO_LOCATION } from "@workspace/documents/studio";

export const CONTACT_EMAIL = STUDIO_EMAIL;
export const CONTACT_LOCATION = STUDIO_LOCATION;
export const INSTAGRAM_HANDLE = "@a3iceanddance";
export const INSTAGRAM_URL = "https://instagram.com/a3iceanddance";
