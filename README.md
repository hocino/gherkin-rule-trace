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
  ".rb",
  ".html"
]
```

Test files are excluded from implementation detection and used for test detection only. Their patterns are configurable:

```json
"ruleTrace.testFilePatterns": [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*test.*",
  "**/*tests.*",
  "**/*_test.*",
  "**/*_tests.*",
  "**/*-test.*",
  "**/*-tests.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/bdd/**",
  "**/e2e/**"
]
```

This covers common names such as `SupplierTest.cs`, `supplier_test.py`, `validateCertificate.test.ts`, and `test.ts`.

Scan behavior can also be tuned:

```json
"ruleTrace.autoScan": true,
"ruleTrace.maxFileSizeKb": 1024,
"ruleTrace.openCsFilesInVisualStudio": true,
"ruleTrace.stepGenerationLanguage": "auto"
```

When `ruleTrace.openCsFilesInVisualStudio` is enabled on Windows, links to `.cs` files are opened in an already running Visual Studio instance when possible. If Visual Studio is not running or `devenv.exe` cannot be found, the file opens normally in VS Code.

If `.cs` links do not open in Visual Studio, make sure the folder containing `devenv.exe` is available in the user `PATH`. Run PowerShell as the current user and adapt the Visual Studio edition if needed:

```powershell
$devenvDir = "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($currentPath -split ";") -notcontains $devenvDir) {
  [Environment]::SetEnvironmentVariable("Path", "$currentPath;$devenvDir", "User")
}
```

Common Visual Studio editions use one of these folders:

```text
C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE
C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE
C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE
```

After changing the `PATH`, restart VS Code so the extension receives the updated environment.

Implementation matches are classified as backend or frontend with configurable path patterns:

```json
"ruleTrace.backendPatterns": [
  "**/backend/**",
  "**/server/**",
  "**/api/**",
  "**/domain/**",
  "**/application/**",
  "**/infrastructure/**",
  "**/*.cs",
  "**/*.java",
  "**/*.go",
  "**/*.rs",
  "**/*.py"
],
"ruleTrace.frontendPatterns": [
  "**/frontend/**",
  "**/web/**",
  "**/client/**",
  "**/ui/**",
  "**/components/**",
  "**/*.tsx",
  "**/*.jsx",
  "**/*.html"
]
```

Files that do not match either set are shown as `Other` in the rule details.

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

HTML template comments are supported too:

```html
<!-- #010 A vigilance certificate must be valid -->
<app-certificate-banner></app-certificate-banner>
```

When a scanned implementation or test file contains the exact rule name, the rule text becomes a clickable document link that opens the matching `.feature` file at the `Rule:` line.

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
✓ Back: 1 | Front: 1 | ✓ Tested: Yes | Copy tag | Open first step | Generate steps | Refresh rule
Rule: #010 A vigilance certificate must be valid
```

The status opens rule details. `Copy tag` copies `// ` followed by the exact text after `Rule:`. `Open first step` is shown when every step is already present. `Generate missing step` is shown when at least one step is missing and writes only missing TypeScript/Cucumber step definitions. `Generate steps` always generates every Gherkin step for the rule. Generated snippets do not add a rule comment above them and jump to the first generated step. `Refresh rule` refreshes the scan while staying on the rule.

Step generation supports multiple technologies. Configure it with:

```json
"ruleTrace.stepGenerationLanguage": "auto"
```

Allowed values are `auto`, `typescript`, `javascript`, `csharp`, and `python`.

In `auto` mode, the extension uses an existing step definition file when one is found. Otherwise it detects the workspace technology and generates:

- TypeScript/JavaScript Cucumber steps with `Given(...)`, `When(...)`, `Then(...)`;
- C# SpecFlow/Reqnroll steps with `[Given(...)]`, `[When(...)]`, `[Then(...)]`;
- Python Behave-style steps with `@given(...)`, `@when(...)`, `@then(...)`.

Rule lines also get a colored inline decoration for quick visual scanning.

## Syntax highlighting

The extension contributes a lightweight Gherkin language definition for `.feature` files, including syntax highlighting for:

- `Feature:`, `Rule:`, `Background:`, `Scenario:`, `Scenario Outline:`, and `Examples:`;
- steps: `Given`, `When`, `Then`, `And`, `But`;
- tags such as `@smoke`;
- comments;
- docstrings;
- examples/data tables;
- scenario outline placeholders such as `<supplierId>`.

## Performance

The scanner is optimized for larger workspaces:

- the first scan builds an in-memory trace index;
- file watchers update the index incrementally when a `.feature`, source, or test file changes;
- saving one code/test file rescans that file only;
- saving one `.feature` file reparses that file and rebuilds rule-name matches from cached source/test files;
- watcher events are debounced to avoid duplicate rescans during save bursts;
- file contents are cached by `mtime` and `size` between refreshes;
- feature and code files are read with bounded concurrency;
- implementation matching scans each code file once and uses a rule-name search index instead of checking every rule against every line;
- test matching extracts `describe(...)` and step definitions once per test file, then uses direct lookups for rule names and steps.

## MVP limits

- Parsing is regex and line based.
- It does not evaluate Gherkin backgrounds, scenario outlines, examples, or localized Gherkin keywords.
- Rule-name matching is case-sensitive.
- Step matching is exact after trimming the Gherkin keyword.
- Manual refresh performs a full workspace discovery, but unchanged files are reused from cache.
- Automatic updates from file changes are incremental.
- Implementation detection only checks comments that contain the exact rule name.

## License

This project is distributed under the MIT License.

See the `LICENSE` file for the full terms.
