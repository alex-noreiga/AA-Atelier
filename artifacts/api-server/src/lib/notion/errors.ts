// Typed failures from the Notion REST API.
//
// Every repository here throws on a non-ok response, and until this module the
// message was the status code and nothing else — "Notion query failed with
// status 404". That is the least useful thing a 404 can say, because a 404 from
// Notion is never transient and never ambiguous about what to DO: the id is
// wrong, or the integration was never shared with that database. The stack
// trace names the function, so a reader can work out which database it was; the
// atelier reading the alert email cannot.
//
// So two things live here:
//
//   * **The message carries the context.** Which database (by the label the
//     caller already passes), which id it tried, and Notion's own `code` +
//     `message` — which for a 404 is the sentence that tells you to share the
//     database with the integration.
//   * **The status survives as data.** A caller that wants to treat "Notion
//     can't see this database" as a configuration state rather than an outage
//     (the studio's materials panel does) needs to tell 404 from 502 without
//     matching on the message text.

/** A non-ok response from the Notion API, with the status kept as data. */
export class NotionRequestError extends Error {
  readonly status: number;
  /** Notion's own error code (`object_not_found`, `validation_error`, …). */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "NotionRequestError";
    this.status = status;
    if (code) this.code = code;
  }
}

/**
 * Whether an error is Notion answering "I can't see that".
 *
 * The one Notion status worth branching on: it can't clear itself, so retrying
 * or alerting nightly is noise — a human has to fix the id or share the
 * database.
 */
export function isNotionNotFound(error: unknown): boolean {
  return error instanceof NotionRequestError && error.status === 404;
}

/** Keep an unexpected error body out of the logs at full length. */
const MAX_BODY_CHARS = 300;

interface NotionErrorBody {
  code?: unknown;
  message?: unknown;
}

/**
 * Build a {@link NotionRequestError} from a failed response, reading its body
 * for Notion's own code + message. Consumes the body, so only call this on a
 * response you are about to throw for.
 *
 * `label` names the database in human terms ("materials inventory"), matching
 * what {@link scanDatabase} is already given.
 */
export async function notionRequestError(
  response: Response,
  context: { label: string; databaseId?: string; operation?: string },
): Promise<NotionRequestError> {
  const { label, databaseId, operation = "query" } = context;

  let code: string | undefined;
  let detail = "";
  try {
    const raw = (await response.text()).trim();
    detail = raw;
    // Notion answers errors as JSON; anything else (an HTML page from a proxy
    // in front of it, say) is still worth reporting verbatim, so the raw body
    // stands as the detail when it doesn't parse.
    const parsed = JSON.parse(raw) as NotionErrorBody;
    if (typeof parsed.code === "string") code = parsed.code;
    if (typeof parsed.message === "string") detail = parsed.message;
  } catch {
    // Body unreadable, or not JSON — keep whatever text we got.
  }

  const parts = [
    `Notion ${operation} failed with status ${response.status}`,
    `for the ${label} database`,
    ...(databaseId ? [`(id ${databaseId})`] : []),
  ];
  let message = parts.join(" ");
  if (code) message += `: ${code}`;
  if (detail) message += `${code ? " — " : ": "}${truncate(detail)}`;
  if (response.status === 404) {
    // The one thing the reader of an alert email needs: this is configuration,
    // and here is the fix.
    message +=
      " — a 404 means the configured database id is wrong, or the Notion" +
      " integration has not been shared with that database.";
  }

  return new NotionRequestError(message, response.status, code);
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}…`
    : text;
}
