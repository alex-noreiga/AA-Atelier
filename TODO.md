# TODO

Deferred work, parked with enough context to pick back up cold.

## Re-add order-form reference image/video uploads

The order intake form used to have an optional **Reference Images / Video** field
(placed under the dress-description box) that let a customer attach reference photos.
It was prototyped on **Vercel Blob** and then **removed** because the browser upload
hung on protected previews and the SDK dragged in a conflicting zod version. The
product source, the upload route, the contract field, the `@vercel/blob` dependency,
and the zod override were all reverted on branch
`claude/notion-workflow-review-geq5ra`; this file is the recipe to bring it back.

### The approach that was built (reference the reverted commits on this branch)

1. **Contract.** Add `imageUrls: string[]` (optional) to `NewOrderRequest` in
   `lib/api-spec/openapi.yaml`, then run codegen — **but see the orval landmine
   below before running codegen.**
2. **Client upload component.** `web-app/src/components/reference-upload.tsx` — a
   drag-to-pick uploader using `upload` from `@vercel/blob/client`, lifting the
   returned Blob URLs via `onChange`. Wire it into `pages/order-form.tsx` (Dress
   Details section, directly under the description textarea) and include the URLs in
   the `useCreateOrder` mutation payload as `imageUrls` (omit the field when empty).
3. **Server token route.** `api-server/src/routes/uploads.ts` — a
   `POST /api/uploads/order-refs` handler using `handleUpload` from
   `@vercel/blob/client` (allowed image/video content types, size cap), gated on
   `BLOB_READ_WRITE_TOKEN` (unset ⇒ 503). Mount it in `app.ts` **outside** the
   OpenAPI contract, like the Stripe webhook / cron. **Do not** register
   `onUploadCompleted` — it makes `handleUpload` embed a callbackUrl that Vercel Blob
   calls back before completing the browser PUT, which 401s (and hangs) behind
   Deployment Protection on previews. The Blob URLs flow to the server through the
   create-order payload instead, so the callback is unnecessary.
4. **Attach to Notion (best-effort, post-create).** Add
   `ORDER_REFERENCE_IMAGES_PROPERTY = "Reference Images"` (a **file** property) to
   `orders.schema.ts` and a `markOrderReferenceImages(pageId, imageUrls, client?)` to
   `orders.repository.ts` that PATCHes the file property with external files (name
   each file from its URL). For this, `createOrder` must return the created page id
   (it currently returns just the order-number string — change it back to
   `{ orderNumber, pageId }`). In `orders.service.ts`, after `createOrder`, call
   `markOrderReferenceImages` best-effort when `imageUrls` is present (swallow + log
   like the CRM upsert / mailers). Attaching **post-create**, not in the atomic
   create payload, is deliberate: writing a missing property in the create would 400
   the whole order.
5. **One-time atelier setup.** Add a `Reference Images` (**file**) property to the
   **Order Tracking Pipeline** Notion database, and connect a **Vercel Blob** store
   to the project (auto-provisions `BLOB_READ_WRITE_TOKEN`). Without the property the
   attach is a logged no-op; without the token the upload route returns 503 and the
   form still works without attachments.

### Landmines to clear first (these are why it was parked)

- **The upload hang (the actual blocker — solve this before anything else).** On a
  Vercel **preview**, the token `POST /api/uploads/order-refs` returned 200 in a few
  ms (the function works), but the browser upload never resolved and the spinner span
  forever. Removing `onUploadCompleted` (see step 3) did **not** fix it. Note the SDK
  (`@vercel/blob@2.6.1`) PUTs the file to **`https://vercel.com/api/blob`**, *not*
  `*.blob.vercel-storage.com` (that store subdomain only appears in the *returned*
  URL) — so look for the request to `vercel.com/api/blob` in the Network tab.
  Diagnose that request's actual state (pending vs CORS vs 4xx vs the SDK's
  `async-retry` looping, default 10 retries) and any console error before re-shipping.
- **zod v4 dependency clash.** `@vercel/blob` → `@vercel/oidc` transitively pulls
  **zod v4**. `@hookform/resolvers` has **no zod peer** and imports `zod` directly, so
  it latches onto v4 and every web-app form fails typecheck (v4 `$ZodType` vs the v3
  schemas the forms build). Pin zod via a root `pnpm.overrides` (`"zod":
  "3.25.76"`) and do a **clean** reinstall (`rm -rf node_modules pnpm-lock.yaml &&
  pnpm install`) so the stray v4 is gone.
- **orval codegen version.** Codegen must run with **orval 8.18** (emits v3-style
  `zod.string().email()`). A floated **orval 8.22** emits `zod.email()` (v4 API),
  which fails typecheck against zod 3.25.76 — `Property 'email' does not exist on type
  typeof zod`. Pin orval to 8.18 (or hand-edit the generated `imageUrls` line and skip
  regenerating) so the generated `api-zod` schemas stay v3-compatible.
