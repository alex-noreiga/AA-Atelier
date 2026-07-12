// Contact-message use-case, independent of HTTP. The route handler calls this
// with already-validated input and turns the result (or thrown domain errors)
// into a response.

import { createContactMessage } from "../lib/notion/contact.repository.js";
import type { CreateContactInput } from "../lib/notion/contact.blocks.js";

export async function submitContactMessage(
  input: CreateContactInput,
): Promise<{ success: true }> {
  await createContactMessage(input);
  return { success: true };
}
