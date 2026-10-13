/** Make a value safe to drop into a download filename. */
export function fileSafe(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
}
