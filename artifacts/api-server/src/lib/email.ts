// Canonical form for an email address used as a stored value or a lookup key.
//
// Notion matches an `email` property with `equals` *exactly*, and several flows
// treat the address as identity: the Client CRM dedupes on it, and the account
// portal signs a customer in by it. So `Anna@Example.com` and `anna@example.com`
// must not read as two different people — that quietly breaks CRM dedupe and
// account-portal order lookups. Lowercasing (and trimming) on every write and
// every lookup keeps a single customer as a single record.
//
// Case-only normalization: the local part of an address is technically
// case-sensitive per RFC 5321, but no mail provider in practice treats it so,
// and the atelier's flows assume one canonical address per customer.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
