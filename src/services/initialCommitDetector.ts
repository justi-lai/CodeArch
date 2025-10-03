import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export interface RenameInfo {
    oldName: string;
    newName: string;
    commit: string;
    date: string;
}

export interface InitialCommitInfo {
    hash: string;
    author: string;
    date: string;
    message: string;
    functionName: string;
    filePath: string;
    // Rename detection fields
    previousNames?: string[];
    renameHistory?: RenameInfo[];
    wasRenamed?: boolean;
}

export interface FunctionContext {
    functionName: string;
    className?: string;
    // Add other relevant AST info we might need
}

export class InitialCommitDetector {
    
    /**
     * Find the initial commit that introduced a specific function
     * Uses git log -S to find when the function name was first added
     * Supports rename detection to trace function history
     */
    async findInitialCommit(
        functionName: string, 
        filePath: string, 
        workspaceRoot: string
    ): Promise<InitialCommitInfo | null> {
        const enableRenameDetection = this.isRenameDetectionEnabled();
        console.log(`[DEBUG] Rename detection ${enableRenameDetection ? 'enabled' : 'disabled'}`);
        
        return await this.findInitialCommitRecursive(
            functionName, 
            filePath, 
            workspaceRoot, 
            [], 
            [], 
            0, 
            enableRenameDetection
        );
    }

    /**
     * Recursive implementation of findInitialCommit with rename detection
     */
    private async findInitialCommitRecursive(
        functionName: string, 
        filePath: string, 
        workspaceRoot: string, 
        renameHistory: RenameInfo[],
        previousNames: string[],
        depth: number,
        enableRenameDetection: boolean,
        maxDepth: number = 5
    ): Promise<InitialCommitInfo | null> {
        try {
            console.log(`[DEBUG] Finding initial commit (depth ${depth}) for function "${functionName}" in ${filePath}`);
            console.log(`[DEBUG] Rename history so far: [${previousNames.join(' -> ')}] -> ${functionName}`);
            
            // Depth limit to prevent infinite recursion
            if (depth >= maxDepth) {
                console.log(`[DEBUG] Maximum rename depth (${maxDepth}) reached for "${functionName}"`);
                return null;
            }
            
            // First time only: test that git is working
            if (depth === 0) {
                try {
                    const versionOutput = await this.runGitCommand(['--version'], workspaceRoot);
                    console.log(`[DEBUG] Git version check: "${versionOutput.trim()}"`);
                } catch (error) {
                    console.error(`[DEBUG] Git version check failed:`, error);
                    return null;
                }
            }
            
            // Get the relative path from workspace root
            const relativePath = path.relative(workspaceRoot, filePath);
            
            // Use git log -S to find commits where the function name count changed
            const args = [
                'log',
                '--reverse',
                '-S',
                `def ${functionName}`,
                '--format=%H|%an|%ad|%s',
                '--date=iso'
            ];

            console.log(`[DEBUG] Running git command: git ${args.join(' ')}`);
            console.log(`[DEBUG] In directory: ${workspaceRoot}`);
            console.log(`[DEBUG] Searching for function: "${functionName}"`);
            console.log(`[DEBUG] In file: ${relativePath}`);

            let gitOutput = await this.runGitCommand(args, workspaceRoot);
            
            console.log(`[DEBUG] Git -S 'def ${functionName}' output: "${gitOutput}"`);
            
            // Strategy 1b: If searching for 'def functionName' failed, try just the function name
            if (!gitOutput.trim()) {
                console.log(`[DEBUG] Trying git log -S with just function name`);
                const fallbackArgs = [
                    'log',
                    '--reverse',
                    '-S',
                    functionName,
                    '--format=%H|%an|%ad|%s',
                    '--date=iso'
                ];
                gitOutput = await this.runGitCommand(fallbackArgs, workspaceRoot);
                console.log(`[DEBUG] Git -S '${functionName}' output: "${gitOutput}"`);
            }
            
            // Strategy 2: If git log -S failed completely, try git blame (fast and reliable)
            if (!gitOutput.trim()) {
                console.log(`[DEBUG] git log -S failed, trying git blame strategy (fast)`);
                gitOutput = await this.tryGitBlame(functionName, relativePath, workspaceRoot);
            }
            
            if (!gitOutput.trim()) {
                console.log(`[DEBUG] All git strategies failed for function "${functionName}"`);
                return null;
            }

            // Parse git output: hash|author|date|message
            const lines = gitOutput.trim().split('\n');
            const firstLine = lines[0];
            const parts = firstLine.split('|');
            
            if (parts.length < 4) {
                console.warn(`[DEBUG] Unexpected git log format: ${firstLine}`);
                return null;
            }

            const [hash, author, date, ...messageParts] = parts;
            const message = messageParts.join('|');
            const commitHash = hash.trim();

            console.log(`[DEBUG] Found commit for "${functionName}": ${commitHash.substring(0, 8)} - ${message}`);

            // If rename detection is enabled and this isn't already a deep search,
            // check if this commit contains a rename
            if (enableRenameDetection && depth < maxDepth) {
                console.log(`[DEBUG] Checking for renames in commit ${commitHash.substring(0, 8)}`);
                
                const diffOutput = await this.getCommitDiff(commitHash, filePath, workspaceRoot);
                const oldFunctionName = this.parseRenameFromDiff(diffOutput, functionName, filePath);
                
                if (oldFunctionName && oldFunctionName !== functionName) {
                    console.log(`[DEBUG] Detected rename: "${oldFunctionName}" -> "${functionName}" in commit ${commitHash.substring(0, 8)}`);
                    
                    // Create rename info
                    const renameInfo: RenameInfo = {
                        oldName: oldFunctionName,
                        newName: functionName,
                        commit: commitHash,
                        date: date.trim()
                    };
                    
                    // Recursively search for the old function name
                    const olderCommit = await this.findInitialCommitRecursive(
                        oldFunctionName,
                        filePath,
                        workspaceRoot,
                        [renameInfo, ...renameHistory],
                        [oldFunctionName, ...previousNames],
                        depth + 1,
                        enableRenameDetection,
                        maxDepth
                    );
                    
                    if (olderCommit) {
                        // Merge the rename history
                        olderCommit.renameHistory = [...(olderCommit.renameHistory || []), renameInfo];
                        olderCommit.previousNames = [...(olderCommit.previousNames || []), oldFunctionName];
                        olderCommit.wasRenamed = true;
                        return olderCommit;
                    }
                    // If no older commit found, fall through to return current commit
                }
            }

            // Create the final result
            const initialCommit: InitialCommitInfo = {
                hash: commitHash,
                author: author.trim(),
                date: date.trim(),
                message: message.trim(),
                functionName,
                filePath,
                renameHistory: renameHistory.length > 0 ? renameHistory : undefined,
                previousNames: previousNames.length > 0 ? previousNames : undefined,
                wasRenamed: renameHistory.length > 0
            };

            console.log(`[DEBUG] Final initial commit for "${functionName}": ${commitHash.substring(0, 8)} - ${message.trim()}`);
            if (renameHistory.length > 0) {
                // Build the correct chain: start with original function, follow the renames
                const chain = [functionName]; // Start with the original function (calc_interest)
                
                // The renameHistory array is already in chronological order:
                // [calc_interest -> calculate_simple_interest, calculate_simple_interest -> compute_interest_amount]
                // So we just need to add each newName in order
                for (const rename of renameHistory) {
                    chain.push(rename.newName);
                }
                console.log(`[DEBUG] Rename chain: ${chain.join(' -> ')}`);
            }
            
            return initialCommit;

        } catch (error) {
            console.error(`Error finding initial commit for function "${functionName}":`, error);
            return null;
        }
    }

