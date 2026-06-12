import * as path from "path";
import * as vscode from "vscode";
import { FeatureRule, ImplementationLayer, RuleImplementationMatch, RuleTrace, WorkspaceScanResult } from "../model/types";
import { parseFeatureFile } from "./featureParser";
import { IndexedImplementationMatch, scanImplementationFile } from "./implementationScanner";
import { isTestFile, matchesAnyGlob, normalizeFsPath } from "./pathUtils";
import { createRuleSearchIndex, RuleSearchIndex } from "./ruleSearchIndex";
import { buildTestMatches, DescribeMatch, RuleTagMatch, scanTestFile, StepDefinitionMatch } from "./testScanner";

interface TextFile {
  file: string;
  content: string;
}

interface CachedTextFile {
  mtime: number;
  size: number;
  content: string;
}

interface ScannerConfig {
  include: string[];
  exclude: string[];
  codeExtensions: string[];
  codeExtensionSet: Set<string>;
  frontendPatterns: string[];
  backendPatterns: string[];
  testFilePatterns: string[];
  autoScan: boolean;
  maxFileSizeKb: number;
}

interface ScanCounters {
  cacheHits: number;
  cacheMisses: number;
}

const readConcurrency = 24;

export class WorkspaceScanner {
  private readonly fileCache = new Map<string, CachedTextFile>();
  private readonly featureRulesByFile = new Map<string, FeatureRule[]>();
  private readonly implementationMatchesByFile = new Map<string, IndexedImplementationMatch[]>();
  private readonly describeMatchesByFile = new Map<string, DescribeMatch[]>();
  private readonly tagMatchesByFile = new Map<string, RuleTagMatch[]>();
  private readonly stepDefinitionsByFile = new Map<string, StepDefinitionMatch[]>();
  private readonly knownCodeFiles = new Set<string>();
  private config = this.readConfig();
  private ruleIndex: RuleSearchIndex = createRuleSearchIndex([]);

  async scan(): Promise<WorkspaceScanResult> {
    const startedAt = Date.now();
    const counters: ScanCounters = { cacheHits: 0, cacheMisses: 0 };

    this.config = this.readConfig();
    this.clearIndex();

    if (!vscode.workspace.workspaceFolders?.length) {
      return this.buildResult("full", startedAt, 0, counters);
    }

    const featureUris = await this.findUniqueFiles(this.config.include, this.config.exclude);
    const featureFiles = await this.readFiles(featureUris, counters);
    for (const file of featureFiles) {
      this.featureRulesByFile.set(file.file, parseFeatureFile(file.file, file.content));
    }

    this.rebuildRuleIndex();

    const codeUris = await this.findCodeFiles();
    const codeFiles = await this.readFiles(codeUris, counters);
    for (const file of codeFiles) {
      this.knownCodeFiles.add(file.file);
      this.scanCodeTextFile(file);
    }

    this.pruneCache([...featureFiles, ...codeFiles].map((file) => file.file));
    return this.buildResult("full", startedAt, featureFiles.length + codeFiles.length, counters);
  }

  async updateFile(uri: vscode.Uri): Promise<WorkspaceScanResult> {
    const startedAt = Date.now();
    const counters: ScanCounters = { cacheHits: 0, cacheMisses: 0 };
    this.config = this.readConfig();

    if (this.isExcluded(uri.fsPath)) {
      return this.deleteFile(uri);
    }

    if (this.isFeatureFile(uri.fsPath)) {
      await this.updateFeatureFile(uri, counters);
      return this.buildResult("incremental", startedAt, 1, counters);
    }

    if (this.isCodeFile(uri.fsPath)) {
      await this.updateCodeFile(uri, counters);
      return this.buildResult("incremental", startedAt, 1, counters);
    }

    return this.buildResult("incremental", startedAt, 0, counters);
  }

  async deleteFile(uri: vscode.Uri): Promise<WorkspaceScanResult> {
    const startedAt = Date.now();
    const file = uri.fsPath;
    const hadFeature = this.featureRulesByFile.delete(file);
    const hadCode = this.knownCodeFiles.delete(file);

    this.fileCache.delete(file);
    this.implementationMatchesByFile.delete(file);
    this.describeMatchesByFile.delete(file);
    this.tagMatchesByFile.delete(file);
    this.stepDefinitionsByFile.delete(file);

    if (hadFeature) {
      this.rebuildRuleIndex();
      await this.rescanKnownCodeFiles({ cacheHits: 0, cacheMisses: 0 });
    }

    return this.buildResult("incremental", startedAt, hadFeature || hadCode ? 1 : 0, {
      cacheHits: 0,
      cacheMisses: 0
    });
  }

