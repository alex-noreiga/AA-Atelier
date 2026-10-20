# Invoice PDFs — the dashboard preview and the Notion copy

## What this is

The customer downloads a branded PDF of their invoice from `/invoice/:n`
(jsPDF, in the browser). The atelier asked to see "the PDF version of invoices
that the customers are shown" on the studio dashboard and in Notion. The
decision that shapes everything else: **the server runs the customer's own
layout code** rather than a second template. jsPDF ships a Node build, and the
layout (`PdfDocument`) never touched the DOM, so the module moved from
`web-app/src/lib/pdf/` into a shared workspace package, `lib/documents`
(`@workspace/documents`), imported by both artifacts.

- Preview: `GET /api/studio/invoices/:orderNumber/pdf` → `application/pdf`,
  `requireStaff`, outside the OpenAPI contract (binary, like the reference-image
  upload). Shown in an `<iframe>` via an object URL on the **Invoice PDF** tool
  card, with download / open-in-tab links.
- Save: `POST /api/studio/tools/invoice-pdf` → `saveInvoicePdfToNotion` →
  `uploadFileToNotion` (the generalized reference-image relay) →
  `attachInvoicePdf` (files property `Invoice PDF`, falling back to a `pdf`
  block on the page body when the property doesn't exist).

## Gotchas worth remembering

1. **Sub-path exports are load-bearing for bundle size.** The package root
   pulls in jsPDF. `format.ts` / `contact-info.ts` / `invoice-format.ts` in the
   web app re-export from `@workspace/documents/format`, `/studio`,
   `/invoice-format` (and the fetch helper uses `/filenames`) so the app's main
   bundle doesn't statically import the PDF renderer. Importing the root from an
   eagerly-loaded module would pull ~550 KB into every page.

2. **A pre-existing chunking problem on `main`, NOT caused by this.** Verified
   with a clean worktree build of `main` (identical `pdf-vendor-C5kMRa7L.js`
   hash): under Vite 8 / rolldown, Vite's `\0vite/preload-helper.js` lands in the
   `pdf-vendor` chunk even though `manualChunks` returns `"vendor"` for it, so
   `index-*.js` statically imports `pdf-vendor` and the 550 KB jsPDF chunk loads
   on the first paint of every page. The `manualChunks` pin in `vite.config.ts`
   ("Pin them to the eager vendor chunk…") no longer holds. Not fixed here; it's
   a separate change to the chunking config.

3. **`attachInvoicePdf` replaces, it doesn't append.** A `files` property PATCH
   overwrites the array. Keeping one current copy per row was the choice (Notion
   page history keeps old versions). To keep every version instead, read the
   page first and re-send the existing `file`-typed entries alongside the new
   `file_upload` — Notion accepts its own hosted files back in the update.

4. **A completed file upload attaches once, within an hour.** So the property
   PATCH is tried first; only the specific "`Invoice PDF` is not a property that
   exists" 400 (parsed with `findUnknownProperty`) falls through to the block
   append, which reuses the same still-unattached upload. Any other failure
   throws rather than guessing.

5. **jsPDF's optional deps are externalized in `api-server/build.mjs`**
   (`canvg`, `html2canvas`, `dompurify`): the Node build lazily `require`s them
   inside a try/catch on the HTML/SVG paths. Bundled they cost ~1.5 MB; external
   the require is never reached. The server bundle went 4.6 MB → 5.2 MB for the
   feature (jsPDF + fflate + fast-png).

6. **The server only renders what the customer can see.** Not `Invoice Ready` ⇒
   400 with the reason, for both preview and save. `invoicePaymentInfoFor` was
   split out of `getInvoicePaymentInfo` so the PDF service can look at `ready`
   itself (to say why) while still assembling the view through the one shared
   function.

Atelier setup: optionally add an `Invoice PDF` files property to
"invoices & payments". Nothing else.
