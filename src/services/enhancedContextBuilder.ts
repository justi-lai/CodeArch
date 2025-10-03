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
import { ASTAnalysisService, CodeStructure } from './astAnalysisService';
import { LSPCallGraphService, LSPContext } from './lspCallGraphService';
import { InitialCommitDetector, InitialCommitInfo } from './initialCommitDetector';
import { GitAnalysisResult } from '../types';

export interface EnhancedCodeContext {
    selectedCode: string;
    filePath: string;
    startLine: number;
    endLine: number;
    
    // AST Analysis
    astStructure: CodeStructure;
    
    // LSP Analysis
    lspContext: LSPContext;
    criticality: 'high' | 'medium' | 'low';
    
    // Git History
    gitAnalysis: GitAnalysisResult;
    
    // Initial Commit Analysis
    initialCommit?: InitialCommitInfo;
    containingFunctionName?: string;
    
    // Enhanced Context
    surroundingCode?: string;
    relatedFiles: string[];
}

export class EnhancedContextBuilder {
    private astService: ASTAnalysisService;
    private lspService: LSPCallGraphService;
    private initialCommitDetector: InitialCommitDetector;

    constructor() {
        this.astService = new ASTAnalysisService();
        this.lspService = new LSPCallGraphService();
        this.initialCommitDetector = new InitialCommitDetector();
    }

    async buildEnhancedContext(
        selectedCode: string,
        filePath: string,
        startLine: number,
        endLine: number,
        gitAnalysis: GitAnalysisResult
    ): Promise<EnhancedCodeContext> {
        try {
            // Get the document for LSP queries
            const document = await vscode.workspace.openTextDocument(filePath);
            
            // Get language for AST analysis
            const language = await this.astService.getLanguageFromFile(filePath);
            const fullFileContent = document.getText();

            // Run AST and LSP analysis in parallel
            const [astStructure, lspContext] = await Promise.all([
                this.astService.analyzeCode(fullFileContent, language, startLine, endLine),
                this.lspService.analyzeSymbolContext(document, startLine, endLine)
            ]);

            // Calculate criticality based on LSP data
            const criticality = this.lspService.calculateCriticality(lspContext);



            // Find the containing function and its initial commit
            let containingFunctionName = this.findContainingFunctionName(astStructure, startLine, endLine);
            
            // Fallback: If AST didn't find a function but LSP found a symbol, use that
            if (!containingFunctionName && lspContext.symbolAtPosition) {
                containingFunctionName = lspContext.symbolAtPosition;
            }
            
            let initialCommit: InitialCommitInfo | undefined;
            
            if (containingFunctionName) {
                const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
                if (workspaceRoot) {
                    initialCommit = await this.initialCommitDetector.findInitialCommit(
                        containingFunctionName, 
                        filePath, 
                        workspaceRoot
                    ) || undefined;
                }
            }

            // Get surrounding code context
            const surroundingCode = await this.getSurroundingCode(document, startLine, endLine);

            // Extract related files from references and git history
            const relatedFiles = this.extractRelatedFiles(lspContext, gitAnalysis);

            return {
                selectedCode,
                filePath,
                startLine,
                endLine,
                astStructure,
                lspContext,
                criticality,
                gitAnalysis,
                initialCommit,
                containingFunctionName,
                surroundingCode,
                relatedFiles
            };

        } catch (error) {
            console.warn('Enhanced context analysis failed, using minimal context:', error);
            return {
                selectedCode,
                filePath,
                startLine,
                endLine,
                astStructure: {
                    language: 'unknown',
                    functions: [],
                    classes: [],
                    interfaces: [],
                    variables: [],
                    imports: [],
                    exports: []
                },
                lspContext: {
                    callHierarchy: undefined,
                    references: { definition: undefined, references: [], implementations: [] },
                    symbols: [],
                    workspaceSymbols: []
                },
                criticality: 'low' as const,
                gitAnalysis,
                relatedFiles: []
            };
        }
    }

    createSeparatedQueries(context: EnhancedCodeContext): {
        purposeQuery: string;
        criticalityQuery: string;
        introductionQuery: string;
        evolutionQuery: string;
    } {
        return this.buildCodeAnalysisQueries(context);
    }

