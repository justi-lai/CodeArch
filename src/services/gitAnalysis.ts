import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface CommitRecord {
    hash: string;
    author: string;
    date: string;
    message: string;
    lineRangeDiff: string;
    startLine: number;
    endLine: number;
}

export class GitAnalysis {

    public async performAnalysis(document: vscode.TextDocument, range: vscode.Range) {

        if (!await this.isInsideGitRepository(document)) {
            throw new Error("File is not inside a Git repository.");
        }

        const repository = await this.getGitRepository(document);
        if (!repository) {
            throw new Error("Could not determine the Git repository root.");
        }

        console.log("Analyzing repository:", repository);

        const blameData = await this.runGitBlame(document, range, repository);

        const commitHashes = new Set<string>();
        const lines = blameData.split('\n');
        for (const line of lines) {
            const parts = line.split(' ');
            if (parts.length >= 4) {
                const hash = parts[0];
                if (/^[0-9a-f]{40}$/i.test(hash) && !/^[0]+$/.test(hash)) {
                    commitHashes.add(hash);
                }
            }
        }

        const analysisResults: CommitRecord[] = [];
        for (const commit of commitHashes) {
            try {
                // 1. Get structured metadata (Hash|Author|Date|Subject)
                const { stdout: metadata } = await execPromise(
                    `git log -1 --format="%H|%an|%ad|%s" ${commit}`,
                    { cwd: repository }
                );

                const [hash, author, date, message] = metadata.trim().split('|');

                // 2. Get the specific line-range diff
                const diff = await this.runGitShow(document, range, repository, commit);

                analysisResults.push({
                    hash,
                    author,
                    date,
                    message,
                    lineRangeDiff: diff,
                    startLine: range.start.line + 1,
                    endLine: range.end.line + 1
                });
            } catch (error) {
                console.error(`Failed to analyze commit ${commit}:`, error);
            }
        }

        return JSON.stringify(analysisResults, null, 2);
    }

    private async runGitShow(document: vscode.TextDocument, range: vscode.Range, repository: string, commit: string): Promise<string> {
        const start = range.start.line + 1;
        const end = range.end.line + 1;
        const filePath = document.uri.fsPath;
        const repoRoot = repository;

        const relativePath = path.relative(repoRoot, filePath);

        try {
            // Using --pretty=format:"" hides the commit, author, and date headers
            const command = `git show ${commit} --pretty=format:"" -L ${start},${end}:"${relativePath}"`;
            const { stdout } = await execPromise(command, { cwd: repoRoot });
            return stdout.trim();
        } catch (error) {
            console.error("Git show failed:", error);
            throw new Error("Failed to run git show.");
        }
    }

    private async runGitBlame(document: vscode.TextDocument, range: vscode.Range, repository: string): Promise<string> {
        const start = range.start.line + 1;
        const end = range.end.line + 1;
        const filePath = document.uri.fsPath;
        const cwd = repository;

        try {
            const { stdout } = await execPromise(`git blame -L ${start},${end} --porcelain "${filePath}"`, { cwd });
            return stdout;
        } catch (error) {
            console.error("Git blame failed:", error);
            throw new Error("Failed to run git blame.");
        }
    }

    private async isInsideGitRepository(document: vscode.TextDocument): Promise<boolean> {
        const dir = path.dirname(document.uri.fsPath);
        try {
            const { stdout } = await execPromise('git rev-parse --is-inside-work-tree', { cwd: dir });
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    private async getGitRepository(document: vscode.TextDocument): Promise<string | null> {
        const dir = path.dirname(document.uri.fsPath);
        try {
            const { stdout } = await execPromise('git rev-parse --show-toplevel', { cwd: dir });
            return stdout.trim();
        } catch {
            return null;
        }
    }
}
