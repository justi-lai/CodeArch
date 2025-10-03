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

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { CommitInfo, PullRequestInfo, GitAnalysisResult, TimelineItem, PullRequestComment, LinkedIssue } from '../types';

const execAsync = promisify(exec);

export class GitAnalysisEngine {
    async analyzeSelection(filePath: string, startLine: number, endLine: number): Promise<GitAnalysisResult> {
        try {
            // Find the git root starting from the file's directory
            const gitRoot = await this.findGitRoot(filePath);
            if (!gitRoot) {
                throw new Error(`Not a git repository. The file "${filePath}" is not in a git repository.`);
            }
            
            // Get relative path from git root
            const relativePath = await this.getRelativePathFromGitRoot(filePath, gitRoot);
            
            // Pre-flight check: verify file is tracked by git
            try {
                await execAsync(`git ls-files --error-unmatch "${relativePath}"`, { cwd: gitRoot });
            } catch (error) {
                // File is not tracked by git
                const fs = require('fs');
                if (fs.existsSync(filePath)) {
                    throw new Error(`File "${relativePath}" is not tracked by git. Please add it with:\n  git add "${relativePath}"\n  git commit -m "Add ${relativePath}"`);
                } else {
                    throw new Error(`File "${relativePath}" does not exist.`);
                }
            }
            
            // Run git blame to get commit information AND track line evolution
            const blameOutput = await this.runGitBlame(relativePath, startLine, endLine, gitRoot);
            
            // Parse blame output to get unique commits with line tracking info
            const lineCommitMap = this.parseBlameWithLineTracking(blameOutput, startLine);
            const commits = Array.from(new Set(Object.values(lineCommitMap)));
            
            // Get full commit information with evolution-based diffs
            const commitInfos = await this.getCommitDetailsWithLineTracking(
                commits, 
                gitRoot, 
                relativePath, 
                lineCommitMap,
                startLine,
                endLine
            );
            
            // Find associated pull requests
            const pullRequests = await this.findPullRequests(commits, gitRoot);
            
            // Create timeline
            const timeline = this.createTimeline(commitInfos, pullRequests);
            
            return {
                commits: commitInfos,
                pullRequests,
                timeline
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Git analysis failed: ${errorMessage}`);
        }
    }

    private parseBlameWithLineTracking(blameOutput: string, startLine: number): {[lineNumber: number]: string} {
        const lines = blameOutput.split('\n');
        const lineCommitMap: {[lineNumber: number]: string} = {};
        let currentLineNumber = startLine;
        
        for (const line of lines) {
            // Look for commit hash lines (40 character hex strings at start of line)
            const match = line.match(/^([a-f0-9]{40})/);
            if (match) {
                lineCommitMap[currentLineNumber] = match[1];
                currentLineNumber++;
            }
        }
        
        return lineCommitMap;
    }

    private async getCommitDetailsWithLineTracking(
        commits: string[], 
        workingDir: string, 
        filePath: string,
        lineCommitMap: {[lineNumber: number]: string},
        startLine: number,
        endLine: number
    ): Promise<CommitInfo[]> {
        const commitInfos: CommitInfo[] = [];
        
        for (const commitHash of commits) {
            try {
                const { stdout } = await execAsync(
                    `git show --format="%H|%an|%ad|%s" --no-patch "${commitHash}"`,
                    { cwd: workingDir }
                );
                
                const parts = stdout.trim().split('|');
                if (parts.length >= 4) {
                    // Get evolution-based diff that tracks the specific lines
                    const diff = await this.getLineEvolutionDiff(
                        commitHash, 
                        filePath, 
                        workingDir, 
                        lineCommitMap,
                        startLine,
                        endLine
                    );
                    
                    commitInfos.push({
                        hash: parts[0],
                        author: parts[1],
                        date: parts[2],
                        message: parts.slice(3).join('|'),
                        diff: diff,
                        filename: filePath.split('/').pop() || filePath
                    });
                }
            } catch (error) {
                console.error(`Failed to get details for commit ${commitHash}:`, error);
            }
        }
        
        return commitInfos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    private async getLineEvolutionDiff(
        commitHash: string, 
        filePath: string, 
        workingDir: string,
        lineCommitMap: {[lineNumber: number]: string},
        startLine: number,
        endLine: number
    ): Promise<string> {
        try {
            // Only show diff if this commit actually modified our tracked lines
            const affectedLines = Object.keys(lineCommitMap)
                .map(Number)
                .filter(lineNum => lineCommitMap[lineNum] === commitHash);
                
            if (affectedLines.length === 0) {
                return `# This commit did not modify the selected lines (${startLine}-${endLine})`;
            }
            
            // Get the full diff for this commit
            // First try the current file path
            let gitCommand = `git show ${commitHash} --format="" -- "${filePath}"`;
            
            let { stdout: fullDiff } = await execAsync(
                gitCommand,
                { cwd: workingDir }
            );
            
            // If no diff found, the file might have been at a different path in this commit
            if (!fullDiff.trim()) {
                // Get the list of files modified in this commit
                const { stdout: modifiedFiles } = await execAsync(
                    `git show ${commitHash} --name-only --format=""`,
                    { cwd: workingDir }
                );
                
                // Look for a file with the same name but different path
                const fileName = filePath.split('/').pop(); // Get just the filename
                const possiblePaths = modifiedFiles.trim().split('\n').filter(f => f.endsWith(fileName || ''));
                
                // Try each possible path
                for (const possiblePath of possiblePaths) {
                    if (possiblePath && possiblePath !== filePath) {
                        gitCommand = `git show ${commitHash} --format="" -- "${possiblePath}"`;
                        const result = await execAsync(gitCommand, { cwd: workingDir });
                        if (result.stdout.trim()) {
                            fullDiff = result.stdout;
                            break;
                        }
                    }
                }
            }
            
            if (!fullDiff.trim()) {
                const debugMsg = `# No changes found for ${filePath} in this commit\n# Affected lines: ${affectedLines.join(', ')}\n# Git command: ${gitCommand}\n# Working dir: ${workingDir}`;
                return debugMsg;
            }
            
            // For debugging, let's show more information about what we're filtering
            const relevantHunks = this.extractHunksForTrackedLines(
                fullDiff, 
                affectedLines, 
                startLine, 
                endLine
            );
            
            if (relevantHunks.length === 0) {
                // Show the full diff for debugging if no relevant hunks found
                const debugInfo = `# DEBUG: No relevant hunks found for lines ${startLine}-${endLine}\n` +
                                `# This commit modified lines: ${affectedLines.join(', ')}\n` +
                                `# Full diff for analysis:\n\n${fullDiff}`;
                return debugInfo;
            }
            
            return relevantHunks.join('\n\n');
            
        } catch (error) {
            return `# Error retrieving line evolution diff: ${error}\n# Commit: ${commitHash}\n# File: ${filePath}`;
        }
    }

