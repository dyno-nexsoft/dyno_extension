<div align="center">
  <img src="icon.png" width="128" height="128" alt="Dyno Extension Icon" />
  <h1>Dyno Extension</h1>
  <p>An all-in-one developer toolkit for VS Code: multi-format file sorting, Dart barrel generation, architectural feature linting, AI-assisted Git commit messages, and an integrated AI CLI terminal sidebar.</p>
</div>

## Features

### 🔤 Multi-Format File & Selection Sorting

Clean up and normalize data files, environment variables, and configuration files with ease.

- **Sort Document & Selection**: Alphabetically sort entire files or highlighted blocks via Right-Click editor context menu or Command Palette.
- **Comment-Safe JSON / JSONC**: Deeply and recursively sorts keys in JSON and JSONC files while preserving comments and symbol metadata using `comment-json`.
- **Structure-Preserving YAML**: Deeply sorts nested YAML maps while preserving comments and document structure using `yaml` AST manipulation.
- **ENV / Properties Block Sorting**: Sorts `.env`, `.properties`, and `dotenv` files while keeping comments (`#`) and blank-line groupings attached to their respective keys, with support for multiline value continuations (`\`).
- **Plain Text Line Sorting**: Sorts lines alphabetically in plain text and `.ignore` files while preserving trailing blank lines at the bottom.
- **Smart Indentation**: Automatically respects the document's active indentation (spaces or tabs).

### ✨ AI Commit Message Generator

Craft clean, standardized Conventional Commits in seconds directly from the Source Control (SCM) panel.

- **One-Click Generation**: Click the **✨ sparkle icon** on the Source Control title bar or run `Dyno Extension: Generate Commit Message with AI`.
- **Flexible AI Providers**:
  - **Google Gemini**: Connects directly to Google Gemini API (defaults to fast, high-quality models such as `gemini-2.5-flash`).
  - **Local / Remote Ollama**: Connects to your local or private Ollama instance (`http://localhost:11434`), zero API key required.
- **Interactive Provider & Model Selector**: Choose and cache your preferred provider and model with a single click. Switch anytime via the **⚙️ gear icon** on the SCM title bar (`Dyno Extension: Change AI Provider`).
- **Conventional Commits Compliant**: Produces clear messages (`feat:`, `fix:`, `chore:`, `refactor:`, etc.) with single-line format for simple changes and clean bulleted descriptions for multi-part changes.
- **Safe & Optimized**:
  - Only inspects staged changes (`git diff --staged`).
  - Optimizes deleted file diffs to conserve tokens.
  - Detects unstaged files and prompts to `git add .` if needed.
  - Works seamlessly across Remote SSH, WSL, and Dev Containers (`--no-pager`, `GIT_OPTIONAL_LOCKS=0`).

### 💻 Embedded AI Terminal Sidebar

Run your preferred AI coding CLIs right inside VS Code without switching windows.

- **Dedicated Sidebar Container**: Access via the **Dyno Extension** icon in the Activity Bar.
- **Dynamic CLI Switcher**: Quick-switch between tabs for popular AI tools and shell:
  - **Opencode**: Runs `opencode` CLI.
  - **Claude**: Runs `claude` CLI.
  - **Gemini**: Runs `gemini` CLI.
  - **Shell**: Drops into your system's default shell (PowerShell / cmd / bash / zsh).
- **Native Webview Terminal**: Powered by `xterm.js` and `node-pty` with automatic window resizing via `ResizeObserver`.
- **Integrated Controls**: Custom right-click context menu (Copy / Paste), Start / Close process lifecycle management, and custom styled scrollbars matching the VS Code theme.
- **Configurable Commands**: Custom CLI commands configurable in VS Code settings.

### 🎯 Dart Barrel File Generator

Quickly bundle and export public APIs in Dart and Flutter packages.

- **Explorer Context Menu**: Right-click any folder in the VS Code file explorer → **"Generate Dart Barrel File"**.
- **Recursive Scan**: Scans all `.dart` files within the selected folder and sub-folders.
- **Smart `part of` Exclusion**: Automatically inspects files and skips `part of` files, ensuring only standalone exportable libraries are included.
- **Deterministic & Sorted**: Generates `<folder_name>.dart` with cleanly sorted relative `export` statements.

### 🛡️ Dart Feature Boundary Lint

Enforce modular Clean Architecture boundaries in Flutter / Dart projects without needing third-party analyzer plugins or `custom_lint`.

- **Editor Diagnostics**: Highlights forbidden cross-feature imports as red squiggles in the editor and reports them in the **Problems** panel.
- **Encapsulation Enforcement**: Prevents direct imports across feature folders (e.g. importing `package:<packageName>/features/wallet/...` from inside `lib/features/im/...`).
- **Generated File Exemption**: Automatically skips code-generated files (`.g.dart`, `.freezed.dart`, `.config.dart`).
- **Zero Dependencies**: Pure VS Code diagnostics powered by workspace settings — works out-of-the-box across any Dart/Flutter project.

---

## Supported Formats & Languages

| Format / Language           | Supported Features                                            |
| --------------------------- | ------------------------------------------------------------ |
| `JSON` / `JSONC`            | Recursive key sorting, comment preservation                  |
| `YAML`                      | Recursive key sorting, structure & comment preservation      |
| `.env` / `.properties`      | Key sorting, comment block preservation, multiline values    |
| `Plain Text` / `.ignore`    | Alphabetical line sorting                                    |
| `Dart`                      | Barrel file generation, feature boundary lint diagnostics    |
| Any `git` repository        | AI Conventional Commit message generation                    |
| Terminal CLIs               | Opencode, Claude Code, Gemini CLI, system shell              |

---

## How to Use

### 1. Sort a File or Selection
- **Sort Document**: Open a file (`.json`, `.yaml`, `.env`, `.properties`, `.txt`), right-click → **"Dyno Extension: Sort Document"**.
- **Sort Selection**: Highlight a section of code, right-click → **"Dyno Extension: Sort Selection"**.
- _(Shortcut: Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P` → Search "Dyno Extension: Sort")_

### 2. Generate AI Commit Message
1. Stage your git changes (`git add`).
2. Open the **Source Control** view (`Ctrl+Shift+G`).
3. Click the **✨ sparkle icon** in the Source Control title bar.
4. The extension analyzes your staged diff and fills the generated commit message directly into the Git commit input box.
5. To change the AI provider (Gemini / Ollama) or model, click the **⚙️ gear icon** in the Source Control title bar.

### 3. Use the AI Terminal Sidebar
1. Click the **Dyno Extension** icon in the VS Code Activity Bar.
2. Select a tab (**Opencode**, **Claude**, **Gemini**, or **Shell**).
3. Click **Start Terminal** if not already running.
4. Right-click inside the terminal for Copy / Paste actions.

### 4. Generate Dart Barrel Files
1. In the Explorer pane, right-click any folder containing Dart files.
2. Select **"Generate Dart Barrel File"**.
3. A `<folder_name>.dart` file will be created or updated with sorted exports.

### 5. Enable Dart Feature Boundary Lint
Add the following to your `.vscode/settings.json` or user settings:

```json
{
  "dynoExtension.featureLint.enabled": true,
  "dynoExtension.featureLint.packageName": "my_flutter_app",
  "dynoExtension.featureLint.features": [
    "auth",
    "chat",
    "wallet",
    "profile",
    "settings"
  ]
}
```

---

## Extension Settings

| Setting                                    | Default                  | Description                                                                                          |
| ------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `dynoExtension.ai.geminiApiKey`            | `""`                     | Gemini API Key. Get a key at [Google AI Studio](https://aistudio.google.com/apikey).                |
| `dynoExtension.ai.ollamaEndpoint`          | `"http://localhost:11434"` | URL of your local or remote Ollama server.                                                         |
| `dynoExtension.terminal.opencodeCommand`   | `"opencode"`             | Executable or command run in the Opencode tab of the AI sidebar terminal.                           |
| `dynoExtension.terminal.claudeCommand`     | `"claude"`               | Executable or command run in the Claude tab of the AI sidebar terminal.                             |
| `dynoExtension.terminal.geminiCommand`     | `"gemini"`               | Executable or command run in the Gemini tab of the AI sidebar terminal.                             |
| `dynoExtension.featureLint.enabled`        | `false`                  | Enables feature boundary linting for Dart files.                                                     |
| `dynoExtension.featureLint.packageName`    | `""`                     | Dart package name to check imports against (e.g. `tbchat_main`).                                     |
| `dynoExtension.featureLint.features`       | `[]`                     | Feature folder names under `lib/features/` whose boundaries should be enforced.                     |

---

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

---

_Created with ❤️ by [Dyno Nexsoft](https://github.com/dyno-nexsoft)_ | [View Source on GitHub](https://github.com/dyno-nexsoft/dyno_extension)
