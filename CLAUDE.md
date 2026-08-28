# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CICSA Control de Egresos — an expense-tracking / payroll-reading web app for a
Mexican food-service business (comedores industriales). It has two parts:

- **`index.html`** — a single-file, no-build, vanilla-JS SPA (~11,400 lines, no
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
- There is no linter or build tooling, but there **are** tests, and they are the
  only safety net this repo has:
  - `node tests/run_js_tests.js` — 400 tests. Extracts the real functions out of
    `index.html` by brace-matching into a `vm` sandbox, so it tests the shipped
    code, not a copy. New functions must be listed in `FUNCS`, constants in
    `CONSTS`.
  - `python3 tests/test_gmail_cicsa.py` — 17 tests, with Google's modules stubbed
    so they run without network or credentials.
  Run both before pushing. Several tests are deliberately *source-level guards*
  (no `<script src>` without `integrity`, `setStatus` never back to `innerHTML`,
  `gmail_token.json` never versioned again) — if one of those fails, it is
  telling you a protection was removed, not that a test is flaky.

## Deployment

- **Frontend**: `index.html` is served statically via GitHub Pages, custom
  domain from `CNAME`. Deploying is just pushing `index.html`.
- **Backend**: Railway, via `Procfile`/`railway.json:` (note the literal
  trailing colon in that filename — this is a pre-existing quirk, not a typo
  to silently fix). The `Procfile` runs **Gunicorn**, not `python
  servidor_cicsa.py` — that started Flask's development server, which has no
  timeouts and warns on its own that it isn't for production. Consequence to
  keep in mind: under Gunicorn the `if __name__ == "__main__"` block **never
  runs**, so anything the routes need at startup has to happen at import time.
  That is why `load_api_key()` is called at module level; `get_client()` reads
  `ANTHROPIC_API_KEY` per request, so both ways of starting work.
  - `--timeout 300` is deliberate: `/sat-leer-cfdi` makes two Claude calls over
    a PDF with 70–100 receipts and can take minutes. Gunicorn's default of 30 s
    would kill it mid-read.
  - `--workers 2 --threads 4`: the work is I/O-bound (waiting on Anthropic), so
    threads buy more than processes. If Railway starts restarting the container
    out of memory, drop to `--workers 1 --threads 8` — Gunicorn's master
    restarts a dead worker on its own, so one worker is not a single point of
    failure.
  - Running locally is unchanged: `python servidor_cicsa.py` still opens the
    browser and serves `index.html`. The `Procfile` only applies to Railway.
- **Dependencies are pinned**, direct and indirect, to the versions of the
  Railway build of 2026-08-28. They used to float: that build silently pulled
  `anthropic` 1.2.0, a major-version jump nobody chose. To upgrade, drop the
  `==`, install in a clean environment, test, and re-pin with `pip freeze`.
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
3. **Firebase Storage** holds the files, not the data: `facturas/{ts}_{folio}.{pdf|jpg}`
   (the documentary backup of every expense) and `cortes/{ini}_{fin}.json`. Its
   rules live in `storage.rules`, which is a **different file in a different
   console section** from `firestore.rules` — publishing one does not publish the
   other, and that is the easy mistake to make. Neither is read from the repo;
   both have to be pasted into the console.
4. Auth is Firebase Auth (email/password), with a single hardcoded
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
  **This is the SAT tab's last resort, not its main path.** The tab offers three
  options and the UI ranks them: XML files (the real workflow — hundreds of CFDI
  XMLs parsed *in the browser* with `DOMParser`, no backend, no tokens), the SAT
  Excel export (also browser-side), and only then this one. Don't assume a change
  to SAT reconciliation touches the server; usually it does not.
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

### Gmail integration

- `gmail_cicsa.py` is imported by `servidor_cicsa.py`
  (`from gmail_cicsa import fetch_invoice_attachments`) behind a
  `try/except ImportError` → `GMAIL_AVAILABLE`. It reads the OAuth token solely
  from the `GMAIL_TOKEN` env var (Railway has a read-only filesystem, so it
  can't persist a refreshed token to disk). If Gmail behavior needs to change,
  this is the file.
- Older notes described a second `gmail-cicsa.py` (hyphen) sitting next to it.
  That file is not in the repo — don't go looking for it.

### There is no Google Sheets integration

`sheets_cicsa.py` never existed in this repo. The `/sheets-*` routes that
imported it were removed (they had answered `400 "No disponible"` since the
day they were written), along with the frontend's `renderAprobaciones` /
`aprobarGasto` / `syncSubir` / `syncBajar` — all four had empty bodies or wrote
to DOM ids that no page contains. Sheets work means building the whole thing
from scratch; the scaffolding is gone, and `git log` has it if you want to see
what it looked like.

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
