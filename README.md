# Naviga-bot

Simple Playwright + TypeScript CLI prototype for browser workflows.

## Usage

1. Copy `.env.example` to `.env` if you want local defaults.
2. Set stable config in `.env` or your shell environment: `ENTRY_URL`, `NAVIGA_USERNAME`, and `NAVIGA_PASSWORD`.
3. Run `npm run dev`.
4. Pass temporary workflow inputs on the command line with `--env:KEY=value` when needed.

Examples:

```bash
npm run dev -- query-subscription --env:NAVIGA_QUERY=829999
npm run dev -- add-subscription-to-batch --env:NAVIGA_BATCH_ID=4621
```

The app config is `workflow/app.yml`. It selects browser settings, whether the browser stays open after the workflow, and the default workflow. Workflow files live in `workflow/workflows/`, and reusable page selector files live in `workflow/pages/`.

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

Run the default workflow:

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