  private async updateFeatureFile(uri: vscode.Uri, counters: ScanCounters): Promise<void> {
    const textFile = await this.readTextFile(uri, counters);
    this.featureRulesByFile.set(textFile.file, parseFeatureFile(textFile.file, textFile.content));
    this.rebuildRuleIndex();

    // Rule names may have changed, so existing implementation and describe matches must be rebuilt.
    await this.rescanKnownCodeFiles(counters);
  }

  private async updateCodeFile(uri: vscode.Uri, counters: ScanCounters): Promise<void> {
    const textFile = await this.readTextFile(uri, counters);
    this.knownCodeFiles.add(textFile.file);
    this.scanCodeTextFile(textFile);
  }

  private async rescanKnownCodeFiles(counters: ScanCounters): Promise<void> {
    const uris = Array.from(this.knownCodeFiles, (file) => vscode.Uri.file(file));
    const files = await this.readFiles(uris, counters);
    this.implementationMatchesByFile.clear();
    this.describeMatchesByFile.clear();
    this.tagMatchesByFile.clear();
    this.stepDefinitionsByFile.clear();
    for (const file of files) {
      this.scanCodeTextFile(file);
    }
  }

  private scanCodeTextFile(file: TextFile): void {
    if (isTestFile(file.file, this.config.testFilePatterns)) {
      this.implementationMatchesByFile.delete(file.file);
      const scan = scanTestFile(file, this.ruleIndex);
      this.describeMatchesByFile.set(file.file, scan.describeMatches);
      this.tagMatchesByFile.set(file.file, scan.tagMatches);
      this.stepDefinitionsByFile.set(file.file, scan.stepDefinitions);
      return;
    }

    this.describeMatchesByFile.delete(file.file);
    this.tagMatchesByFile.delete(file.file);
    this.stepDefinitionsByFile.delete(file.file);
    this.implementationMatchesByFile.set(
      file.file,
      scanImplementationFile(file, this.ruleIndex).map((match) => ({
        ...match,
        layer: this.classifyImplementationLayer(match.file)
      }))
    );
  }

  private buildResult(
    mode: "full" | "incremental",
    startedAt: number,
    changedFiles: number,
    counters: ScanCounters
  ): WorkspaceScanResult {
    const rules = this.getAllRules();
    const implementations = this.buildImplementationMatches(rules);
    const tests = buildTestMatches(
      rules,
      this.describeMatchesByFile.values(),
      this.tagMatchesByFile.values(),
      this.stepDefinitionsByFile.values()
    );

    const traces: RuleTrace[] = rules.map((rule) => ({
      rule,
      implementations: implementations.get(rule.id) ?? [],
      tests:
        tests.get(rule.id) ?? {
          tested: false,
          reason: "none",
          describeMatches: [],
          tagMatches: [],
          stepMatches: [],
          missingSteps: rule.steps
        }
    }));

    return {
      rules: traces,
      scannedAt: new Date(),
      stats: {
        mode,
        durationMs: Date.now() - startedAt,
        featureFiles: this.featureRulesByFile.size,
        codeFiles: this.knownCodeFiles.size,
        rules: rules.length,
        changedFiles,
        cacheHits: counters.cacheHits,
        cacheMisses: counters.cacheMisses
      }
    };
  }

  private buildImplementationMatches(rules: FeatureRule[]): Map<string, RuleImplementationMatch[]> {
    const matches = new Map<string, RuleImplementationMatch[]>();
    const knownRuleIds = new Set(rules.map((rule) => rule.id));

    for (const rule of rules) {
      matches.set(rule.id, []);
    }

    for (const fileMatches of this.implementationMatchesByFile.values()) {
      for (const match of fileMatches) {
        if (!knownRuleIds.has(match.ruleId)) {
          continue;
        }

        matches.get(match.ruleId)?.push({
          file: match.file,
          line: match.line,
          preview: match.preview,
          layer: match.layer
        });
      }
    }

    return matches;
  }

  private rebuildRuleIndex(): void {
    this.ruleIndex = createRuleSearchIndex(this.getAllRules());
  }

  private getAllRules(): FeatureRule[] {
    return Array.from(this.featureRulesByFile.values()).flat();
  }

  private clearIndex(): void {
    this.featureRulesByFile.clear();
    this.implementationMatchesByFile.clear();
    this.describeMatchesByFile.clear();
    this.tagMatchesByFile.clear();
    this.stepDefinitionsByFile.clear();
    this.knownCodeFiles.clear();
    this.ruleIndex = createRuleSearchIndex([]);
  }

