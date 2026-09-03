import * as vscode from 'vscode';

/// Flags direct imports of `package:<packageName>/features/<feature>/...`
/// from anywhere outside that feature's own directory, showing them as real
/// editor diagnostics (Problems panel + red squiggles) — no external
/// analyzer plugin required.
///
/// Ported from the `tbchat_lint` Dart package: same rule, same
/// generated-file exemption, but driven by workspace settings instead of
/// `analysis_options.yaml`, so it works for any project/package layout.

const DIAGNOSTIC_SOURCE = 'dyno-feature-lint';
const DEBOUNCE_MS = 300;

const IMPORT_RE = /^\s*import\s+(['"])([^'"]+)\1/;
const GENERATED_SUFFIXES = ['.g.dart', '.freezed.dart', '.config.dart'];

interface FeatureLintConfig {
    enabled: boolean;
    packageName: string;
    features: string[];
}

function getConfig(resource: vscode.Uri): FeatureLintConfig {
    const cfg = vscode.workspace.getConfiguration('dynoExtension.featureLint', resource);
    return {
        enabled: cfg.get<boolean>('enabled', false),
        packageName: cfg.get<string>('packageName', ''),
        features: cfg.get<string[]>('features', []),
    };
}

function isGeneratedFile(fsPath: string): boolean {
    return GENERATED_SUFFIXES.some(suffix => fsPath.endsWith(suffix));
}

function lintDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
    if (document.languageId !== 'dart') {
        return;
    }

    const config = getConfig(document.uri);
    const filePath = document.uri.fsPath.replace(/\\/g, '/');

    if (!config.enabled || !config.packageName || config.features.length === 0 || isGeneratedFile(filePath)) {
        collection.delete(document.uri);
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let line = 0; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;
        const match = IMPORT_RE.exec(text);
        if (!match) {
            continue;
        }
        const importPath = match[2];

        for (const feature of config.features) {
            // Files that belong to this feature may import their own code.
            if (filePath.includes(`/features/${feature}/`)) {
                continue;
            }
            const prefix = `package:${config.packageName}/features/${feature}/`;
            if (!importPath.startsWith(prefix)) {
                continue;
            }

            const startCol = text.indexOf(importPath);
            const range = new vscode.Range(line, startCol, line, startCol + importPath.length);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Direct import of feature "${feature}" is not allowed from outside that feature. Use the Transponder pattern instead.`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.code = `avoid_import_${feature}`;
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostics.push(diagnostic);
        }
    }

    collection.set(document.uri, diagnostics);
}

export function activateFeatureLint(context: vscode.ExtensionContext): void {
    const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    context.subscriptions.push(collection);

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

    relintAllOpenDocuments();

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => lintDocument(document, collection)),
        vscode.workspace.onDidChangeTextDocument(event => lintDebounced(event.document)),
        vscode.workspace.onDidSaveTextDocument(document => lintDocument(document, collection)),
        vscode.workspace.onDidCloseTextDocument(document => collection.delete(document.uri)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('dynoExtension.featureLint')) {
                relintAllOpenDocuments();
            }
        }),
        { dispose: () => timers.forEach(timer => clearTimeout(timer)) }
    );
}