    private extractHunksForTrackedLines(
        diffOutput: string, 
        affectedLines: number[], 
        originalStartLine: number, 
        originalEndLine: number
    ): string[] {
        const lines = diffOutput.split('\n');
        const relevantHunks: string[] = [];
        let currentHunk: string[] = [];
        let hunkHeader = '';
        let currentNewLineNum = 0;
        let inRelevantHunk = false;
        let debugInfo: string[] = [];
        
        for (const line of lines) {
            if (line.startsWith('@@')) {
                // Save previous hunk if it was relevant
                if (inRelevantHunk && currentHunk.length > 0) {
                    relevantHunks.push([hunkHeader, ...currentHunk].join('\n'));
                }
                
                // Parse new hunk
                const match = line.match(/@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
                if (match) {
                    const newStart = parseInt(match[3]);
                    const newCount = parseInt(match[4]) || 1;
                    
                    currentNewLineNum = newStart;
                    hunkHeader = line;
                    currentHunk = [];
                    
                    // Check if this hunk overlaps with our affected lines
                    const hunkStartLine = newStart;
                    const hunkEndLine = newStart + newCount - 1;
                    
                    // More permissive overlap check - include if there's any intersection
                    const hasIntersection = !(hunkEndLine < originalStartLine || hunkStartLine > originalEndLine);
                    
                    // Also check if any of the specifically affected lines fall in this range
                    const hasAffectedLine = affectedLines.some(lineNum => 
                        lineNum >= hunkStartLine && lineNum <= hunkEndLine
                    );
                    
                    inRelevantHunk = hasIntersection || hasAffectedLine;
                    
                    debugInfo.push(`Hunk: lines ${hunkStartLine}-${hunkEndLine}, relevant: ${inRelevantHunk}, ` +
                                 `intersection: ${hasIntersection}, affectedLine: ${hasAffectedLine}`);
                }
            } else if (inRelevantHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
                currentHunk.push(line);
                
                // Update line number tracking
                if (line.startsWith('+') || line.startsWith(' ')) {
                    currentNewLineNum++;
                }
            } else if (line.startsWith('diff --git') || line.startsWith('index') || 
                      line.startsWith('---') || line.startsWith('+++')) {
                continue;
            }
        }
        
        // Don't forget the last hunk
        if (inRelevantHunk && currentHunk.length > 0) {
            relevantHunks.push([hunkHeader, ...currentHunk].join('\n'));
        }
        
        // If no relevant hunks found, include debug information
        if (relevantHunks.length === 0) {
            relevantHunks.push(`# DEBUG: Hunk analysis for lines ${originalStartLine}-${originalEndLine}:\n` +
                             `# Affected lines: ${affectedLines.join(', ')}\n` +
                             `# ${debugInfo.join('\n# ')}\n\n` +
                             `# Full diff:\n${diffOutput}`);
        }
        
        return relevantHunks;
    }

    private async findGitRoot(filePath: string): Promise<string | null> {
        // Start from the file's directory and walk up to find git root
        let currentDir = path.dirname(filePath);
        
        while (currentDir !== '/' && currentDir !== '' && currentDir !== '.') {
            try {
                await execAsync('git rev-parse --git-dir', { cwd: currentDir });
                // Found git repository, get the root
                const { stdout: gitRoot } = await execAsync('git rev-parse --show-toplevel', { cwd: currentDir });
                return gitRoot.trim();
            } catch (error) {
                // Not a git repo, try parent directory
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) {
                    // Reached filesystem root
                    break;
                }
                currentDir = parentDir;
            }
        }
        
        return null;
    }

