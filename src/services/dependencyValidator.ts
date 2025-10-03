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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DependencyValidator {
    async validateDependencies(): Promise<boolean> {
        const gitValid = await this.checkGit();
        const ghValid = await this.checkGitHubCLI();

        if (!gitValid || !ghValid) {
            await this.showDependencyErrorMessage(gitValid, ghValid);
            return false;
        }

        return true;
    }

    private async checkGit(): Promise<boolean> {
        try {
            await execAsync('git --version');
            return true;
        } catch (error) {
            return false;
        }
    }

    private async checkGitHubCLI(): Promise<boolean> {
        try {
            await execAsync('gh --version');
            
            // Also check if user is authenticated
            try {
                await execAsync('gh auth status');
                return true;
            } catch (authError) {
                await vscode.window.showWarningMessage(
                    'GitHub CLI is installed but not authenticated. Please run "gh auth login" in your terminal.',
                    'Open Terminal'
                ).then(selection => {
                    if (selection === 'Open Terminal') {
                        vscode.window.createTerminal().show();
                    }
                });
                return false;
            }
        } catch (error) {
            return false;
        }
    }

    private async showDependencyErrorMessage(gitValid: boolean, ghValid: boolean): Promise<void> {
        const missingDeps = [];
        if (!gitValid) {
            missingDeps.push('git');
        }
        if (!ghValid) {
            missingDeps.push('GitHub CLI (gh)');
        }

        const message = `CodeScribe requires the following dependencies to be installed and available in your PATH: ${missingDeps.join(', ')}.`;
        
        const action = await vscode.window.showErrorMessage(
            message,
            'Installation Instructions'
        );

        if (action === 'Installation Instructions') {
            await this.showInstallationInstructions(missingDeps);
        }
    }

    private async showInstallationInstructions(missingDeps: string[]): Promise<void> {
        let instructions = 'Installation Instructions:\n\n';

        if (missingDeps.includes('git')) {
            instructions += '**Git:**\n';
            instructions += '- Windows: Download from https://git-scm.com/download/win\n';
            instructions += '- macOS: Install via Homebrew: `brew install git` or download from https://git-scm.com/download/mac\n';
            instructions += '- Linux: Install via package manager: `sudo apt install git` (Ubuntu/Debian) or `sudo yum install git` (RHEL/CentOS)\n\n';
        }

        if (missingDeps.includes('GitHub CLI (gh)')) {
            instructions += '**GitHub CLI:**\n';
            instructions += '- Windows: Download from https://cli.github.com/ or use winget: `winget install GitHub.cli`\n';
            instructions += '- macOS: Install via Homebrew: `brew install gh`\n';
            instructions += '- Linux: Follow instructions at https://github.com/cli/cli/blob/trunk/docs/install_linux.md\n\n';
            instructions += 'After installation, authenticate with: `gh auth login`\n';
        }

        const doc = await vscode.workspace.openTextDocument({
            content: instructions,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }
}