    buildCodeAnalysisQueries(context: EnhancedCodeContext): {
        purposeQuery: string;
        criticalityQuery: string;
        introductionQuery: string;
        evolutionQuery: string;
    } {
        const baseCode = `\`\`\`${context.astStructure.language}
${context.selectedCode}
\`\`\``;

        // Query 1: Purpose - focus only on the code itself
        const purposeQuery = `Analyze this ${context.astStructure.language} code and explain what it does:

${baseCode}

${this.formatCodeContext(context)}

Respond with ONLY valid JSON in this exact format:
{
  "purpose": "Brief explanation of what this code does"
}

Use plain text values, no markdown formatting.`;

        // Query 2: Criticality - focus on usage patterns and risk assessment
        const criticalityQuery = `Analyze this ${context.astStructure.language} code for criticality and safety:

${baseCode}

Usage Context: ${this.formatCriticalityContext(context)}

Respond with ONLY valid JSON in this exact format:
{
  "criticalityLevel": "HIGH|MEDIUM|LOW",
  "riskAssessment": "1-2 sentences on modification risk",
  "reasoning": "Brief reason for this criticality level"
}

Use plain text values, no markdown formatting.`;

        // Query 3: Introduction - focus ONLY on initial commit
        const introductionQuery = context.initialCommit ? 
            `Explain why this ${context.astStructure.language} function was originally created:

${baseCode}

${this.formatInitialCommitContext(context.initialCommit)}

Respond with ONLY valid JSON in this exact format:
{
  "introduction": "2-3 sentences max: Why this function was created and what problem it solved"
}

CRITICAL: Use ONLY the INITIAL COMMIT information above. Base your analysis on the commit message and context provided.

Use plain text values, no markdown formatting.` 
            :
            `Analyze this ${context.astStructure.language} function to understand its original purpose:

${baseCode}

${this.formatCodeContext(context)}

Respond with ONLY valid JSON in this exact format:
{
  "introduction": "2-3 sentences max: What problem this function was designed to solve"
}

CRITICAL: Since no git history is available, analyze the code itself to infer the original design intent. Focus on the problem it solves.

Use plain text values, no markdown formatting.`;

        // Query 4: Evolution - focus ONLY on recent changes
        const evolutionQuery = `Explain how this ${context.astStructure.language} code has evolved:

${baseCode}

${this.formatRecentChangesContext(context.gitAnalysis, context.initialCommit)}

Respond with ONLY valid JSON in this exact format:
{
  "evolution": "2-3 sentences max: Key changes since initial creation"
}

Use plain text values, no markdown formatting.`;

        return {
            purposeQuery,
            criticalityQuery,
            introductionQuery,
            evolutionQuery
        };
    }

    private formatCodeContext(context: EnhancedCodeContext): string {
        const parts = [];
        
        if (context.surroundingCode) {
            parts.push(`Surrounding context available`);
        }
        
        return parts.join('\n');
    }

    private formatCriticalityContext(context: EnhancedCodeContext): string {
        const parts = [];
        
        if (context.lspContext.references && context.lspContext.references.references) {
            parts.push(`References: ${context.lspContext.references.references.length}`);
        }
        
        if (context.lspContext.callHierarchy) {
            const incomingCount = context.lspContext.callHierarchy.incomingCalls?.length || 0;
            const outgoingCount = context.lspContext.callHierarchy.outgoingCalls?.length || 0;
            
            if (incomingCount > 0) {
                parts.push(`Called by: ${incomingCount} locations`);
            }
            if (outgoingCount > 0) {
                parts.push(`Calls: ${outgoingCount} functions`);
            }
        }
        
        if (context.lspContext.symbols && context.lspContext.symbols.length > 0) {
            const containingSymbol = this.findContainingSymbol(context.lspContext.symbols, context.startLine, context.endLine);
            if (containingSymbol) {
                parts.push(`In: ${vscode.SymbolKind[containingSymbol.kind]} "${containingSymbol.name}"`);
            }
        }

        return parts.join(' • ');
    }

