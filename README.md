# Naviga-bot

Simple Playwright + TypeScript CLI prototype for browser workflows.

## Usage

1. Copy `.env.example` to `.env` if you want local defaults.
2. Set stable config in `.env` or your shell environment: `ENTRY_URL`, `NAVIGA_USERNAME`, `NAVIGA_PASSWORD`, and `POWER_AUTOMATE_WEBHOOK_URL` when testing SharePoint callbacks.
3. For the default shared testing setup, run `npm run dev:public`.
4. If you only need the local review UI, run `npm run dev:web`.
5. If you only need the workflow CLI, run `npm run dev`.
6. Pass temporary workflow inputs on the command line with `--env:KEY=value` when needed.

Examples:

```bash
npm run dev -- query-subscription --env:NAVIGA_QUERY=829999
npm run dev -- add-subscription-to-batch --env:NAVIGA_BATCH_ID=4621
```

The app config is `workflow/app.yml`. It selects browser settings, whether the browser stays open after the workflow, and the default workflow. Workflow files live in `workflow/workflows/`, and reusable page selector files live in `workflow/pages/`.

If `artifacts/json/subscription-detail.json` and `artifacts/ocr/` are both present, the worker also writes `artifacts/json/renewal-verification-report.json` after the browser workflow finishes.

## Workflow structure

- `workflow/workflows/*.yml`: business workflows such as `login` or `query-subscription`
- `workflow/pages/*.yml`: reusable selector maps by page
- `dependsOn`: compose workflows from shared prerequisites
- `usePage`: activate a page selector file before `fill`, `click`, or `waitFor`

Supported workflow steps:

- `goto`
- `pause`
- `usePage`
- `fill`
- `click`
- `waitFor`
- `waitForUrl`
- `exportSubscriptionDetail`

Example:

```yaml
id: query-subscription
dependsOn:
  - login
steps:
  - type: waitForUrl
    urlExcludes: /login.aspx
```

## Testing workflows

Run the workflow CLI directly:

```bash
npm run dev
```

Run a specific workflow by id:

```bash
npm run dev -- open-entry-site
npm run dev -- login
npm run dev -- query-subscription
```

Dependency workflows run automatically. For example:

- `query-subscription` runs `login` first
- `login` runs `open-entry-site` first

Recommended test order:

1. Update `.env` with the real site URL and credentials.
2. Run `npm run dev -- open-entry-site`.
3. Check the saved DOM snapshot in `artifacts/dom/` and update page selectors.
4. Run `npm run dev -- login`.
5. After login selectors are stable, run `npm run dev -- query-subscription --env:NAVIGA_QUERY=<client-number>`.

The default workflow now performs this sequence with a 2 second pause between visible actions:

1. Open site
2. Enter username
3. Enter password
4. Click login
5. Wait until the app leaves `login.aspx`
6. Click the Subscriptions shortcut
7. Wait for the subscription page
8. Enter customer search client number `82999`
9. Click customer search

Notes:

- The browser stays open on purpose. Stop each run with `Ctrl+C`.
- Set `browser.keepOpen: false` in `workflow/app.yml` if you want the browser to close automatically after the workflow finishes.
- If a selector is wrong, the workflow fails at that step.
- A page snapshot is only saved the first time that normalized URL is visited.

## DOM snapshots

Each page is saved the first time it is visited to `artifacts/dom/`.

- `artifacts/dom/manifest.json` maps normalized URLs to snapshot files.
- Each snapshot JSON contains the URL, page title, capture time, and a simplified DOM tree for later analysis.

## Cloudflare tunnel

The default entry command for shared testing is:

```bash
npm run dev:public
```

This starts the local web server and the Cloudflare tunnel together.
The web server binds to `0.0.0.0`, so other devices on the same local network can open the printed `LAN Review UI` URL directly.

For development, keep the tunnel config in the repo under `cloudflare/`.

Setup:

1. Install `cloudflared`.
2. Copy `cloudflare/config.yml.example` to `cloudflare/config.yml`.
3. Set `tunnel` to your tunnel UUID.
4. Set `hostname` to the public hostname for this app.
5. Put the tunnel credential JSON in `cloudflare/` and update `credentials-file` to its absolute Windows path.

The local web server runs on port `3001` by default, with local access on `http://localhost:3001` and LAN access on your machine's local IP, so the tunnel config targets that port.

Run both together:

```bash
npm run dev:public
```

Or run them separately in two terminals:

```bash
npm run dev:web
npm run tunnel
```
