import * as vscode from "vscode";
import { RuleTrace } from "../model/types";
import { getWorkspaceRelativePath } from "../scanner/pathUtils";

export class RuleDetailsWebview {
  private panel: vscode.WebviewPanel | undefined;
  private currentTrace: RuleTrace | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  getCurrentTrace(): RuleTrace | undefined {
    return this.currentTrace;
  }

  show(trace: RuleTrace): void {
    this.currentTrace = trace;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "ruleTraceDetails",
        "Gherkin Rule Trace Details",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri]
        }
      );

      this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.currentTrace = undefined;
      });
    }

    this.panel.title = trace.rule.name;
    this.panel.webview.html = this.render(trace);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private async handleMessage(message: { command: string; file?: string; line?: number; text?: string }): Promise<void> {
    if (message.command === "openFile" && message.file) {
      await openFileAtLine(message.file, message.line ?? 1);
      return;
    }

    if (message.command === "copy" && typeof message.text === "string") {
      await vscode.env.clipboard.writeText(message.text);
      vscode.window.showInformationMessage("Gherkin Rule Trace: copied to clipboard.");
      return;
    }

    if (message.command === "generateMissingSteps" && this.currentTrace) {
      await vscode.commands.executeCommand("ruleTrace.generateMissingSteps", this.currentTrace);
      return;
    }

    if (message.command === "refreshRule" && this.currentTrace) {
      await vscode.commands.executeCommand("ruleTrace.refreshRule", this.currentTrace);
    }
  }

  private render(trace: RuleTrace): string {
    const nonce = getNonce();
    const ruleComment = `// ${trace.rule.name}`;
    const stepButtonLabel = trace.tests.missingSteps.length > 0 ? "Generate missing steps" : "Open first step";
    const featureLink = renderFileButton(trace.rule.featureFile, trace.rule.line);
    const implementationItems =
      trace.implementations.length > 0
        ? trace.implementations
            .map(
              (match) => `
                <li>
                  <span class="ok">✓</span>
                  ${renderFileButton(match.file, match.line)}
                  <div class="preview">Preview: ${escapeHtml(match.preview)}</div>
                </li>`
            )
            .join("")
        : `<li><span class="bad">✕</span> No implementation found</li>`;

    const testSummary =
      trace.tests.tested && trace.tests.reason === "describe"
        ? "Tested by describe"
        : trace.tests.tested && trace.tests.reason === "steps"
          ? "Tested by step coverage"
          : "No test found";

    const describeItems = trace.tests.describeMatches
      .map(
        (match) => `
          <li>
            <span class="ok">✓</span>
            ${renderFileButton(match.file, match.line)}
            <div class="preview">Preview: ${escapeHtml(match.preview)}</div>
          </li>`
      )
      .join("");

    const stepCoverage = trace.rule.steps
      .map((step) => {
        const matches = trace.tests.stepMatches.filter((match) => match.step === step);
        const status = matches.length > 0 ? `<span class="ok">✓</span>` : `<span class="bad">✕</span>`;
        const files = matches
          .map((match) => `<div class="preview">${renderFileButton(match.file, match.line)}</div>`)
          .join("");
        return `<li>${status} ${escapeHtml(step)}${files}</li>`;
      })
      .join("");

    const missingSteps = trace.tests.missingSteps
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join("");

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.45;
          }
          h1, h2 {
            font-weight: 600;
          }
          h1 {
            font-size: 20px;
            margin: 0 0 16px;
          }
          h2 {
            font-size: 15px;
            margin: 24px 0 8px;
          }
          ul {
            padding-left: 18px;
          }
          li {
            margin: 8px 0;
          }
          code {
            color: var(--vscode-textLink-foreground);
          }
          .ok {
            color: var(--vscode-testing-iconPassed);
            font-weight: 600;
          }
          .warn {
            color: var(--vscode-testing-iconQueued);
            font-weight: 600;
          }
          .bad {
            color: var(--vscode-testing-iconFailed);
            font-weight: 600;
          }
          .preview {
            margin-top: 2px;
            color: var(--vscode-descriptionForeground);
          }
          .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 12px 0 20px;
          }
          button {
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 4px;
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            cursor: pointer;
            padding: 4px 9px;
            font: inherit;
          }
          button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .link-button {
            border: 0;
            color: var(--vscode-textLink-foreground);
            background: transparent;
            padding: 0;
            text-align: left;
          }
          .link-button:hover {
            text-decoration: underline;
            background: transparent;
          }
          .status-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 8px 0 16px;
          }
          .pill {
            border-radius: 999px;
            padding: 3px 9px;
            font-weight: 600;
          }
          .pill.ok {
            background: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent);
          }
          .pill.bad {
            background: color-mix(in srgb, var(--vscode-testing-iconFailed) 18%, transparent);
          }
          .pill.warn {
            background: color-mix(in srgb, var(--vscode-testing-iconQueued) 18%, transparent);
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(trace.rule.name)}</h1>
        <div class="status-row">
          <span class="pill ${trace.implementations.length > 0 ? "ok" : "bad"}">
            ${trace.implementations.length > 0 ? "✓" : "✕"} Implemented: ${trace.implementations.length}
          </span>
          <span class="pill ${trace.tests.tested ? "ok" : "bad"}">
            ${trace.tests.tested ? "✓" : "✕"} Tested: ${trace.tests.tested ? "Yes" : "No"}
          </span>
        </div>
        <div class="actions">
          <button data-command="copy" data-text="${escapeAttribute(ruleComment)}">Copy rule tag</button>
          <button data-command="copy" data-text="${escapeAttribute(ruleComment)}">Copy implementation comment</button>
          <button data-command="generateMissingSteps">${escapeHtml(stepButtonLabel)}</button>
          <button data-command="refreshRule">Refresh</button>
        </div>

        <h2>Feature file</h2>
        <p>${featureLink}</p>

        <h2>Implementation</h2>
        <ul>${implementationItems}</ul>

        <h2>Tests</h2>
        <p class="${trace.tests.tested ? "ok" : "bad"}">${escapeHtml(testSummary)}</p>
        ${describeItems ? `<ul>${describeItems}</ul>` : ""}

        <h2>Step coverage</h2>
        <ul>${stepCoverage || "<li>No steps found under this rule</li>"}</ul>

        ${
          trace.tests.missingSteps.length > 0
            ? `<h2>Missing steps</h2><ul>${missingSteps}</ul>`
            : ""
        }
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          document.addEventListener("click", (event) => {
            const target = event.target.closest("button[data-command]");
            if (!target) {
              return;
            }

            vscode.postMessage({
              command: target.dataset.command,
              file: target.dataset.file,
              line: target.dataset.line ? Number(target.dataset.line) : undefined,
              text: target.dataset.text
            });
          });
        </script>
      </body>
      </html>`;
  }
}

async function openFileAtLine(file: string, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const position = new vscode.Position(Math.max(line - 1, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function renderFileButton(file: string, line: number): string {
  return `<button class="link-button" data-command="openFile" data-file="${escapeAttribute(file)}" data-line="${line}">
    <code>${escapeHtml(getWorkspaceRelativePath(file))}:${line}</code>
  </button>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