    private findContainingSymbol(symbols: vscode.DocumentSymbol[], startLine: number, endLine: number): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            // Check if the symbol contains our target lines (convert from 0-based to 1-based)
            if (symbol.range.start.line + 1 <= startLine && symbol.range.end.line + 1 >= endLine) {
                // First check if any child symbol is more specific
                if (symbol.children && symbol.children.length > 0) {
                    const childSymbol = this.findContainingSymbol(symbol.children, startLine, endLine);
                    if (childSymbol) {
                        return childSymbol;
                    }
                }
                return symbol;
            }
        }
        return undefined;
    }

    private formatGitContext(gitAnalysis: GitAnalysisResult, initialCommit?: InitialCommitInfo): string {
        let context = '';
        
        // Priority 1: Initial commit that introduced the function (most valuable)
        if (initialCommit) {
            context += `===== INITIAL COMMIT (Original Creation Context) =====\n`;
            context += `- ${initialCommit.hash.substring(0, 8)} (${initialCommit.author}): ${initialCommit.message}\n`;
            context += `  ^ This is the commit that FIRST CREATED the function "${initialCommit.functionName}"\n`;
            context += `  ^ Use THIS commit for understanding the original purpose and design intent\n`;
            context += `  ^ This is what should be referenced in the 'historicalContext' field\n\n`;
        }
        
        // Priority 2: Recent commits (for evolution tracking only)
        if (gitAnalysis.commits.length > 0) {
            context += `===== RECENT CHANGES (Evolution Context Only) =====\n`;
            gitAnalysis.commits.slice(0, 2).forEach(commit => {
                // Skip the initial commit if we already showed it above
                if (initialCommit && commit.hash === initialCommit.hash) {
                    return;
                }
                context += `- ${commit.hash.substring(0, 8)}: ${commit.message}\n`;
            });
            context += `  ^ These are for the 'evolution' field, NOT for 'historicalContext'\n\n`;
        }

        // Priority 3: Related PRs (for broader context)
        if (gitAnalysis.pullRequests.length > 0) {
            context += `\nRelated PRs:\n`;
            gitAnalysis.pullRequests.slice(0, 2).forEach(pr => {
                context += `- PR #${pr.number}: ${pr.title}\n`;
                if (pr.body && pr.body.length > 0) {
                    const shortBody = pr.body.length > 100 ? pr.body.substring(0, 100) + '...' : pr.body;
                    context += `  ${shortBody}\n`;
                }
            });
        }

        return context;
    }

    private formatInitialCommitContext(initialCommit?: InitialCommitInfo): string {
        if (!initialCommit) {
            return 'Initial commit information could not be retrieved for this function.';
        }

        let context = `INITIAL COMMIT (Original Creation Context):
- Commit: ${initialCommit.hash.substring(0, 8)} by ${initialCommit.author}
- Message: "${initialCommit.message}"
- Function: "${initialCommit.functionName}"
- Date: ${initialCommit.date}`;

        // Add rename history if present
        if (initialCommit.wasRenamed && initialCommit.renameHistory && initialCommit.renameHistory.length > 0) {
            context += `\n\nFUNCTION RENAME HISTORY:`;
            context += `\nThis function has been renamed ${initialCommit.renameHistory.length} time(s):`;
            
            // Build the evolution chain
            const evolutionChain = [];
            if (initialCommit.previousNames && initialCommit.previousNames.length > 0) {
                evolutionChain.push(...initialCommit.previousNames.reverse());
            }
            evolutionChain.push(initialCommit.functionName);
            
            context += `\nEvolution: ${evolutionChain.join(' → ')}`;
            
            // Add details for each rename
            context += `\n\nRename Details:`;
            initialCommit.renameHistory.forEach((rename, index) => {
                context += `\n${index + 1}. "${rename.oldName}" → "${rename.newName}"`;
                context += `\n   - Commit: ${rename.commit.substring(0, 8)}`;
                context += `\n   - Date: ${rename.date}`;
            });
            
            context += `\n\nNote: This analysis traced the function through its renames to find the true origin.`;
        }

        context += `\n\nThis commit shows when and why this function was first created.`;
        return context;
    }

    private formatRecentChangesContext(gitAnalysis: GitAnalysisResult, initialCommit?: InitialCommitInfo): string {
        let context = '';
        
        // Add rename history as part of evolution if available
        if (initialCommit?.wasRenamed && initialCommit.renameHistory && initialCommit.renameHistory.length > 0) {
            context += `FUNCTION NAME EVOLUTION:\n`;
            const evolutionChain = [];
            if (initialCommit.previousNames && initialCommit.previousNames.length > 0) {
                evolutionChain.push(...initialCommit.previousNames.reverse());
            }
            evolutionChain.push(initialCommit.functionName);
            context += `Name Evolution: ${evolutionChain.join(' → ')}\n`;
            
            initialCommit.renameHistory.forEach((rename, index) => {
                context += `- Rename ${index + 1}: "${rename.oldName}" → "${rename.newName}" (${rename.commit.substring(0, 8)})\n`;
            });
            context += '\n';
        }
        
        // Recent commits (exclude initial commit and rename commits)
        if (gitAnalysis.commits.length > 0) {
            const renameCommitHashes = initialCommit?.renameHistory ? 
                initialCommit.renameHistory.map(r => r.commit) : [];
            
            const recentCommits = gitAnalysis.commits.filter(commit => 
                (!initialCommit || commit.hash !== initialCommit.hash) &&
                !renameCommitHashes.includes(commit.hash)
            );
            
            if (recentCommits.length > 0) {
                context += `RECENT CHANGES:\n`;
                recentCommits.slice(0, 3).forEach(commit => {
                    context += `- ${commit.hash.substring(0, 8)}: ${commit.message}\n`;
                });
            }
        }

        // Related PRs
        if (gitAnalysis.pullRequests.length > 0) {
            context += `\nRELATED PULL REQUESTS:\n`;
            gitAnalysis.pullRequests.slice(0, 2).forEach(pr => {
                context += `- PR #${pr.number}: ${pr.title}\n`;
                if (pr.body && pr.body.length > 0) {
                    const shortBody = pr.body.length > 100 ? pr.body.substring(0, 100) + '...' : pr.body;
                    context += `  ${shortBody}\n`;
                }
            });
        }

        if (!context) {
            return 'No recent changes or evolution information available.';
        }

        return context;
    }

    private async getSurroundingCode(document: vscode.TextDocument, startLine: number, endLine: number): Promise<string | undefined> {
        try {
            const totalLines = document.lineCount;
            const contextStart = Math.max(0, startLine - 4);
            const contextEnd = Math.min(totalLines, endLine + 3);
            
            if (contextStart < startLine - 1 || contextEnd > endLine) {
                const surroundingRange = new vscode.Range(contextStart, 0, contextEnd - 1, 0);
                return document.getText(surroundingRange);
            }
        } catch (error) {

        }
        
        return undefined;
    }

    private extractRelatedFiles(lspContext: LSPContext, gitAnalysis: GitAnalysisResult): string[] {
        const files = new Set<string>();
        
        // Add files from LSP references
        lspContext.references.references.forEach(ref => {
            files.add(ref.uri.fsPath);
        });
        
        // Add files from git commits
        gitAnalysis.commits.forEach(commit => {
            if (commit.filename) {
                files.add(commit.filename);
            }
        });
        
        return Array.from(files);
    }

    /**
     * Find the name of the function that contains the given line range
     * Uses AST structure to determine the containing function
     */
    private findContainingFunctionName(astStructure: CodeStructure, startLine: number, endLine: number): string | undefined {
        // Look through all functions in the AST structure
        for (const func of astStructure.functions) {
            // Check if the function contains our target lines (convert 0-based to 1-based)
            const funcStartLine = func.startPosition.row + 1;
            const funcEndLine = func.endPosition.row + 1;
            
            if (funcStartLine <= startLine && funcEndLine >= endLine) {
                return func.name;
            }
        }

        // If no function contains the range, look for the closest function
        // This handles cases where the selection might be slightly outside the function body
        let closestFunction = null;
        let closestDistance = Infinity;

        for (const func of astStructure.functions) {
            const funcStartLine = func.startPosition.row + 1;
            const funcEndLine = func.endPosition.row + 1;
            
            const distance = Math.min(
                Math.abs(funcStartLine - startLine),
                Math.abs(funcEndLine - endLine)
            );
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestFunction = func;
            }
        }

        if (closestFunction && closestDistance <= 5) { // Within 5 lines is considered "close enough"
            return closestFunction.name;
        }

        return undefined;
    }
}