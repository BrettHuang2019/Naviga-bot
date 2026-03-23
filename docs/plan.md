# Naviga-bot Simple Plan

## Goal

Build a small CLI prototype that helps a user define repeatable website workflows in plain text, convert them into structured config, and run them visibly in a browser.

## Product Rules

- Keep it simple. Prototype first.
- Browser runs with `headless: false`.
- Do not close the browser when the workflow finishes.
- Credentials live in `.env`.
- User edits one workflow text file repeatedly.
- CLI decides whether to regenerate machine config or execute it.

## Happy Path

1. User runs CLI for the first time.
2. CLI creates starter files:
   - `.env.example`
   - `workflow.txt`
   - `workflow.generated.yaml`
   - `manifest.json`
3. User fills in login instructions in `workflow.txt`.
4. CLI reads `workflow.txt`, generates structured config, and runs it in Playwright.
5. Browser stays open on the resulting page.
6. CLI saves page state in `manifest.json`.
7. User updates `workflow.txt` with the next step, for example going to subscriptions.
8. CLI detects the text changed, regenerates config, and runs again from the saved state.

## Suggested Files

- `src/cli.ts`: CLI entry point.
- `src/env.ts`: load and validate `.env`.
- `src/files.ts`: read/write workflow, manifest, and generated config.
- `src/prompt.ts`: build the generation prompt from template data.
- `src/ai.ts`: call the configured AI command.
- `src/generator.ts`: convert text workflow into YAML config.
- `src/runner.ts`: run the generated config with Playwright.
- `src/manifest.ts`: save/load last known app state.
- `.env.example`: username, password, base URL.
- `prompts/workflow-to-yaml.txt`: prompt template for text-to-config generation.
- `workflow.txt`: user-authored instructions.
- `workflow.generated.yaml`: machine-readable steps.
- `manifest.json`: saved page/state metadata.

## Phase Plan

### Phase 1: Bootstrap CLI

- Create a TypeScript CLI project.
- Add dependencies: `playwright`, `dotenv`, `yaml`, and a small CLI helper only if needed.
- On first run, create missing files with starter content.

### Phase 2: Basic Workflow Format

- Define a very small YAML schema:
  - `startUrl`
  - `steps`
  - step types like `fill`, `click`, `waitFor`, `assertUrl`
- Support only the minimum actions needed for login and page navigation.

### Phase 3: Text-to-Config Generation

- Use `workflow.txt` as the user-facing file.
- Prepare a prompt template that tells the model to return only valid YAML in the expected schema.
- Generate `workflow.generated.yaml` by combining the template with:
  - current workflow text
  - current manifest data if helpful
  - available env variable names, not secret values
- Add a small AI caller wrapper in the CLI.
- Default AI command:
  - `qwen -p "prompt"`
- Keep the AI integration replaceable so another model command can be swapped in later.
- Store a hash of `workflow.txt` in `manifest.json` so the CLI can detect when regeneration is needed.

### Phase 4: Runner

- Launch Playwright with `headless: false`.
- Load credentials from `.env`.
- Execute YAML steps in order.
- Leave the page open after completion.

### Phase 5: Manifest

- Save enough state to continue the happy path:
  - last URL
  - last successful workflow hash
  - optional basic notes like page title
- Keep this lightweight. Avoid full session recovery unless needed later.

## First Deliverable

The first usable version should do only this:

1. Generate starter files on first run.
2. Read `.env` for login credentials.
3. Build a prompt from a template and send it to the default AI command.
4. Convert a simple login instruction in `workflow.txt` into YAML.
5. Validate and save the YAML to `workflow.generated.yaml`.
6. Open the site visibly and perform login.
7. Save the resulting URL to `manifest.json`.
8. Keep the browser open.

## Non-Goals For Now

- Full AI planner with complex reasoning.
- Large action vocabulary.
- Robust session persistence.
- Multiple workflows or workflow folders.
- Background/headless execution.
- Automatic healing for broken selectors.

## Next Build Order

1. Set up the TypeScript CLI skeleton.
2. Add first-run file generation.
3. Define the minimal YAML schema.
4. Add the prompt template file.
5. Implement the AI caller with default `qwen -p "prompt"`.
6. Implement text-to-YAML generation for login only.
7. Implement Playwright execution.
8. Save a minimal manifest after success.
