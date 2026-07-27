import * as vscode from 'vscode';
import * as pty from 'node-pty';
import * as os from 'os';

export class OpencodeWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'opencode.sidebar.view';

    private _view?: vscode.WebviewView;
    private _ptyProcess?: pty.IPty;
    private _currentCli: string = 'opencode';

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Do not start PTY automatically
        // this._setupPty();

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'terminalInput':
                        if (this._ptyProcess) {
                            this._ptyProcess.write(message.value);
                        }
                        break;
                    case 'terminalResize':
                        if (this._ptyProcess) {
                            this._ptyProcess.resize(message.cols, message.rows);
                        }
                        break;
                    case 'reloadTerminal':
                        this._reloadPty();
                        break;
                    case 'closeTerminal':
                        this._closePty();
                        break;
                    case 'openClaude':
                        this._switchCli('claude');
                        break;
                    case 'openGemini':
                        this._switchCli('gemini');
                        break;
                    case 'openOpencode':
                        this._switchCli('opencode');
                        break;
                    case 'openShell':
                        this._switchCli('shell');
                        break;
                    case 'requestPaste':
                        vscode.env.clipboard.readText().then(text => {
                            if (this._ptyProcess && text) {
                                this._ptyProcess.write(text);
                            }
                        });
                        break;
                    case 'writeToTerminal':
                        if (this._ptyProcess) {
                            this._ptyProcess.write(message.value);
                        }
                        break;
                    case 'startTerminal':
                        this._reloadPty();
                        this._view?.webview.postMessage({ type: 'terminalStarted' });
                        break;
                    case 'copyText':
                        vscode.env.clipboard.writeText(message.value);
                        break;
                }
            });

        webviewView.onDidDispose(() => {
            if (this._ptyProcess) {
                this._ptyProcess.kill();
                this._ptyProcess = undefined;
            }
        });
    }

    private _switchCli(cli: string) {
        if (this._currentCli === cli && this._ptyProcess) {
            return; // Already running this CLI
        }
        this._currentCli = cli;
        this._reloadPty();
    }

    private _reloadPty() {
        if (this._ptyProcess) {
            this._ptyProcess.kill();
        }
        this._view?.webview.postMessage({ type: 'terminalClear' });
        this._setupPty();
    }

    private _closePty() {
        if (this._ptyProcess) {
            this._ptyProcess.kill();
            this._ptyProcess = undefined;
        }
        this._view?.webview.postMessage({ type: 'terminalClear' });
        this._view?.webview.postMessage({ type: 'terminalOutput', value: '\r\n[Opencode process closed. Click Reload to start again.]\r\n' });
    }

    private _setupPty() {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        let args: string[] = [];
        
        if (this._currentCli !== 'shell') {
            const config = vscode.workspace.getConfiguration('dynoExtension');
            const command = config.get<string>(`terminal.${this._currentCli}Command`) || this._currentCli;
            args = ['-NoExit', '-Command', command];
        }

        this._ptyProcess = pty.spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', args, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: cwd,
            env: process.env as Record<string, string>
        });

        this._ptyProcess.onData(data => {
            this._view?.webview.postMessage({ type: 'terminalOutput', value: data });
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const xtermCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'));
        const xtermJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'));
        const fitAddonJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${xtermCssUri}" rel="stylesheet">
                <title>Opencode Terminal</title>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-foreground);
                        overflow: hidden;
                    }
                    .tab-bar {
                        display: flex;
                        background-color: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        align-items: center;
                    }
                    .tab-group {
                        display: flex;
                        flex: 1;
                    }
                    .tab-bar button {
                        padding: 8px 10px;
                        background: transparent;
                        border: none;
                        border-bottom: 2px solid transparent;
                        color: var(--vscode-foreground);
                        cursor: pointer;
                        font-family: var(--vscode-font-family);
                        font-size: 11px;
                        text-transform: uppercase;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        opacity: 0.6;
                        transition: opacity 0.2s, border-bottom-color 0.2s, background-color 0.2s;
                    }
                    .tab-bar button:hover {
                        opacity: 1;
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    .tab-group button.active {
                        opacity: 1;
                        border-bottom-color: var(--vscode-panelTitle-activeBorder);
                        color: var(--vscode-panelTitle-activeForeground);
                    }
                    .tab-bar svg {
                        width: 14px;
                        height: 14px;
                    }
                    #terminal-container {
                        flex: 1;
                        width: 100%;
                        padding: 4px;
                        box-sizing: border-box;
                    }
                    #closed-state {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                    }
                    #closed-state button {
                        margin-top: 12px;
                        padding: 6px 12px;
                        font-size: 13px;
                    }
                    /* Tweak xterm.js colors to match VS Code */
                    .xterm .xterm-viewport {
                        background-color: transparent !important;
                    }
                    /* Custom Scrollbar for Webview to match VS Code */
                    ::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                    ::-webkit-scrollbar-track {
                        background-color: transparent;
                    }
                    ::-webkit-scrollbar-thumb {
                        background-color: var(--vscode-scrollbarSlider-background);
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background-color: var(--vscode-scrollbarSlider-hoverBackground);
                    }
                    ::-webkit-scrollbar-thumb:active {
                        background-color: var(--vscode-scrollbarSlider-activeBackground);
                    }
                    #context-menu {
                        position: absolute;
                        display: none;
                        background-color: var(--vscode-menu-background);
                        color: var(--vscode-menu-foreground);
                        border: 1px solid var(--vscode-menu-border);
                        box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                        z-index: 1000;
                        border-radius: 4px;
                        padding: 4px 0;
                        min-width: 120px;
                    }
                    .context-menu-item {
                        padding: 6px 12px;
                        cursor: pointer;
                        font-size: 13px;
                        font-family: var(--vscode-font-family);
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .context-menu-item:hover {
                        background-color: var(--vscode-menu-selectionBackground);
                        color: var(--vscode-menu-selectionForeground);
                    }
                </style>
            </head>
            <body>
                <div class="tab-bar">
                    <div class="tab-group">
                        <button id="tab-opencode" class="active" title="Opencode">
                            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 2h-13c-.8 0-1.5.7-1.5 1.5v9c0 .8.7 1.5 1.5 1.5h13c.8 0 1.5-.7 1.5-1.5v-9c0-.8-.7-1.5-1.5-1.5zm0 10.5h-13v-9h13v9z"/><path d="M3.5 5.5l3 2.5-3 2.5.8.8 4-3.3-4-3.3zM8.5 10h4v1h-4z"/></svg>
                            Opencode
                        </button>
                        <button id="tab-claude" title="Claude Code">
                            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13V2a6 6 0 1 1 0 12zM5.5 8a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z"/></svg>
                            Claude
                        </button>
                        <button id="tab-gemini" title="Gemini CLI">
                            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.4 2.6l-1-1-2.2 2.2-1.2-1.2 2.2-2.2-1-1h4.2v4.2l-1-1-1.2 1.2-2.2-2.2zm-10.8 0l1 1 2.2-2.2 1.2 1.2-2.2 2.2 1 1H2.4V2.6l1 1 1.2-1.2 2.2 2.2zM2.6 13.4l1 1 2.2-2.2 1.2 1.2-2.2 2.2 1 1H2.4v-4.2l1-1-1.2 1.2 2.2 2.2zm10.8 0l-1-1-2.2 2.2-1.2-1.2 2.2-2.2-1-1h4.2v4.2l-1 1 1.2-1.2-2.2-2.2zM8 4.5A3.5 3.5 0 1 0 11.5 8 3.5 3.5 0 0 0 8 4.5zm0 6A2.5 2.5 0 1 1 10.5 8 2.5 2.5 0 0 1 8 10.5z"/></svg>
                            Gemini
                        </button>
                        <button id="tab-shell" title="Shell">
                            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 4l4 4-4 4L4.8 11.3l3.3-3.3-3.3-3.3L5.5 4zm4 8h5v1h-5v-1z"/></svg>
                            Shell
                        </button>
                    </div>
                </div>
                <div id="terminal-container" style="display: none;"></div>
                <div id="closed-state">
                    <div>Terminal is not running.</div>
                    <button id="btn-start" style="background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px;">Start Terminal</button>
                </div>
                
                <div id="context-menu">
                    <div class="context-menu-item" id="menu-copy">
                        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/><path d="M3 1H2v14h1V2h9V1H3z"/></svg>
                        Copy
                    </div>
                    <div class="context-menu-item" id="menu-paste">
                        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M14 4h-2V3a1 1 0 0 0-1-1H9V1H7v1H5a1 1 0 0 0-1 1v1H2v11h12V4zM8 2h1v1H7V2zM5 4V3h2v2h2V3h2v1h1v10H3V4h2z"/></svg>
                        Paste
                    </div>
                </div>

                <script nonce="${nonce}" src="${xtermJsUri}"></script>
                <script nonce="${nonce}" src="${fitAddonJsUri}"></script>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    const term = new Terminal({
                        theme: {
                            background: getComputedStyle(document.body).getPropertyValue('--vscode-terminal-background') || '#1e1e1e',
                            foreground: getComputedStyle(document.body).getPropertyValue('--vscode-terminal-foreground') || '#cccccc',
                        },
                        cursorBlink: true,
                        fontFamily: getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family') || 'Consolas, monospace',
                        fontSize: parseInt(getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-size')) || 14
                    });

                    const fitAddon = new FitAddon.FitAddon();
                    term.loadAddon(fitAddon);
                    
                    term.open(document.getElementById('terminal-container'));
                    fitAddon.fit();

                    // Send resize to pty
                    vscode.postMessage({
                        type: 'terminalResize',
                        cols: term.cols,
                        rows: term.rows
                    });

                    const resizeObserver = new ResizeObserver(() => {
                        try {
                            fitAddon.fit();
                            vscode.postMessage({
                                type: 'terminalResize',
                                cols: term.cols,
                                rows: term.rows
                            });
                        } catch (e) {
                            // Container might be hidden
                        }
                    });
                    resizeObserver.observe(document.getElementById('terminal-container'));
                    
                    const tabs = ['tab-opencode', 'tab-claude', 'tab-gemini', 'tab-shell'];
                    const activateTab = (tabId) => {
                        tabs.forEach(id => document.getElementById(id).classList.remove('active'));
                        document.getElementById(tabId).classList.add('active');
                        document.getElementById('terminal-container').style.display = 'block';
                        document.getElementById('closed-state').style.display = 'none';
                    };

                    document.getElementById('tab-opencode').addEventListener('click', () => {
                        activateTab('tab-opencode');
                        vscode.postMessage({ type: 'openOpencode' });
                    });
                    document.getElementById('tab-claude').addEventListener('click', () => {
                        activateTab('tab-claude');
                        vscode.postMessage({ type: 'openClaude' });
                    });
                    document.getElementById('tab-gemini').addEventListener('click', () => {
                        activateTab('tab-gemini');
                        vscode.postMessage({ type: 'openGemini' });
                    });
                    document.getElementById('tab-shell').addEventListener('click', () => {
                        activateTab('tab-shell');
                        vscode.postMessage({ type: 'openShell' });
                    });
                    
                    document.getElementById('btn-start').addEventListener('click', () => {
                        vscode.postMessage({ type: 'startTerminal' });
                    });

                    term.onData(data => {
                        vscode.postMessage({
                            type: 'terminalInput',
                            value: data
                        });
                    });

                    // Handle Context Menu (Right Click)
                    const contextMenu = document.getElementById('context-menu');
                    document.getElementById('terminal-container').addEventListener('contextmenu', e => {
                        e.preventDefault();
                        contextMenu.style.display = 'block';
                        let x = e.clientX;
                        let y = e.clientY;
                        if (x + contextMenu.offsetWidth > window.innerWidth) x = window.innerWidth - contextMenu.offsetWidth;
                        if (y + contextMenu.offsetHeight > window.innerHeight) y = window.innerHeight - contextMenu.offsetHeight;
                        contextMenu.style.left = x + 'px';
                        contextMenu.style.top = y + 'px';
                    });

                    document.addEventListener('click', e => {
                        if (!contextMenu.contains(e.target)) {
                            contextMenu.style.display = 'none';
                        }
                    });

                    document.getElementById('menu-copy').addEventListener('click', () => {
                        const selection = term.getSelection();
                        if (selection) {
                            vscode.postMessage({ type: 'copyText', value: selection });
                        }
                        contextMenu.style.display = 'none';
                    });

                    document.getElementById('menu-paste').addEventListener('click', () => {
                        vscode.postMessage({ type: 'requestPaste' });
                        contextMenu.style.display = 'none';
                    });

                    // Handle Drag and Drop
                    const terminalContainer = document.getElementById('terminal-container');
                    terminalContainer.addEventListener('dragover', e => {
                        e.preventDefault(); // allow drop
                    });

                    terminalContainer.addEventListener('drop', e => {
                        e.preventDefault();
                        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            const paths = [];
                            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                                const file = e.dataTransfer.files[i];
                                if (file.path) {
                                    paths.push('"' + file.path + '"'); // use double quotes for Windows/PS compatibility
                                }
                            }
                            if (paths.length > 0) {
                                vscode.postMessage({ type: 'writeToTerminal', value: paths.join(' ') + ' ' });
                            }
                        } else {
                            const text = e.dataTransfer.getData('text/plain');
                            if (text) {
                                vscode.postMessage({ type: 'writeToTerminal', value: text });
                            }
                        }
                    });

                    // Handle Ctrl+V / Cmd+V to Paste
                    term.attachCustomKeyEventHandler(e => {
                        if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                            vscode.postMessage({ type: 'requestPaste' });
                            return false; // Stop propagation and default behavior
                        }
                        return true;
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'terminalOutput':
                                term.write(message.value);
                                break;
                            case 'terminalClear':
                                term.reset();
                                fitAddon.fit();
                                vscode.postMessage({
                                    type: 'terminalResize',
                                    cols: term.cols,
                                    rows: term.rows
                                });
                                break;
                            case 'terminalStarted':
                                document.getElementById('closed-state').style.display = 'none';
                                document.getElementById('terminal-container').style.display = 'block';
                                fitAddon.fit();
                                vscode.postMessage({
                                    type: 'terminalResize',
                                    cols: term.cols,
                                    rows: term.rows
                                });
                                break;
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