    private getWorkingDirectory(filePath: string): string {
        // Extract directory from file path
        const lastSlash = filePath.lastIndexOf('/');
        const lastBackslash = filePath.lastIndexOf('\\');
        const separatorIndex = Math.max(lastSlash, lastBackslash);
        
        if (separatorIndex === -1) {
            return '.';
        }
        
        return filePath.substring(0, separatorIndex);
    }

    private async getRelativePathFromGitRoot(filePath: string, gitRoot: string): Promise<string> {
        // Normalize paths (handle Windows/Unix differences)
        const normalizedFilePath = path.resolve(filePath);
        const normalizedGitRoot = path.resolve(gitRoot);
        
        // Make path relative to git root
        const relativePath = path.relative(normalizedGitRoot, normalizedFilePath).replace(/\\/g, '/');
        
        return relativePath;
    }

    private async runGitBlame(relativePath: string, startLine: number, endLine: number, workingDir: string): Promise<string> {
        try {
            const command = `git blame -L ${startLine},${endLine} --porcelain "${relativePath}"`;
            const { stdout } = await execAsync(command, { cwd: workingDir });
            return stdout;
        } catch (error) {
            // If git blame fails, try to provide a more helpful error message
            if (error instanceof Error && error.message.includes('no such path')) {
                // Check if file exists but is not tracked
                try {
                    const fs = require('fs');
                    const fullPath = path.join(workingDir, relativePath);
                    if (fs.existsSync(fullPath)) {
                        // File exists but not tracked by git
                        throw new Error(`File "${relativePath}" exists but is not tracked by git. Please add it with 'git add "${relativePath}"' and commit it.`);
                    }
                } catch (fsError) {
                    // Ignore filesystem errors
                }
                
                // Try to find similar files
                const fileName = relativePath.split('/').pop();
                try {
                    const { stdout: similarFiles } = await execAsync(`git ls-files | grep "${fileName}"`, { cwd: workingDir });
                    const matches = similarFiles.trim().split('\n').filter(f => f.trim());
                    if (matches.length > 0) {
                        throw new Error(`File "${relativePath}" not found in git. Did you mean one of these tracked files?\n${matches.slice(0, 3).join('\n')}`);
                    }
                } catch (grepError) {
                    // No similar files found
                }
                throw new Error(`File "${relativePath}" not found in git repository. Make sure the file is tracked by git and committed.`);
            }
            throw error;
        }
    }

