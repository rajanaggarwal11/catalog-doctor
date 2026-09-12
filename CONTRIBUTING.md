# Contributing

Thanks for looking. Issues and pull requests are both welcome — including "this rule is wrong about my workspace", which is the most useful kind of report this project can get.

## Getting set up

```bash
pnpm install
pnpm check     # lint · typecheck · test · build · self-check
```

`pnpm check` is what CI runs. If it passes locally it should pass there.

To try the CLI against a real workspace without installing it:

```bash
pnpm build
node dist/cli.js --cwd /path/to/your/monorepo
```

There is a devcontainer, so "Open in Codespaces" gets you a working checkout with no local Node setup.

## Adding a rule

A rule is one file in `src/rules/` exporting a `Rule`, plus one entry in `src/rules/index.ts`. The shape is small on purpose:

```ts
export const myRule: Rule = {
  id: "my-rule",
  title: "Short title",
  description: "One sentence, shown by --list-rules.",
  defaultSeverity: "warn",
  fixable: false,
  check(workspace, context) {
    return [];
  },
};
```

Three things the existing rules do that yours should too:

1. **State the problem, not the advice.** A message says what is wrong (`zod is declared at 2 different versions`). Advice goes in `detail`.
2. **Emit the fix, or say you cannot.** If a finding has exactly one correct resolution, attach a `fix` with the edits. If resolving it means choosing between valid options, set `fixable: false` — a fixer that guesses is worse than one that declines.
3. **Say why in a comment.** Every rule file opens with a short note on the failure it prevents. That comment is the thing a reader needs and the code cannot say.

## Tests

Every rule needs a fixture workspace under `test/fixtures/` and assertions in `test/diagnose.test.ts`. Fixtures are read-only; fix tests copy them to a temp directory first.

Before you call a test done, put the bug back and check the test actually fails. A guard that has never failed is the least-tested code in the change — the JSX regression test in `test/units.test.ts` exists because the real bug shipped first and the test was written to catch it afterwards.

## Releasing

Changesets. Add one with your PR:

```bash
pnpm changeset
```

Merging to `main` opens a release PR; merging that publishes to npm with provenance.

## Regenerating the social preview

`.github/social-preview.html` is the source for the repository's link-preview card.
GitHub only accepts it through Settings → General → Social preview, so it is rendered
by hand and uploaded:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --window-size=1280,640 \
  --screenshot=social-preview.png \
  "file://$PWD/.github/social-preview.html"
```
