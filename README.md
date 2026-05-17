# Gherkin Rule Trace

Gherkin Rule Trace is a small VS Code extension that scans Gherkin/Cucumber `.feature` files and shows each Gherkin rule with its implementation and test status.

The MVP intentionally does not use `@rule`, `@rule_id`, or any tag convention. A rule is identified only by the exact text after `Rule:`.

## Install dependencies

```bash
npm install
```

## Compile

```bash
npm run compile
```

## Run in development

Open this folder in VS Code and press `F5`.

The launch configuration starts an Extension Development Host with `sample-project/` opened as the test workspace.

## Install in VS Code

### Option 1: install a packaged VSIX

Build the extension:

```bash
npm install
npm run compile
```

Package it as a `.vsix` file:

```bash
npx @vscode/vsce package
```

Then install it in VS Code:

1. Open VS Code.
2. Go to the Extensions view.
3. Click the `...` menu.
4. Choose `Install from VSIX...`.
5. Select the generated `gherkin-rule-trace-0.0.1.vsix`.
6. Reload VS Code if prompted.

You can also install it from the command line:

```bash
code --install-extension gherkin-rule-trace-0.0.1.vsix
```

### Option 2: run without installing

Use this while developing the extension:

```bash
npm install
npm run compile
```

Then press `F5` in VS Code. This opens an Extension Development Host with the extension loaded.

After installation or launch, open a workspace containing `.feature` files and use the `Gherkin Rule Trace` Activity Bar view.

## What the extension scans

Feature files:

```json
"ruleTrace.include": ["**/*.feature"]
```

Default exclusions:

```json
"ruleTrace.exclude": [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.git/**"
]
```

Code extensions scanned for implementation and tests:

```json
"ruleTrace.codeExtensions": [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".py",
  ".cs",
  ".java",
  ".go",
  ".rs",
  ".php",
  ".rb"
]
```

## Implementation convention

A rule is considered implemented when a non-test source file contains a comment with the exact rule name.

```gherkin
Rule: #010 A vigilance certificate must be valid
```

```ts
// #010 A vigilance certificate must be valid
export function validateCertificate(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}
```

Block comments are also supported:

```ts
/**
 * #010 A vigilance certificate must be valid
 */
export function validateCertificate(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}
```

Test files are excluded from implementation detection. A file is treated as a test file when its path contains `.test.`, `.spec.`, or a folder named `test`, `tests`, `__tests__`, `bdd`, or `e2e`.

## Test convention

A rule is considered tested when at least one of these conditions is true.

### Condition A: describe contains the rule name

```ts
describe("#010 A vigilance certificate must be valid", () => {
  it("rejects expired certificates", () => {});
});
```

Single quotes and template strings are supported.

### Condition B: all Gherkin steps are present in step definitions

Feature:

```gherkin
Rule: #010 A vigilance certificate must be valid

  Scenario: Reject expired certificate
    Given a supplier has an expired vigilance certificate
    When the compliance check runs
    Then the supplier should be marked as non-compliant
```

Step definitions:

```ts
Given("a supplier has an expired vigilance certificate", async () => {});
When("the compliance check runs", async () => {});
Then("the supplier should be marked as non-compliant", async () => {});
```

Python decorators and C# SpecFlow/Reqnroll attributes are also detected for the MVP.

## Sidebar

Open the `Gherkin Rule Trace` Activity Bar view. It displays `.feature` files grouped by directory, then lists their rules without adding a `Rule:` prefix.

Statuses:

- `✅` implemented and tested
- `🟡` implemented but not tested
- `🔴` not implemented

Clicking a rule opens the `.feature` file at the `Rule:` line and shows a details panel.

The details panel contains clickable file links, buttons to copy the exact rule tag as a source comment, generate missing TypeScript/Cucumber step definitions, and refresh the current rule.

## Commands

- `Gherkin Rule Trace: Refresh`
- `Gherkin Rule Trace: Refresh Rule`
- `Gherkin Rule Trace: Open Rule Details`
- `Gherkin Rule Trace: Open Implementation`
- `Gherkin Rule Trace: Open Test`
- `Gherkin Rule Trace: Copy Rule Tag`
- `Gherkin Rule Trace: Generate Missing Steps`

## CodeLens

Each `Rule:` line in a `.feature` file gets a CodeLens:

```text
✓ Implemented: 1 | ✓ Tested: Yes | Copy tag | Open first step | Refresh rule
Rule: #010 A vigilance certificate must be valid
```

The status opens rule details. `Copy tag` copies `// ` followed by the exact text after `Rule:`, `Generate missing steps` writes missing TypeScript/Cucumber step definitions without adding a rule comment above them and jumps to the first generated step, and `Refresh rule` refreshes the scan while staying on the rule.

Rule lines also get a colored inline decoration for quick visual scanning.

## MVP limits

- Parsing is regex and line based.
- It does not evaluate Gherkin backgrounds, scenario outlines, examples, or localized Gherkin keywords.
- Rule-name matching is case-sensitive.
- Step matching is exact after trimming the Gherkin keyword.
- A full workspace scan is performed on refresh.
- Implementation detection only checks comments that contain the exact rule name.

## License

This project is distributed under the MIT License.

See [LICENSE](./LICENSE) for the full terms.
