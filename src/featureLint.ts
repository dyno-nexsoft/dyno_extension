import * as vscode from 'vscode';

/// Flags direct imports of `package:<packageName>/features/<feature>/...`
/// from anywhere outside that feature's own directory, showing them as real
/// editor diagnostics (Problems panel + red squiggles) — no external
/// analyzer plugin required.
///
/// Diagnostics are produced for any document VS Code has loaded (open, typed
/// in, or saved). Because VS Code only loads documents that are actually used,
/// the `dynoExtension.lintFeatureWorkspace` command additionally scans every
/// Dart file in the workspace once and reports the result in the Problems
/// panel and the "Dyno Feature Lint" output channel.
///
/// Ported from the `tbchat_lint` Dart package: same rule, same
/// generated-file exemption, but driven by workspace settings instead of
/// `analysis_options.yaml`, so it works for any project/package layout.

const DIAGNOSTIC_SOURCE = 'dyno-feature-lint';
const OUTPUT_CHANNEL_NAME = 'Dyno Feature Lint';
const DEBOUNCE_MS = 300;

const IMPORT_RE = /^\s*import\s+(['"])([^'"]+)\1/;
const GENERATED_SUFFIXES = ['.g.dart', '.freezed.dart', '.config.dart'];
const IGNORED_PATH_RE = /\/(\.dart_tool|build|node_modules)\//;
/// Files are read in parallel because the scan is I/O bound; the rule itself
/// is a single anchored regex per line and is cheap even on large projects.
const SCAN_CONCURRENCY = 32;

interface FeatureLintConfig {
    packageName: string;
    features: string[];
}

interface LintIssue {
    line: number;
    startCol: number;
    length: number;
    message: string;
    code: string;
}

function getConfig(resource?: vscode.Uri): FeatureLintConfig {
    const cfg = vscode.workspace.getConfiguration('dynoExtension.featureLint', resource);
    return {
        packageName: cfg.get<string>('packageName', '').trim(),
        features: cfg.get<string[]>('features', []),
    };
}

function isGeneratedFile(fsPath: string): boolean {
    return GENERATED_SUFFIXES.some(suffix => fsPath.endsWith(suffix));
}

function isLintingEnabled(config: FeatureLintConfig): boolean {
    return config.packageName.length > 0 && config.features.length > 0;
}

/// Pure text scan so the same rule can run against an open document or a file
/// read straight from disk (files the user never opened).
function lintText(text: string, filePath: string, config: FeatureLintConfig): LintIssue[] {
    if (!isLintingEnabled(config) || isGeneratedFile(filePath)) {
        return [];
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const issues: LintIssue[] = [];
    const lines = text.split(/\r?\n/);

    for (let line = 0; line < lines.length; line++) {
        const lineText = lines[line];
        const match = IMPORT_RE.exec(lineText);
        if (!match) {
            continue;
        }
        const importPath = match[2];

        for (const feature of config.features) {
            // Files that belong to this feature may import their own code.
            if (normalizedPath.includes(`/features/${feature}/`)) {
                continue;
            }
            const prefix = `package:${config.packageName}/features/${feature}/`;
            if (!importPath.startsWith(prefix)) {
                continue;
            }

            const startCol = lineText.indexOf(importPath);
            issues.push({
                line,
                startCol,
                length: importPath.length,
                message: `Direct import of feature "${feature}" is not allowed from outside that feature. Use the Transponder pattern instead.`,
                code: `avoid_import_${feature}`,
            });
        }
    }

    return issues;
}

function toDiagnostics(issues: LintIssue[]): vscode.Diagnostic[] {
    return issues.map(issue => {
        const range = new vscode.Range(
            issue.line,
            issue.startCol,
            issue.line,
            issue.startCol + issue.length
        );
        const diagnostic = new vscode.Diagnostic(
            range,
            issue.message,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.code = issue.code;
        diagnostic.source = DIAGNOSTIC_SOURCE;
        return diagnostic;
    });
}

function lintDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (document.languageId !== 'dart') {
        return;
    }

    const config = getConfig(document.uri);
    const issues = lintText(document.getText(), document.uri.fsPath, config);
    collection.set(document.uri, toDiagnostics(issues));
}

function decodeFile(contents: Uint8Array): string {
    return new TextDecoder('utf-8').decode(contents);
}

async function findDartFiles(token: vscode.CancellationToken): Promise<vscode.Uri[]> {
    const files = await vscode.workspace.findFiles('**/*.dart', undefined, undefined, token);
    // `findFiles` already honours files.exclude / search.exclude; this extra
    // filter drops common generated-output folders that are usually not
    // excluded explicitly, plus generated files that the rule ignores anyway
    // (no point reading their contents).
    return files.filter(file => {
        const fsPath = file.fsPath.replace(/\\/g, '/');
        return !IGNORED_PATH_RE.test(fsPath) && !isGeneratedFile(fsPath);
    });
}

export function activateFeatureLint(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(collection, output);

    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    function lintDebounced(document: vscode.TextDocument): void {
        const key = document.uri.toString();
        const existing = timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        timers.set(
            key,
            setTimeout(() => {
                timers.delete(key);
                lintDocument(document, collection);
            }, DEBOUNCE_MS)
        );
    }

    function relintAllOpenDocuments(): void {
        for (const document of vscode.workspace.textDocuments) {
            lintDocument(document, collection);
        }
    }

    async function lintWorkspace(): Promise<void> {
        const config = getConfig();
        if (!isLintingEnabled(config)) {
            void vscode.window.showWarningMessage(
                'Dyno Extension: set "dynoExtension.featureLint.packageName" and "dynoExtension.featureLint.features" first.'
            );
            return;
        }

        output.clear();
        output.appendLine(
            `Feature boundary lint — package "${config.packageName}", features: ${config.features.join(', ')}`
        );

        const result = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Dyno: Linting feature boundaries',
                cancellable: true,
            },
            async (progress, token) => {
                const startedAt = Date.now();
                const files = await findDartFiles(token);
                let scanned = 0;
                let filesWithIssues = 0;
                let totalIssues = 0;
                let next = 0;
                const report: string[] = [];

                const scanNext = async (): Promise<void> => {
                    while (!token.isCancellationRequested) {
                        const index = next++;
                        if (index >= files.length) {
                            return;
                        }
                        const uri = files[index];

                        let text: string;
                        try {
                            text = decodeFile(await vscode.workspace.fs.readFile(uri));
                        } catch {
                            scanned++;
                            continue;
                        }

                        const issues = lintText(text, uri.fsPath, config);
                        // Skip empty updates for files that never had diagnostics.
                        if (issues.length > 0 || collection.has(uri)) {
                            collection.set(uri, toDiagnostics(issues));
                        }
                        scanned++;

                        if (issues.length > 0) {
                            filesWithIssues++;
                            totalIssues += issues.length;
                            const relativePath = vscode.workspace
                                .asRelativePath(uri, false)
                                .replace(/\\/g, '/');
                            for (const issue of issues) {
                                report.push(
                                    `${relativePath}:${issue.line + 1}:${issue.startCol + 1}  error  ${issue.message}  (${issue.code})`
                                );
                            }
                        }

                        if (scanned % 25 === 0) {
                            progress.report({
                                message: `${scanned}/${files.length} files · ${totalIssues} issue(s)`,
                            });
                        }
                    }
                };

                const workers = Array.from(
                    { length: Math.min(SCAN_CONCURRENCY, files.length) },
                    () => scanNext()
                );
                await Promise.all(workers);

                return {
                    scanned,
                    filesWithIssues,
                    totalIssues,
                    report,
                    cancelled: token.isCancellationRequested,
                    elapsedMs: Date.now() - startedAt,
                };
            }
        );

        const summary = result.cancelled ? 'Cancelled.' : 'Done.';
        output.appendLine(
            `${summary} Scanned ${result.scanned} Dart file(s) in ${result.elapsedMs} ms: ${result.totalIssues} issue(s) in ${result.filesWithIssues} file(s).`
        );
        output.appendLine('');
        if (result.report.length > 0) {
            output.append(result.report.join('\n') + '\n');
        }

        if (result.cancelled) {
            return;
        }

        if (result.totalIssues === 0) {
            void vscode.window.showInformationMessage(
                `Dyno: no feature boundary violations in ${result.scanned} Dart file(s).`
            );
            return;
        }

        const action = await vscode.window.showWarningMessage(
            `Dyno: ${result.totalIssues} feature boundary violation(s) in ${result.filesWithIssues} file(s).`,
            'Show Problems',
            'Show Output'
        );
        if (action === 'Show Problems') {
            void vscode.commands.executeCommand('workbench.actions.view.problems');
        } else if (action === 'Show Output') {
            output.show(true);
        }
    }

    relintAllOpenDocuments();

    context.subscriptions.push(
        vscode.commands.registerCommand('dynoExtension.lintFeatureWorkspace', () => lintWorkspace()),
        vscode.workspace.onDidOpenTextDocument(document => lintDocument(document, collection)),
        vscode.workspace.onDidChangeTextDocument(event => lintDebounced(event.document)),
        vscode.workspace.onDidSaveTextDocument(document => lintDocument(document, collection)),
        // Keep diagnostics for files scanned by the workspace command even
        // after their editor is closed; drop diagnostics for unsaved buffers.
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.uri.scheme === 'untitled') {
                collection.delete(document.uri);
            }
        }),
        vscode.workspace.onDidDeleteFiles(event => {
            for (const uri of event.files) {
                collection.delete(uri);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('dynoExtension.featureLint')) {
                relintAllOpenDocuments();
            }
        }),
        { dispose: () => timers.forEach(timer => clearTimeout(timer)) }
    );
}
