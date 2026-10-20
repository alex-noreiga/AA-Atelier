/**
 * Make a value safe to drop into a download filename: runs of anything but
 * word characters, dots and dashes become one dash, and leading / trailing
 * dashes are trimmed.
 *
 * The trim is a loop rather than `/^-+|-+$/`: the value is an order number
 * from a route parameter, and CodeQL flags that pattern as polynomial on a
 * long run of dashes. A loop is linear and reads just as plainly.
 */
export function fileSafe(value: string): string {
  const collapsed = value.replace(/[^\w.-]+/g, "-");
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start++;
  while (end > start && collapsed[end - 1] === "-") end--;
  return collapsed.slice(start, end);
}