    /**
     * Find initial commits for multiple functions in the same file
     * This is more efficient than calling findInitialCommit multiple times
     */
    async findInitialCommitsForFunctions(
        functionNames: string[], 
        filePath: string, 
        workspaceRoot: string
    ): Promise<InitialCommitInfo[]> {
        const results: InitialCommitInfo[] = [];
        
        // We could optimize this by running all searches in parallel
        const promises = functionNames.map(functionName => 
            this.findInitialCommit(functionName, filePath, workspaceRoot)
        );
        
        const commits = await Promise.all(promises);
        
        // Filter out null results
        for (const commit of commits) {
            if (commit) {
                results.push(commit);
            }
        }
        
        return results;
    }

    /**
     * Get more detailed information about an initial commit
     * Including the actual diff that introduced the function
     */
    async getInitialCommitDetails(
        commitHash: string, 
        filePath: string, 
        workspaceRoot: string
    ): Promise<string | null> {
        try {
            const relativePath = path.relative(workspaceRoot, filePath);
            
            // Get the actual diff for this commit and file
            const args = [
                'show',
                commitHash,
                '--format=%B', // Just the commit message body
                '--', relativePath
            ];

            const diffOutput = await this.runGitCommand(args, workspaceRoot);
            return diffOutput;

        } catch (error) {
            console.error(`Error getting commit details for ${commitHash}:`, error);
            return null;
        }
    }

