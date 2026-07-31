// Partly orval-managed — see the note in lib/api-zod/src/index.ts. The
// single-quoted lines are orval's; keep their formatting (this file is in
// .prettierignore) or each codegen run appends a duplicate pair.
export * from "./generated/api";
export * from "./generated/api.schemas";
export * from './generated/api';
export * from './generated/api.schemas';

// Hand-written mutator config (not orval-managed). The web app wires
// `setAuthTokenGetter` to supply the Supabase access token as a Bearer credential.
export {
  setAuthTokenGetter,
  setBaseUrl,
  type AuthTokenGetter,
} from "./custom-fetch";
