import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class EmulatorProvider implements vscode.TreeDataProvider<EmulatorItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<EmulatorItem | undefined | void> = new vscode.EventEmitter<EmulatorItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<EmulatorItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor() { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: EmulatorItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: EmulatorItem): Thenable<EmulatorItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return this.getEmulators();
        }
    }

    private getEmulatorPath(): string {
        let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
        if (!androidHome && os.platform() === 'win32') {
            const defaultWinPath = path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
            if (fs.existsSync(defaultWinPath)) {
                androidHome = defaultWinPath;
            }
        }
        
        let emulatorCmd = 'emulator';
        if (androidHome) {
            const potentialPath = path.join(androidHome, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator');
            if (fs.existsSync(potentialPath)) {
                emulatorCmd = potentialPath;
            }
        }
        return emulatorCmd;
    }

    private getEmulators(): Promise<EmulatorItem[]> {
        return new Promise((resolve) => {
            const emulatorCmd = this.getEmulatorPath();
            cp.exec(`"${emulatorCmd}" -list-avds`, (error, stdout, stderr) => {
                if (error) {
                    vscode.window.showErrorMessage(`Failed to list Android Emulators: ${error.message}`);
                    resolve([]);
                    return;
                }

                const emulators = stdout.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map(name => {
                        return new EmulatorItem(
                            name,
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: 'dynoExtension.startEmulator',
                                title: 'Start Emulator',
                                arguments: [name]
                            }
                        );
                    });
                
                if (emulators.length === 0) {
                    const emptyItem = new EmulatorItem('No emulators found', vscode.TreeItemCollapsibleState.None);
                    emptyItem.contextValue = 'emptyItem';
                    emptyItem.iconPath = new vscode.ThemeIcon('info');
                    resolve([emptyItem as any]);
                } else {
                    resolve(emulators);
                }
            });
        });
    }

    public startEmulator(avdName: string) {
        if (!avdName || avdName === 'No emulators found') {
            return;
        }
        vscode.window.showInformationMessage(`Starting Android Emulator: ${avdName}...`);
        
        const emulatorCmd = this.getEmulatorPath();
        
        // Use spawn to start it detached so it survives even if VS Code extension host restarts
        // Added -no-window so it runs hidden (headless), relying entirely on our Sidebar Webview for UI
        const child = cp.spawn(emulatorCmd, ['-avd', avdName, '-no-window'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true // This hides the black terminal window on Windows
        });
        
        child.unref();
    }
}

export class EmulatorItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `Android Emulator: ${this.label}`;
        this.contextValue = 'emulatorItem';
    }

    iconPath = new vscode.ThemeIcon('device-mobile');
}