    /**
     * Find the containing function for a specific line range using AST + initial commit detection
     */
    async findInitialCommitForLineRange(
        filePath: string,
        startLine: number,
        endLine: number,
        workspaceRoot: string,
        functionContext?: FunctionContext
    ): Promise<InitialCommitInfo | null> {
        
        // If we already have function context from AST, use it
        if (functionContext?.functionName) {
            return this.findInitialCommit(functionContext.functionName, filePath, workspaceRoot);
        }

        // Otherwise, we'd need to integrate with AST analysis to find the function name
        // For now, return null - this will be connected when we integrate with the context builder
        console.log(`[DEBUG] No function context provided for line range ${startLine}-${endLine}`);
        return null;
    }

    /**
     * Run a git command and return the output
     */
    private runGitCommand(args: string[], workspaceRoot: string): Promise<string> {
        return new Promise((resolve, reject) => {
            console.log(`[DEBUG] Spawning git process with args: ${args.join(' ')}`);
            const git = spawn('git', args, {
                cwd: workspaceRoot,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            git.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            git.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            git.on('close', (code) => {
                console.log(`[DEBUG] Git command completed with code: ${code}`);
                if (stderr) {
                    console.log(`[DEBUG] Git stderr: ${stderr}`);
                }
                console.log(`[DEBUG] Git stdout length: ${stdout.length} characters`);
                
                if (code === 0) {
                    resolve(stdout);
                } else {
                    console.log(`[DEBUG] Git command failed: ${stderr}`);
                    reject(new Error(`Git command failed with code ${code}: ${stderr}`));
                }
            });

            git.on('error', (error) => {
                console.log(`[DEBUG] Git spawn error: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Strategy 2: Try git blame to find when the function line was first added (FAST)
     */
    private async tryGitBlame(functionName: string, relativePath: string, workspaceRoot: string): Promise<string> {
        try {
            // First, find the line number where the function is defined
            const grepArgs = ['grep', '-n', `def ${functionName}`, relativePath];
            console.log(`[DEBUG] Finding function line: git ${grepArgs.join(' ')}`);
            
            const grepOutput = await this.runGitCommand(grepArgs, workspaceRoot);
            if (!grepOutput.trim()) {
                console.log(`[DEBUG] Could not find function definition line`);
                return '';
            }

            // Extract line number (format: "filename:lineNumber:content" or "lineNumber:content")
            const lineMatch = grepOutput.match(/(?:^|:)(\d+):/);
            if (!lineMatch) {
                console.log(`[DEBUG] Could not parse line number from grep output: ${grepOutput}`);
                return '';
            }

            const lineNumber = lineMatch[1];
            console.log(`[DEBUG] Function found at line ${lineNumber}`);

            // Use git blame to find when that line was added
            const blameArgs = ['blame', '-L', `${lineNumber},${lineNumber}`, '--porcelain', relativePath];
            console.log(`[DEBUG] Trying git blame: git ${blameArgs.join(' ')}`);
            
            const blameOutput = await this.runGitCommand(blameArgs, workspaceRoot);
            
            // Parse blame output to get commit hash
            const commitMatch = blameOutput.match(/^([a-f0-9]+)/);
            if (!commitMatch) {
                console.log(`[DEBUG] Could not parse commit from blame output`);
                return '';
            }

            const commitHash = commitMatch[1];
            console.log(`[DEBUG] Found commit from blame: ${commitHash}`);

            // Get commit details
            const showArgs = ['show', '--format=%H|%an|%ad|%s', '--date=iso', '--no-patch', commitHash];
            return await this.runGitCommand(showArgs, workspaceRoot);
            
        } catch (error) {
            console.log(`[DEBUG] git blame strategy failed: ${error}`);
            return '';
        }
    }

    /**
     * Check if rename detection is enabled in settings
     */
    private isRenameDetectionEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('codescribe');
        return config.get<boolean>('enableRenameDetection', true);
    }

    /**
     * Parse a git diff to detect function renames
     * Looks for patterns like:
     * - def old_function_name(
     * + def new_function_name(
     */
    private parseRenameFromDiff(
        diffOutput: string, 
        currentFunctionName: string, 
        filePath: string
    ): string | null {
        console.log(`[DEBUG] Analyzing diff for renames of "${currentFunctionName}"`);
        
        // Different patterns for different languages
        const fileExtension = path.extname(filePath).toLowerCase();
        const patterns = this.getRenamePatterns(fileExtension);
        
        for (const pattern of patterns) {
            const renameMatch = this.findRenameInDiff(diffOutput, currentFunctionName, pattern);
            if (renameMatch) {
                console.log(`[DEBUG] Found rename: "${renameMatch}" -> "${currentFunctionName}"`);
                return renameMatch;
            }
        }
        
        console.log(`[DEBUG] No rename detected for "${currentFunctionName}"`);
        return null;
    }

    /**
     * Get language-specific rename patterns
     */
    private getRenamePatterns(fileExtension: string): Array<{remove: RegExp, add: RegExp}> {
        switch (fileExtension) {
            case '.py':
                return [
                    {
                        remove: /^-\s*def\s+(\w+)\s*\(/gm,
                        add: /^\+\s*def\s+(\w+)\s*\(/gm
                    },
                    {
                        remove: /^-\s*class\s+(\w+)\s*[\(:]?/gm,
                        add: /^\+\s*class\s+(\w+)\s*[\(:]?/gm
                    }
                ];
            case '.js':
            case '.ts':
                return [
                    {
                        remove: /^-\s*function\s+(\w+)\s*\(/gm,
                        add: /^\+\s*function\s+(\w+)\s*\(/gm
                    },
                    {
                        remove: /^-\s*(\w+)\s*:\s*function\s*\(/gm,
                        add: /^\+\s*(\w+)\s*:\s*function\s*\(/gm
                    },
                    {
                        remove: /^-\s*(\w+)\s*\([^)]*\)\s*=>/gm,
                        add: /^\+\s*(\w+)\s*\([^)]*\)\s*=>/gm
                    }
                ];
            case '.java':
            case '.c':
            case '.cpp':
            case '.cs':
                return [
                    {
                        remove: /^-\s*(?:public|private|protected|static|\s)*\w+\s+(\w+)\s*\(/gm,
                        add: /^\+\s*(?:public|private|protected|static|\s)*\w+\s+(\w+)\s*\(/gm
                    }
                ];
            default:
                // Generic pattern for any language
                return [
                    {
                        remove: /^-.*?(\w+)\s*\(/gm,
                        add: /^\+.*?(\w+)\s*\(/gm
                    }
                ];
        }
    }

    /**
     * Find a rename in the diff using the given patterns
     */
    private findRenameInDiff(
        diffOutput: string, 
        currentFunctionName: string, 
        pattern: {remove: RegExp, add: RegExp}
    ): string | null {
        const removedFunctions: string[] = [];
        const addedFunctions: string[] = [];
        
        // Find all removed functions
        let match;
        while ((match = pattern.remove.exec(diffOutput)) !== null) {
            removedFunctions.push(match[1]);
        }
        
        // Reset regex state
        pattern.remove.lastIndex = 0;
        
        // Find all added functions
        while ((match = pattern.add.exec(diffOutput)) !== null) {
            addedFunctions.push(match[1]);
        }
        
        // Reset regex state
        pattern.add.lastIndex = 0;
        
        console.log(`[DEBUG] Removed functions: [${removedFunctions.join(', ')}]`);
        console.log(`[DEBUG] Added functions: [${addedFunctions.join(', ')}]`);
        
        // If current function was added and there's exactly one removed function,
        // it's likely a rename
        if (addedFunctions.includes(currentFunctionName) && removedFunctions.length === 1) {
            return removedFunctions[0];
        }
        
        // More sophisticated heuristic: find the most similar name
        if (addedFunctions.includes(currentFunctionName) && removedFunctions.length > 0) {
            return this.findMostSimilarName(currentFunctionName, removedFunctions);
        }
        
        return null;
    }

    /**
     * Find the most similar function name using simple string similarity
     */
    private findMostSimilarName(targetName: string, candidates: string[]): string | null {
        let bestMatch: string | null = null;
        let bestScore = 0;
        
        for (const candidate of candidates) {
            const score = this.calculateSimilarity(targetName, candidate);
            if (score > bestScore && score > 0.3) { // Minimum similarity threshold
                bestScore = score;
                bestMatch = candidate;
            }
        }
        
        return bestMatch;
    }

    /**
     * Calculate string similarity using simple character-based approach
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) {
            return 1.0;
        }
        
        const editDistance = this.calculateEditDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private calculateEditDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
        
        for (let i = 0; i <= str1.length; i++) {
            matrix[0][i] = i;
        }
        
        for (let j = 0; j <= str2.length; j++) {
            matrix[j][0] = j;
        }
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[j][i] = matrix[j - 1][i - 1];
                } else {
                    matrix[j][i] = Math.min(
                        matrix[j - 1][i - 1] + 1, // substitution
                        matrix[j][i - 1] + 1,     // insertion
                        matrix[j - 1][i] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Get the diff for a specific commit
     */
    private async getCommitDiff(commitHash: string, filePath: string, workspaceRoot: string): Promise<string> {
        const relativePath = path.relative(workspaceRoot, filePath);
        const args = ['show', commitHash, '--', relativePath];
        console.log(`[DEBUG] Getting diff for commit ${commitHash}: git ${args.join(' ')}`);
        
        try {
            return await this.runGitCommand(args, workspaceRoot);
        } catch (error) {
            console.log(`[DEBUG] Failed to get commit diff: ${error}`);
            return '';
        }
    }
}