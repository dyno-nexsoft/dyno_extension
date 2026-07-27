import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const _output = vscode.window.createOutputChannel('Dyno Extension');

function getEmulatorPath(): string {
    let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!androidHome && os.platform() === 'win32') {
        const defaultWinPath = path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
        if (fs.existsSync(defaultWinPath)) androidHome = defaultWinPath;
    }
    let emulatorCmd = 'emulator';
    if (androidHome) {
        const potentialPath = path.join(androidHome, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator');
        if (fs.existsSync(potentialPath)) emulatorCmd = potentialPath;
    }
    return emulatorCmd;
}

function listAvds(): Promise<string[]> {
    return new Promise((resolve) => {
        const cmd = getEmulatorPath();
        cp.exec(`"${cmd}" -list-avds`, (error, stdout) => {
            if (error) { resolve([]); return; }
            resolve(stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0));
        });
    });
}

export class EmulatorStreamProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dyno.emulatorStream';
    private _view?: vscode.WebviewView;
    private _serverProcess?: cp.ChildProcess;
    private _healthCheckTimer?: NodeJS.Timeout;
    private _disposed = false;

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        this._disposed = false;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview.cspSource);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh':
                    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview.cspSource);
                    break;
                case 'start-server':
                    await vscode.workspace.getConfiguration('dyno').update('wsScrcpyPath', data.path, vscode.ConfigurationTarget.Global);
                    this._startServer(data.path as string);
                    break;
                case 'list-emulators':
                    const avds = await listAvds();
                    webviewView.webview.postMessage({ type: 'emulator-list', avds });
                    break;
                case 'start-emulator':
                    this._startEmulator(data.name as string);
                    break;
            }
        });

        webviewView.onDidDispose(() => {
            this._disposed = true;
            this._stopHealthCheck();
        });
    }

    // ---- Server management ----

    private _slog(message: string) {
        _output.appendLine(message);
    }

    private _startServer(cwd: string) {
        this._killServer();
        _output.show(true);
        this._post('server-status', { status: 'starting', message: 'Starting server...' });
        this._slog(`Starting ws-scrcpy server in ${cwd}...`);

        const isWin = process.platform === 'win32';
        this._serverProcess = cp.spawn(isWin ? 'cmd.exe' : 'npm', isWin ? ['/c', 'npm', 'start'] : ['start'], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env }
        });

        this._serverProcess.stdout?.on('data', (d: Buffer) => {
            const t = d.toString().replace(/\r?\n$/, '');
            if (t) this._slog(t);
        });
        this._serverProcess.stderr?.on('data', (d: Buffer) => {
            const t = d.toString().replace(/\r?\n$/, '');
            if (t) this._slog(`[err] ${t}`);
        });
        this._serverProcess.on('error', (err) => {
            this._slog(`[error] ${err.message}`);
            this._post('server-status', { status: 'error', message: err.message });
        });
        this._serverProcess.on('exit', (code) => {
            this._slog(`Server process exited with code ${code}`);
            this._serverProcess = undefined;
        });

        this._startHealthCheck(0);
    }

    private _startHealthCheck(attempt: number) {
        if (this._disposed || !this._serverProcess) return;
        const delays = [1, 2, 3, 5, 8, 13, 21];
        const delay = delays[Math.min(attempt, delays.length - 1)];
        this._healthCheckTimer = setTimeout(() => {
            if (this._disposed) return;
            this._checkServer(attempt);
        }, delay * 1000);
    }

    private _checkServer(attempt: number) {
        this._post('server-status', { status: 'connecting', message: `Checking server (attempt ${attempt + 1})...` });
        const req = http.get('http://127.0.0.1:8000/', (res) => {
            res.resume();
            this._slog('Server is ready!');
            this._stopHealthCheck();
            this._post('server-ready', {});
        });
        req.on('error', () => {
            if (attempt < 6) this._startHealthCheck(attempt + 1);
            else {
                this._slog('Server did not start within the expected time.');
                this._post('server-status', { status: 'timeout', message: 'Server not ready. Check logs below.' });
            }
        });
        req.end();
    }

    private _killServer() {
        this._stopHealthCheck();
        if (this._serverProcess) { try { this._serverProcess.kill(); } catch { /* */ } this._serverProcess = undefined; }
    }

    private _stopHealthCheck() {
        if (this._healthCheckTimer) { clearTimeout(this._healthCheckTimer); this._healthCheckTimer = undefined; }
    }

    // ---- Emulator management ----

    private _adbDevices(): Promise<string[]> {
        return new Promise((resolve) => {
            cp.exec('adb devices', (err, stdout) => {
                if (err) { resolve([]); return; }
                const lines = stdout.split('\n').slice(1).filter(l => l.includes('device') && !l.includes('offline'));
                resolve(lines.map(l => l.split('\t')[0].trim()).filter(Boolean));
            });
        });
    }

    private _startEmulator(name: string) {
        _output.show(true);

        // Check if an emulator is already running via ADB
        this._adbDevices().then((devices) => {
            if (devices.length > 0) {
                _output.appendLine(`Emulator already running (${devices[0]}), skipping launch.`);
                this._post('emulator-started', { name });
                return;
            }

            _output.appendLine(`[${new Date().toLocaleTimeString()}] Starting Android Emulator: ${name}...`);

            const cmd = getEmulatorPath();
            _output.appendLine(`Command: ${cmd} -avd ${name} -no-window`);

            const child = cp.spawn(cmd, ['-avd', name, '-no-window'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });
            child.unref();

            let exited = false;

            child.stdout?.on('data', (d: Buffer) => {
                const t = d.toString().replace(/\r?\n$/, '');
                if (t) _output.appendLine(t);
            });
            child.stderr?.on('data', (d: Buffer) => {
                const t = d.toString().replace(/\r?\n$/, '');
                if (t) _output.appendLine(`[err] ${t}`);
            });
            child.on('error', (err) => {
                exited = true;
                _output.appendLine(`[error] ${err.message}`);
                this._post('emulator-error', { name, message: err.message });
            });
            child.on('exit', (code) => {
                _output.appendLine(`Emulator process exited with code ${code}`);
                if (code !== 0 && !exited) {
                    exited = true;
                    this._post('emulator-error', { name, message: `Exited with code ${code}` });
                }
            });

            // Wait 3s to confirm emulator didn't crash immediately
            setTimeout(() => {
                if (!exited) this._post('emulator-started', { name });
            }, 3000);
        });
    }

    private _post(type: string, payload: Record<string, unknown>) {
        this._view?.webview.postMessage({ type, ...payload });
    }

    // ---- HTML ----

    private _getHtmlForWebview(cspSource = "'none'") {
        const savedPath = vscode.workspace.getConfiguration('dyno').get('wsScrcpyPath', '');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline'; frame-src http://127.0.0.1:8000; img-src ${cspSource} https:; font-src ${cspSource}">
<style>
:root{color-scheme:light dark}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:12px;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
h3{margin:0 0 8px;font-size:14px;font-weight:600}
.phase{display:none;flex-direction:column;height:100%}
.phase.active{display:flex}
.card{background:var(--vscode-editor-inactiveSelectionBackground);border-radius:6px;padding:12px;margin-bottom:12px}
input,select{width:100%;padding:6px 8px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:3px;font-family:inherit;font-size:13px;margin-bottom:8px}
.btn-group{display:flex;gap:8px;flex-wrap:wrap}
button{padding:6px 14px;border:none;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
button:disabled{opacity:.5;cursor:default}

.status{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-bottom:8px}
.status .dot{width:8px;height:8px;border-radius:50%;flex:none}
.st-starting{background:rgba(55,148,255,.18);color:#3794ff}.st-starting .dot{background:#3794ff;animation:pulse 1s infinite}
.st-connecting{background:rgba(163,113,247,.18);color:#a371f7}.st-connecting .dot{background:#a371f7;animation:pulse 1.2s infinite}
.st-ready{background:rgba(63,185,80,.18);color:#3fb950}.st-ready .dot{background:#3fb950}
.st-error,.st-timeout{background:rgba(248,81,73,.18);color:#f85149}.st-error .dot,.st-timeout .dot{background:#f85149}
.st-stopped{background:rgba(139,148,158,.2);color:#8b949e}.st-stopped .dot{background:#8b949e}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
iframe{width:100%;flex:1;border:none;border-radius:4px;min-height:0}
.step-indicator{display:flex;gap:4px;margin-bottom:12px}
.step{flex:1;height:3px;border-radius:2px;background:var(--vscode-panel-border)}
.step.done{background:var(--vscode-charts-green,#3fb950)}
.step.active{background:var(--vscode-charts-blue,#3794ff);animation:stepPulse 1.5s infinite}
@keyframes stepPulse{0%,100%{opacity:1}50%{opacity:.5}}
.emu-item{padding:8px 10px;border-radius:4px;cursor:pointer;display:flex;align-items:center;gap:8px;margin-bottom:4px;border:1px solid transparent}
.emu-item:hover{background:var(--vscode-list-hoverBackground);border-color:var(--vscode-panel-border)}
.emu-item .name{flex:1;font-weight:500}
.emu-item .icon{flex:none;font-size:16px}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:3px}
</style>
</head>
<body>

<div class="step-indicator">
  <div class="step" id="step1"></div>
  <div class="step" id="step2"></div>
  <div class="step" id="step3"></div>
</div>

<!-- Phase 1: Server Setup -->
<div class="phase active" id="phase-setup">
  <div class="card">
    <h3>ws-scrcpy Server</h3>
    <input type="text" id="path-input" placeholder="e.g. E:\\Projects\\ws-scrcpy" value="${savedPath}" />
    <div class="btn-group">
      <button class="btn-primary" id="btn-start-server">Start Server</button>
    </div>
  </div>
  <div id="server-status-area"></div>
</div>

<!-- Phase 2: Emulator -->
<div class="phase" id="phase-emulator">
  <div class="card">
    <h3>Android Emulator</h3>
    <p class="status st-ready" style="margin-bottom:12px"><span class="dot"></span>Server is running</p>
    <div id="emu-list"></div>
    <div id="emu-status-area"></div>
    <div class="btn-group" style="margin-top:8px">
      <button class="btn-secondary" id="btn-skip-emu">Skip → Stream</button>
    </div>
  </div>

</div>

<!-- Phase 3: Stream -->
<div class="phase" id="phase-stream">
  <div style="display:flex;gap:6px;padding:6px 0;flex-wrap:wrap;flex:none">
    <button class="btn-secondary" id="btn-back-server" style="font-size:12px">← Back to Emulator</button>
    <button class="btn-secondary" id="btn-reload-stream" style="font-size:12px">⟳ Reload</button>
    <span style="flex:1"></span>
    <span id="stream-status" class="muted" style="font-size:12px;color:var(--vscode-descriptionForeground);align-self:center"></span>
  </div>
  <iframe id="streamFrame" allow="clipboard-read; clipboard-write; camera; microphone"></iframe>
</div>

<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const phases = ['phase-setup', 'phase-emulator', 'phase-stream'];

function showPhase(id) {
  phases.forEach(p => $(p).classList.toggle('active', p === id));
}

function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const el = $('step' + i);
    el.classList.remove('done', 'active');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
}

function showStatus(areaId, kind, text) {
  const area = $(areaId);
  area.innerHTML = '<div class="status st-' + kind + '"><span class="dot"></span>' + text + '</div>';
}

setStep(1);

// ---- Server ----
$('btn-start-server').addEventListener('click', () => {
  const p = $('path-input').value.trim();
  if (!p) { alert('Please enter the path to ws-scrcpy'); return; }
  $('btn-start-server').disabled = true;
  $('btn-start-server').textContent = 'Starting...';
  showStatus('server-status-area', 'starting', 'Starting server...');
  setStep(1);
  vscode.postMessage({ type: 'start-server', path: p });
});

// ---- Emulator ----
function loadEmulators() {
  vscode.postMessage({ type: 'list-emulators' });
}

// ---- Skip emulator ----
$('btn-skip-emu').addEventListener('click', goToStream);

// ---- Stream controls ----
$('btn-reload-stream').addEventListener('click', () => {
  $('streamFrame').src = '';
  setTimeout(() => { $('streamFrame').src = 'http://127.0.0.1:8000/'; }, 100);
});
$('btn-back-server').addEventListener('click', () => {
  setStep(2);
  showPhase('phase-emulator');
  loadEmulators();
});

function goToStream() {
  setStep(3);
  showPhase('phase-stream');
  $('streamFrame').src = 'http://127.0.0.1:8000/';
}

// ---- Messages from extension ----
window.addEventListener('message', (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'server-status':
      showStatus('server-status-area', msg.status, msg.message);
      break;
    case 'server-ready':
      $('btn-start-server').textContent = 'Start Server';
      setStep(2);
      showPhase('phase-emulator');
      loadEmulators();
      break;
    case 'emulator-list': {
      const list = $('emu-list');
      list.innerHTML = '';
      if (!msg.avds || msg.avds.length === 0) {
        list.innerHTML = '<div class="muted" style="color:var(--vscode-descriptionForeground);padding:8px">No AVDs found. Create one with "avdmanager" first.</div>';
        return;
      }
      msg.avds.forEach(name => {
        const div = document.createElement('div');
        div.className = 'emu-item';
        div.innerHTML = '<span class="icon">📱</span><span class="name">' + name + '</span><button class="btn-primary" style="padding:4px 12px;font-size:12px">Start</button>';
        div.querySelector('button').addEventListener('click', () => {
          div.querySelector('button').disabled = true;
          div.querySelector('button').textContent = 'Starting...';
          showStatus('emu-status-area', 'starting', 'Starting ' + name + '...');
          setStep(2);
          vscode.postMessage({ type: 'start-emulator', name });
        });
        list.appendChild(div);
      });
      break;
    }
    case 'emulator-started':
      showStatus('emu-status-area', 'ready', 'Emulator "' + msg.name + '" started');
      goToStream();
      break;
    case 'emulator-error':
      showStatus('emu-status-area', 'error', 'Emulator "' + msg.name + '" failed: ' + msg.message);
      // Re-enable all emulator buttons
      document.querySelectorAll('#emu-list button').forEach(b => { b.disabled = false; b.textContent = 'Start'; });
      setStep(2);
      break;
  }
});
</script>
</body>
</html>`;
    }
}
