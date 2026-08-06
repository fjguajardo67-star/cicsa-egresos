# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CICSA Control de Egresos — an expense-tracking / payroll-reading web app for a
Mexican food-service business (comedores industriales). It has two parts:

- **`index.html`** — a single-file, no-build, vanilla-JS SPA (~3000 lines, no
  framework) that is the entire frontend. It's deployed as-is to GitHub Pages
  (see `CNAME` → `cicsa-egresos.cicsacomedores.com.mx`).
- **`servidor_cicsa.py`** — a Flask backend that wraps the Anthropic API to do
  AI-powered OCR/extraction on invoices, receipts, payroll images, and SAT
  (Mexican tax authority) CFDI PDFs. Deployed to Railway (see `Procfile`,
  `railway.json:`).

All user-facing text, comments, and API responses in this codebase are in
**Spanish** — match that when adding features or error messages.

## Running locally

```bash
pip install -r requirements.txt
python servidor_cicsa.py
```

- Requires a `CICSA_APIKEY.txt` file in the repo root (one line, an Anthropic
  API key) or an `ANTHROPIC_API_KEY` env var. Without it, the server prints a
  warning and exits.
- On startup it opens `http://localhost:7432` in a browser and serves
  `index.html` directly from Flask (`send_from_directory`) — there is no
  separate frontend dev server or build step.
- `index.html` auto-detects which backend to talk to: `http://localhost:7432`
  when `window.location.hostname` is `localhost`/`127.0.0.1`, otherwise the
  hardcoded Railway production URL (`SERVER` const, near the top of the
  `<script>` block). When testing backend changes against the deployed
  frontend, or frontend changes against the deployed backend, update/check
  this constant.
- No test suite, linter, or build tooling exists in this repo — there is
  nothing to run beyond starting the Flask server and exercising it in a
  browser.

## Deployment

- **Frontend**: `index.html` is served statically via GitHub Pages, custom
  domain from `CNAME`. Deploying is just pushing `index.html`.
- **Backend**: Railway, via `Procfile`/`railway.json:` (note the literal
  trailing colon in that filename — this is a pre-existing quirk, not a typo
  to silently fix). Railway sets `PORT` and `RAILWAY_ENVIRONMENT`, which
  `servidor_cicsa.py` detects to bind `0.0.0.0:$PORT` instead of opening a
  local browser window.
- CORS in `servidor_cicsa.py` is an explicit origin allowlist (local dev,
  GitHub Pages, and the custom domain). Adding a new frontend origin requires
  updating the `CORS(app, origins=[...])` call.

## Architecture

### Two persistence layers, used for different things

1. **Local JSON file** (`cicsa_data.json`, via `/save-state` and `/load-state`
   on the Flask server) — a simple full-state dump/restore for the
   single-machine local-server workflow, with an automatic `.tmp` +ancient
   rename atomic write and a `cicsa_data_backup.json` safety copy made before
   every overwrite.
2. **Firebase Firestore**, called *directly from the frontend* via the REST
   API (`fetch` to `firestore.googleapis.com/.../documents/...`), bypassing
   the Flask backend entirely. This is the real multi-user sync layer.
   `index.html` embeds **two separate Firebase projects**: `cicsa-egresos`
   (expenses/auth) and `sistema-menu-cicsa` (a companion menu-costing app),
   each with its own `FB_KEY`/`FB_BASE` constants defined near where they're
   used. These are public Firebase Web API keys (access is meant to be
   controlled by Firestore security rules, not key secrecy) — don't confuse
   them with the server-side `ANTHROPIC_API_KEY`, which must stay secret.
3. Auth is Firebase Auth (email/password), with a single hardcoded
   `ADMIN_UID` constant granting the `"admin"` role; everyone else defaults to
   role `"operativo"`. Role gates are simple `if(currentRole === "admin")`
   checks scattered through the frontend, not a real permission system.

### What the Flask backend is actually for

`servidor_cicsa.py` is essentially a thin proxy to `client.messages.create()`
(model `claude-sonnet-4-6`) for turning images/PDFs into structured JSON. Each
route sends one prompt engineered for a specific extraction task and expects
strict JSON back:

- `/leer-gasto` — single receipt/invoice → one categorized expense.
- `/analizar-division` — receipt with mixed categories → itemized breakdown
  that must sum to the total.
- `/leer-nomina` — payroll image → employees with "no fiscal" amounts.
- `/leer-productos` — invoice → individual line items with unit prices (feeds
  the sibling "Menú" app's ingredient costing).
- `/sat-leer-cfdi` — large SAT CFDI PDF (70–100 tax receipts) → reads it in
  two halves (two separate Claude calls) because a single pass truncates on
  big documents, then dedupes by `folio` (UUID) and merges.
- `/precios-ingredientes` — no AI call; just aggregates the latest price per
  proveedor from `cicsa_data.json` for the Menú app to consume.

`CATEGORIAS` (the fixed expense-category list) is defined once in
`servidor_cicsa.py` and interpolated into prompts — if you add/rename a
category, the frontend's category `<select>` options must be kept in sync
manually (there's no shared source of truth between frontend and backend for
this list).

`call_claude()` centralizes the Claude request/response handling: it
normalizes MIME types (auto-detects PDF vs image from the base64 header when
given `application/octet-stream`), and repairs mildly malformed JSON
responses (strips markdown fences, then falls back to scanning for a balanced
`{...}` block) before `json.loads`. Reuse this helper for any new
document-reading endpoint rather than re-implementing JSON extraction.

### Gmail integration — two near-duplicate files, only one is live

- `gmail_cicsa.py` (underscore) is the one actually imported by
  `servidor_cicsa.py` (`from gmail_cicsa import fetch_invoice_attachments`).
  It reads the OAuth token solely from the `GMAIL_TOKEN` env var (Railway has
  a read-only filesystem, so it can't persist a refreshed token to disk).
- `gmail-cicsa.py` (hyphen) is an **unused, not-imported** alternate version
  with a different/older token-loading strategy (env var → Firebase → local
  file, with a hardcoded Firebase key/project baked in). Python can't import a
  module with a hyphen in its filename anyway, so this file is effectively
  dead code — don't assume both are wired up, and don't be misled by its
  similarity when only `gmail_cicsa.py` is on the request path. If Gmail
  behavior needs to change, edit `gmail_cicsa.py`.
- `sheets_cicsa.py` (Google Sheets sync for the `/sheets-*` routes) is
  imported the same optional way (`try/except ImportError` → `SHEETS_AVAILABLE`)
  but the file does not exist in this repo, so those routes currently 400 with
  "No disponible". Treat any Sheets-related work as needing that module built
  from scratch, not modified.

### Frontend structure (`index.html`)

Single page, tab-switched via `showPage(name, btn)` toggling `.page.active` on
`<div class="container page" id="page-*">` blocks (`captura`, `gastos`,
`presupuesto`, `reporte`, `gmail`, `pagos`, `reportes`, `catalogo`, `caja`,
`sat`). No router, no components, no build step — everything is global
functions and DOM queries by `id`. State lives in module-level JS variables
and is persisted opportunistically to Firestore (and mirrored to the local
JSON file via `/save-state` when a local server is present).

External libs are loaded via CDN `<script>` tags in `<head>` (xlsx, jsPDF,
pdf.js, Firebase compat SDKs) — there's no package manager or bundler
involved in the frontend at all.
