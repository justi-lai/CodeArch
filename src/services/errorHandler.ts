/**
 * Copyright 2025 Justin Lai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as vscode from 'vscode';

export class ErrorHandler {
    static async handleError(error: Error, context: string): Promise<void> {
        const errorMessage = error.message || 'Unknown error occurred';
        console.error(`Codex error in ${context}:`, error);

        // Check for specific error types and provide helpful guidance
        if (errorMessage.includes('not a git repository')) {
            await vscode.window.showErrorMessage(
                'CodeScribe: The current file is not in a Git repository. Please open a file that is tracked by Git.',
                'Open Git Repository'
            ).then(selection => {
                if (selection === 'Open Git Repository') {
                    vscode.commands.executeCommand('workbench.action.files.openFolder');
                }
            });
            return;
        }

        if (errorMessage.includes('gh: command not found') || errorMessage.includes('GitHub CLI')) {
            await vscode.window.showErrorMessage(
                'CodeScribe: GitHub CLI (gh) is not installed or not in PATH.',
                'Installation Guide'
            ).then(selection => {
                if (selection === 'Installation Guide') {
                    vscode.env.openExternal(vscode.Uri.parse('https://cli.github.com/'));
                }
            });
            return;
        }

        if (errorMessage.includes('API key') || errorMessage.includes('authentication') || errorMessage.includes('Gemini')) {
            await vscode.window.showErrorMessage(
                'CodeScribe: Gemini API key issue. Please reconfigure your API key.',
                'Configure Gemini API Key'
            ).then(selection => {
                if (selection === 'Configure Gemini API Key') {
                    vscode.commands.executeCommand('codescribe.configureApiKey');
                }
            });
            return;
        }

        if (errorMessage.includes('rate limit')) {
            await vscode.window.showWarningMessage(
                'CodeScribe: API rate limit exceeded. Please wait a moment before trying again, or switch to a different AI provider.',
                'Switch AI Provider', 'Retry in 1 minute'
            ).then(selection => {
                if (selection === 'Switch AI Provider') {
                    vscode.commands.executeCommand('codescribe.selectModel');
                }
            });
            return;
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
            await vscode.window.showErrorMessage(
                'CodeScribe: Network error occurred. Please check your internet connection and try again.',
                'Retry'
            ).then(selection => {
                if (selection === 'Retry') {
                    vscode.commands.executeCommand('codescribe.analyzeSelection');
                }
            });
            return;
        }

        // Generic error handling
        const action = await vscode.window.showErrorMessage(
            `CodeScribe: ${errorMessage}`,
            'View Details',
            'Report Issue'
        );

        if (action === 'View Details') {
            this.showErrorDetails(error, context);
        } else if (action === 'Report Issue') {
            this.openIssueReport(error, context);
        }
    }

    private static async showErrorDetails(error: Error, context: string): Promise<void> {
        const details = `
CodeScribe Error Details
========================

Context: ${context}
Timestamp: ${new Date().toISOString()}
Error Message: ${error.message}
Stack Trace:
${error.stack || 'No stack trace available'}

Environment:
- VS Code Version: ${vscode.version}
- Platform: ${process.platform}
- Node Version: ${process.version}
        `;

        const doc = await vscode.workspace.openTextDocument({
            content: details,
            language: 'plaintext'
        });
        await vscode.window.showTextDocument(doc);
    }

    private static openIssueReport(error: Error, context: string): void {
        const title = encodeURIComponent(`CodeScribe Error: ${error.message.substring(0, 50)}...`);
        const body = encodeURIComponent(`
**Error Context:** ${context}

**Error Message:** ${error.message}

**Steps to Reproduce:**
1. 
2. 
3. 

**Expected Behavior:**
[Describe what you expected to happen]

**Actual Behavior:**
[Describe what actually happened]

**Environment:**
- VS Code Version: ${vscode.version}
- Platform: ${process.platform}
- CodeScribe Version: 1.0.0

**Additional Context:**
[Add any other context about the problem here]
        `);

        const issueUrl = `https://github.com/your-repo/codescribe/issues/new?title=${title}&body=${body}`;
        vscode.env.openExternal(vscode.Uri.parse(issueUrl));
    }
}

export class UserFeedback {
    static async showProgress<T>(
        title: string,
        operation: (
            progress: vscode.Progress<{ increment?: number; message?: string }>,
            token: vscode.CancellationToken
        ) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: true
        }, operation);
    }

    static async showSuccess(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showInformationMessage(`${message}`, ...actions);
    }

    static async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showWarningMessage(`${message}`, ...actions);
    }

    static async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showErrorMessage(`❌ ${message}`, ...actions);
    }

    static async confirmAction(message: string, confirmText: string = 'Confirm'): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            confirmText,
            'Cancel'
        );
        return result === confirmText;
    }

    static async showQuickPick<T extends vscode.QuickPickItem>(
        items: T[],
        options: Partial<vscode.QuickPickOptions> = {}
    ): Promise<T | undefined> {
        return vscode.window.showQuickPick(items, {
            ignoreFocusOut: true,
            ...options
        });
    }

    static createStatusBarItem(text: string, tooltip?: string): vscode.StatusBarItem {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        item.text = text;
        if (tooltip) {
            item.tooltip = tooltip;
        }
        item.show();
        return item;
    }
}