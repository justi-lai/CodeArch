/*
 * Copyright (c) 2026 Justin Lai
 * Licensed under the MIT License.
 */

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
    language: string;
    startLine: number;
    endLine: number;
}

export class GitAnalysis {

    public async performAnalysis(document: vscode.TextDocument, range: vscode.Range): Promise<CommitRecord[]> {

        if (!await this.isInsideGitRepository(document)) {
            throw new Error("File is not inside a Git repository.");
        }

        const repository = await this.getGitRepository(document);
        if (!repository) {
            throw new Error("Could not determine the Git repository root.");
        }

        const start = range.start.line + 1;
        const end = range.end.line + 1;
        const filePath = document.uri.fsPath;
        const relativePath = path.relative(repository, filePath);

        console.log(`Analyzing range ${start}-${end} in ${relativePath}`);

        try {
            const separator = "===COMMIT_RECORD_START===";
            const command = `git log -L ${start},${end}:"${relativePath}" --format="${separator}%H|%an|%ad|%s"`;

            const { stdout } = await execPromise(command, { cwd: repository, maxBuffer: 10 * 1024 * 1024 });

            return this.parseGitLogLOutput(stdout, separator, start, end, document.languageId);
        } catch (error: any) {
            console.error("Git log -L failed:", error);
            throw new Error(`Failed to analyze line history: ${error.message}`);
        }
    }

    private parseGitLogLOutput(output: string, separator: string, startLine: number, endLine: number, languageId: string): CommitRecord[] {
        const records: CommitRecord[] = [];
        const sections = output.split(separator);

        for (const section of sections) {
            if (!section.trim()) {
                continue;
            }

            const lines = section.split('\n');
            const metadataLine = lines[0];
            const [hash, author, date, message] = metadataLine.split('|');

            const diffLines = lines.slice(1);
            const diff = diffLines.join('\n').trim();

            if (hash) {
                records.push({
                    hash,
                    author,
                    date,
                    message,
                    lineRangeDiff: diff,
                    language: languageId,
                    startLine,
                    endLine
                });
            }
        }

        return records;
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
