// Partly orval-managed: `output.workspace` makes orval append its own export
// lines here on every codegen run. It dedupes against the *exact* line it
// writes (single-quoted, no extension), so those two lines must keep their
// formatting or orval appends a fresh pair each run. That is why this file is
// listed in .prettierignore. The `.js` lines below are the hand-written,
// extension-explicit ESM barrel; the duplicate star re-export is a legal no-op.
export * from "./generated/api.js";
export * from "./generated/types/index.js";
export * from './generated/api';
export * from './generated/types';