    private parseBlameOutput(blameOutput: string): string[] {
        const lines = blameOutput.split('\n');
        const commits = new Set<string>();
        
        for (const line of lines) {
            // Look for commit hash lines (40 character hex strings at start of line)
            const match = line.match(/^([a-f0-9]{40})/);
            if (match) {
                commits.add(match[1]);
            }
        }
        
        return Array.from(commits);
    }

    private async getCommitDetails(commits: string[], workingDir: string, filePath: string): Promise<CommitInfo[]> {
        const commitInfos: CommitInfo[] = [];
        
        for (const commitHash of commits) {
            try {
                const { stdout } = await execAsync(
                    `git show --format="%H|%an|%ad|%s" --no-patch "${commitHash}"`,
                    { cwd: workingDir }
                );
                
                const parts = stdout.trim().split('|');
                if (parts.length >= 4) {
                    // Get targeted diff for this commit based on line evolution
                    const diff = await this.getEvolutionBasedDiff(commitHash, filePath, workingDir);
                    
                    commitInfos.push({
                        hash: parts[0],
                        author: parts[1],
                        date: parts[2],
                        message: parts.slice(3).join('|'), // In case message contains |
                        diff: diff,
                        filename: filePath.split('/').pop() || filePath
                    });
                }
            } catch (error) {
                console.error(`Failed to get details for commit ${commitHash}:`, error);
            }
        }
        
        return commitInfos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    private async getEvolutionBasedDiff(commitHash: string, filePath: string, workingDir: string): Promise<string> {
        try {
            // Get the line ranges that were actually modified in this commit
            const { stdout: rawDiff } = await execAsync(
                `git show ${commitHash} --format="" -- "${filePath}"`,
                { cwd: workingDir }
            );
            
            if (!rawDiff.trim()) {
                return `# No changes found for ${filePath} in this commit`;
            }
            
            // Parse the diff to find which line ranges were actually changed
            const relevantHunks = this.extractRelevantHunks(rawDiff, commitHash);
            
            if (relevantHunks.length === 0) {
                return `# No relevant changes found in this commit`;
            }
            
            return relevantHunks.join('\n');
            
        } catch (error) {
            return `# Error retrieving evolution-based diff: ${error}`;
        }
    }

    private extractRelevantHunks(diffOutput: string, commitHash: string): string[] {
        const lines = diffOutput.split('\n');
        const relevantHunks: string[] = [];
        let currentHunk: string[] = [];
        let inRelevantHunk = false;
        let hunkHeader = '';
        
        for (const line of lines) {
            if (line.startsWith('@@')) {
                // If we were in a relevant hunk, save it
                if (inRelevantHunk && currentHunk.length > 0) {
                    relevantHunks.push([hunkHeader, ...currentHunk].join('\n'));
                }
                
                // Start new hunk
                hunkHeader = line;
                currentHunk = [];
                inRelevantHunk = false;
                
                // Check if this hunk might be relevant by parsing line numbers
                const match = line.match(/@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
                if (match) {
                    // For now, we'll include all hunks, but in a more advanced version,
                    // we could track specific line ranges through the commit history
                    inRelevantHunk = true;
                }
            } else if (inRelevantHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
                currentHunk.push(line);
            } else if (line.startsWith('diff --git') || line.startsWith('index') || 
                      line.startsWith('---') || line.startsWith('+++')) {
                // Skip these header lines
                continue;
            }
        }
        
        // Don't forget the last hunk
        if (inRelevantHunk && currentHunk.length > 0) {
            relevantHunks.push([hunkHeader, ...currentHunk].join('\n'));
        }
        
        return relevantHunks;
    }

    private async getCommitDiff(commitHash: string, filePath: string, workingDir: string): Promise<string> {
        try {
            // First try: Get just the diff for this file in this commit
            const { stdout } = await execAsync(
                `git show ${commitHash} --format="" -- "${filePath}"`,
                { cwd: workingDir }
            );
            
            if (stdout.trim().length > 0) {
                return stdout.trim();
            }
            
            // If no output, the file might not exist at this path
            // Try to find the file by its basename in the commit
            const filename = filePath.split('/').pop() || filePath;
            
            try {
                // Search for files with this name in the commit
                const { stdout: lsFiles } = await execAsync(
                    `git ls-tree -r --name-only ${commitHash} | grep -E "(^|/)${filename}$"`,
                    { cwd: workingDir }
                );
                
                const foundFiles = lsFiles.trim().split('\n').filter(f => f.trim());
                
                if (foundFiles.length > 0) {
                    // Use the first match (or we could be smarter about picking)
                    const actualPath = foundFiles[0];
                    
                    const { stdout: actualDiff } = await execAsync(
                        `git show ${commitHash} --format="" -- "${actualPath}"`,
                        { cwd: workingDir }
                    );
                    
                    if (actualDiff.trim().length > 0) {
                        return actualDiff.trim();
                    }
                }
            } catch (searchError) {
                // File search failed, continue to fallback
            }
            
            // Last resort: try git diff between this commit and its parent
            try {
                const { stdout: diffOutput } = await execAsync(
                    `git diff ${commitHash}^..${commitHash} -- "*${filename}"`,
                    { cwd: workingDir }
                );
                
                if (diffOutput.trim().length > 0) {
                    return diffOutput.trim();
                }
            } catch (diffError) {
                // Git diff fallback failed
            }
            
            return `# No changes found for ${filename} in this commit`;
            
        } catch (error) {
            return `# Error retrieving diff: ${error}`;
        }
    }

    private async findPullRequests(commits: string[], workingDir: string): Promise<PullRequestInfo[]> {
        const pullRequests: PullRequestInfo[] = [];
        
        for (const commitHash of commits) {
            try {
                // Use GitHub CLI to find PR for this commit
                const { stdout } = await execAsync(
                    `gh pr list --state merged --search "${commitHash}" --json number,title,body,author,url,createdAt,mergedAt --limit 1`,
                    { cwd: workingDir }
                );
                
                const prs = JSON.parse(stdout);
                if (prs && prs.length > 0) {
                    const pr = prs[0];
                    
                    // Get PR comments
                    const comments = await this.getPullRequestComments(pr.number, workingDir);
                    
                    // Get linked issues
                    const linkedIssues = await this.getLinkedIssues(pr.body, workingDir);
                    
                    pullRequests.push({
                        number: pr.number,
                        title: pr.title,
                        body: pr.body || '',
                        author: pr.author?.login || 'Unknown',
                        url: pr.url,
                        createdAt: pr.createdAt,
                        mergedAt: pr.mergedAt,
                        comments,
                        linkedIssues
                    });
                }
            } catch (error) {
                console.error(`Failed to find PR for commit ${commitHash}:`, error);
            }
        }
        
        // Remove duplicates and sort by created date
        const uniquePRs = pullRequests.filter((pr, index, self) => 
            index === self.findIndex(p => p.number === pr.number)
        );
        
        return uniquePRs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    private async getPullRequestComments(prNumber: number, workingDir: string): Promise<PullRequestComment[]> {
        try {
            const { stdout } = await execAsync(
                `gh pr view ${prNumber} --json comments`,
                { cwd: workingDir }
            );
            
            const data = JSON.parse(stdout);
            if (data.comments && Array.isArray(data.comments)) {
                return data.comments.map((comment: any) => ({
                    author: comment.author?.login || 'Unknown',
                    body: comment.body || '',
                    createdAt: comment.createdAt
                }));
            }
        } catch (error) {
            console.error(`Failed to get comments for PR ${prNumber}:`, error);
        }
        
        return [];
    }

    private async getLinkedIssues(prBody: string, workingDir: string): Promise<LinkedIssue[]> {
        const linkedIssues: LinkedIssue[] = [];
        
        if (!prBody) {
            return linkedIssues;
        }
        
        // Look for issue references in PR body (e.g., "fixes #123", "closes #456")
        const issueMatches = prBody.match(/(fixes|closes|resolves|fix|close|resolve)\s+#(\d+)/gi);
        
        if (issueMatches) {
            for (const match of issueMatches) {
                const issueNumberMatch = match.match(/#(\d+)/);
                if (issueNumberMatch) {
                    const issueNumber = parseInt(issueNumberMatch[1]);
                    
                    try {
                        const { stdout } = await execAsync(
                            `gh issue view ${issueNumber} --json title,url`,
                            { cwd: workingDir }
                        );
                        
                        const issue = JSON.parse(stdout);
                        linkedIssues.push({
                            number: issueNumber,
                            title: issue.title || `Issue #${issueNumber}`,
                            url: issue.url
                        });
                    } catch (error) {
                        // Issue might not exist or be accessible
                        linkedIssues.push({
                            number: issueNumber,
                            title: `Issue #${issueNumber}`,
                            url: `https://github.com/owner/repo/issues/${issueNumber}` // Generic URL
                        });
                    }
                }
            }
        }
        
        return linkedIssues;
    }

    async getCurrentChanges(workspaceRoot?: string): Promise<{staged: string, unstaged: string, untracked: string}> {
        try {
            // Find git root
            const gitRoot = workspaceRoot ? await this.findGitRoot(workspaceRoot) : await this.findGitRoot(process.cwd());
            if (!gitRoot) {
                throw new Error('Not a git repository');
            }

            // Get staged changes
            const { stdout: staged } = await execAsync('git diff --cached', { cwd: gitRoot });
            
            // Get unstaged changes  
            const { stdout: unstaged } = await execAsync('git diff', { cwd: gitRoot });
            
            // Get untracked files
            const { stdout: untrackedFiles } = await execAsync('git ls-files --others --exclude-standard', { cwd: gitRoot });
            
            return {
                staged: staged.trim(),
                unstaged: unstaged.trim(), 
                untracked: untrackedFiles.trim()
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Failed to get current changes: ${errorMessage}`);
        }
    }

    async getFileStatus(filePath: string): Promise<{status: string, diff: string}> {
        try {
            const gitRoot = await this.findGitRoot(filePath);
            if (!gitRoot) {
                throw new Error('Not a git repository');
            }

            const relativePath = await this.getRelativePathFromGitRoot(filePath, gitRoot);
            
            // Get file status
            const { stdout: status } = await execAsync(`git status --porcelain "${relativePath}"`, { cwd: gitRoot });
            
            // Get diff for this specific file
            let diff = '';
            if (status.trim()) {
                try {
                    // Try unstaged diff first
                    const { stdout: unstagedDiff } = await execAsync(`git diff "${relativePath}"`, { cwd: gitRoot });
                    if (unstagedDiff.trim()) {
                        diff = unstagedDiff;
                    } else {
                        // Try staged diff
                        const { stdout: stagedDiff } = await execAsync(`git diff --cached "${relativePath}"`, { cwd: gitRoot });
                        diff = stagedDiff;
                    }
                } catch (diffError) {
                    // File might be new/untracked
                    diff = 'New file (untracked)';
                }
            }
            
            return {
                status: status.trim() || 'No changes',
                diff: diff.trim()
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            throw new Error(`Failed to get file status: ${errorMessage}`);
        }
    }

    private createTimeline(commits: CommitInfo[], pullRequests: PullRequestInfo[]): TimelineItem[] {
        const timeline: TimelineItem[] = [];
        
        // Add commits to timeline
        commits.forEach(commit => {
            timeline.push({
                type: 'commit',
                date: commit.date,
                data: commit
            });
        });
        
        // Add PRs to timeline
        pullRequests.forEach(pr => {
            timeline.push({
                type: 'pullRequest',
                date: pr.createdAt,
                data: pr
            });
        });
        
        // Sort by date (most recent first)
        return timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
}