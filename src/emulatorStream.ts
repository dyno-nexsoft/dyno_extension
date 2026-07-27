import * as vscode from 'vscode';

export class EmulatorStreamProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dyno.emulatorStream';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();
        
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'refresh') {
                webviewView.webview.html = this._getHtmlForWebview();
            } else if (data.type === 'start-server') {
                // Save the path to settings
                await vscode.workspace.getConfiguration('dyno').update('wsScrcpyPath', data.path, vscode.ConfigurationTarget.Global);
                
                // Open a terminal and start the server
                const terminal = vscode.window.createTerminal({
                    name: 'ws-scrcpy Server',
                    cwd: data.path
                });
                terminal.show();
                terminal.sendText('npm start');
                
                vscode.window.showInformationMessage('Starting ws-scrcpy server... Please wait a few seconds then click Reload Stream.');
            }
        });
    }

    private _getHtmlForWebview() {
        const savedPath = vscode.workspace.getConfiguration('dyno').get('wsScrcpyPath', '');
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Emulator Stream</title>
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-font-family);
                }
                iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                }
                .error-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    padding: 20px;
                    box-sizing: border-box;
                    overflow-y: auto;
                }
                .setup-box {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 5px;
                    margin: 15px 0;
                    text-align: left;
                    font-size: 13px;
                    width: 100%;
                    max-width: 400px;
                }
                code {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: monospace;
                }
                input {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 8px;
                    width: calc(100% - 18px);
                    margin-bottom: 10px;
                    border-radius: 2px;
                }
                .button-group {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 15px;
                    cursor: pointer;
                    border-radius: 2px;
                    font-weight: bold;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .btn-secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
            </style>
        </head>
        <body>
            <div id="loader" class="error-container">
                <h3 id="status-title">Connecting to ws-scrcpy...</h3>
                
                <div id="setup-panel" style="display: none; width: 100%; align-items: center; flex-direction: column;">
                    <div class="setup-box">
                        <b>Setup Instructions:</b><br><br>
                        1. Download <code>ws-scrcpy</code> if you haven't.<br>
                        2. Enter the path to the folder below.<br>
                        3. Click <b>Start Server</b>.<br>
                        <br>
                        <input type="text" id="path-input" placeholder="e.g. E:\\Projects\\ws-scrcpy" value="${savedPath}" />
                    </div>
                    
                    <div class="button-group">
                        <button onclick="startServer()">Start Server</button>
                        <button class="btn-secondary" onclick="checkServer()">Retry Connection</button>
                    </div>
                </div>
            </div>
            
            <iframe id="streamFrame" src="http://127.0.0.1:8000/" style="display: none;"></iframe>

            <script>
                const vscode = acquireVsCodeApi();
                const iframe = document.getElementById('streamFrame');
                const loader = document.getElementById('loader');
                const setupPanel = document.getElementById('setup-panel');
                const statusTitle = document.getElementById('status-title');
                
                function hideLoader() {
                    loader.style.display = 'none';
                    iframe.style.display = 'block';
                }
                
                function showError() {
                    loader.style.display = 'flex';
                    setupPanel.style.display = 'flex';
                    statusTitle.innerText = "Server is not running";
                    iframe.style.display = 'none';
                }

                function checkServer() {
                    loader.style.display = 'flex';
                    setupPanel.style.display = 'none';
                    statusTitle.innerText = "Connecting to ws-scrcpy...";
                    iframe.style.display = 'none';
                    
                    fetch('http://127.0.0.1:8000/', { mode: 'no-cors' })
                        .then(() => {
                            // If fetch succeeds (even opaque response), server is up
                            hideLoader();
                            iframe.src = 'http://127.0.0.1:8000/';
                        })
                        .catch(() => {
                            // Network error means server is down
                            showError();
                        });
                }
                
                function startServer() {
                    const path = document.getElementById('path-input').value;
                    if (!path) {
                        alert('Please enter the path to ws-scrcpy');
                        return;
                    }
                    vscode.postMessage({
                        type: 'start-server',
                        path: path
                    });
                    
                    // Automatically retry checking server after 3 seconds
                    setTimeout(checkServer, 3000);
                }
                
                // Initial check
                checkServer();
            </script>
        </body>
        </html>`;
    }
}