  private readConfig(): ScannerConfig {
    const config = vscode.workspace.getConfiguration("ruleTrace");
    const include = config.get<string[]>("include", ["**/*.feature"]);
    const exclude = config.get<string[]>("exclude", [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.git/**"
    ]);
    const codeExtensions = config.get<string[]>("codeExtensions", [
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
    ]);
    const frontendPatterns = config.get<string[]>("frontendPatterns", [
      "**/frontend/**",
      "**/front/**",
      "**/web/**",
      "**/client/**",
      "**/ui/**",
      "**/components/**",
      "**/*.tsx",
      "**/*.jsx",
      "**/*.html"
    ]);
    const backendPatterns = config.get<string[]>("backendPatterns", [
      "**/backend/**",
      "**/back/**",
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
    ]);
    const testFilePatterns = config.get<string[]>("testFilePatterns", [
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
    ]);
    const autoScan = config.get<boolean>("autoScan", true);
    const maxFileSizeKb = config.get<number>("maxFileSizeKb", 1024);

    return {
      include,
      exclude,
      codeExtensions,
      codeExtensionSet: new Set(codeExtensions.map((extension) => extension.toLowerCase())),
      frontendPatterns,
      backendPatterns,
      testFilePatterns,
      autoScan,
      maxFileSizeKb
    };
  }

  private async findCodeFiles(): Promise<vscode.Uri[]> {
    if (this.config.codeExtensions.length === 0) {
      return [];
    }

    const globExtensions = this.config.codeExtensions.map((extension) => extension.replace(/^\./, ""));
    const pattern = `**/*.{${globExtensions.join(",")}}`;
    const uris = await vscode.workspace.findFiles(pattern, `{${this.config.exclude.join(",")}}`);
    return uris.filter((uri) => this.isCodeFile(uri.fsPath));
  }

  private async findUniqueFiles(include: string[], exclude: string[]): Promise<vscode.Uri[]> {
    const urisByPath = new Map<string, vscode.Uri>();
    for (const pattern of include) {
      const uris = await vscode.workspace.findFiles(pattern, `{${exclude.join(",")}}`);
      for (const uri of uris) {
        urisByPath.set(uri.fsPath, uri);
      }
    }

    return Array.from(urisByPath.values());
  }

  private async readFiles(uris: vscode.Uri[], counters: ScanCounters): Promise<TextFile[]> {
    return mapWithConcurrency(uris, readConcurrency, (uri) => this.readTextFile(uri, counters));
  }

  private async readTextFile(uri: vscode.Uri, counters: ScanCounters): Promise<TextFile> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > this.config.maxFileSizeKb * 1024) {
      counters.cacheHits += 1;
      return { file: uri.fsPath, content: "" };
    }

    const cached = this.fileCache.get(uri.fsPath);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      counters.cacheHits += 1;
      return { file: uri.fsPath, content: cached.content };
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString("utf8");
    this.fileCache.set(uri.fsPath, {
      mtime: stat.mtime,
      size: stat.size,
      content
    });
    counters.cacheMisses += 1;
    return { file: uri.fsPath, content };
  }

  private pruneCache(activeFiles: string[]): void {
    const active = new Set(activeFiles);
    for (const file of this.fileCache.keys()) {
      if (!active.has(file)) {
        this.fileCache.delete(file);
      }
    }
  }

  private isFeatureFile(file: string): boolean {
    return path.extname(file).toLowerCase() === ".feature";
  }

  private isCodeFile(file: string): boolean {
    return this.config.codeExtensionSet.has(path.extname(file).toLowerCase());
  }

  private isExcluded(file: string): boolean {
    const normalized = normalizeFsPath(file).toLowerCase();
    return this.config.exclude.some((pattern) => {
      const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
      const folderMatch = normalizedPattern.match(/^\*\*\/(.+)\/\*\*$/);
      if (folderMatch) {
        return normalized.split("/").includes(folderMatch[1]);
      }

      return false;
    });
  }

  private classifyImplementationLayer(file: string): ImplementationLayer {
    const relativePath = normalizeFsPath(vscode.workspace.asRelativePath(file, false));
    if (matchesAnyGlob(relativePath, this.config.frontendPatterns) || matchesAnyGlob(file, this.config.frontendPatterns)) {
      return "frontend";
    }

    if (matchesAnyGlob(relativePath, this.config.backendPatterns) || matchesAnyGlob(file, this.config.backendPatterns)) {
      return "backend";
    }

    return "unknown";
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
