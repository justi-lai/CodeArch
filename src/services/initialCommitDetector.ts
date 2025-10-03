import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export interface InitialCommitInfo {
    hash: string;
    author: string;
    date: string;
    message: string;
    functionName: string;
    filePath: string;
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
     */
    async findInitialCommit(
        functionName: string, 
        filePath: string, 
        workspaceRoot: string
    ): Promise<InitialCommitInfo | null> {
        try {
            console.log(`[DEBUG] Finding initial commit for function "${functionName}" in ${filePath}`);
            
            // First, let's test that git is working at all
            try {
                const versionOutput = await this.runGitCommand(['--version'], workspaceRoot);
                console.log(`[DEBUG] Git version check: "${versionOutput.trim()}"`);
            } catch (error) {
                console.error(`[DEBUG] Git version check failed:`, error);
                return null;
            }
            
            // Get the relative path from workspace root
            const relativePath = path.relative(workspaceRoot, filePath);
            
            // Use git log -S to find commits where the function name count changed
            // --reverse gives us the earliest first, -n 1 gives us just the first result
            // Try searching for the full function definition pattern first
            // Start with minimal args that match your working terminal command
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
            const message = messageParts.join('|'); // Rejoin in case message had | chars

            const initialCommit: InitialCommitInfo = {
                hash: hash.trim(),
                author: author.trim(),
                date: date.trim(),
                message: message.trim(),
                functionName,
                filePath
            };

            console.log(`[DEBUG] Found initial commit for "${functionName}": ${hash.substring(0, 8)} - ${message}`);
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
}