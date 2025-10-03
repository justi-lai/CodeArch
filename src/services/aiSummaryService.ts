import axios from 'axios';
import * as vscode from 'vscode';
import { GitAnalysisResult } from '../types';
import { EnhancedContextBuilder, EnhancedCodeContext } from './enhancedContextBuilder';

export class AiSummaryService {
    private contextBuilder: EnhancedContextBuilder;

    constructor() {
        this.contextBuilder = new EnhancedContextBuilder();
    }

    async generateEnhancedSummary(
        analysisResult: GitAnalysisResult,
        selectedCode: string,
        apiKey: string,
        filePath: string,
        startLine: number,
        endLine: number
    ): Promise<string> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const model = config.get<string>('geminiModel', 'gemini-2.0-flash-exp');
        
        // Validate model availability
        this.validateModel(model);

        try {
            // Build enhanced context with AST and LSP analysis
            const enhancedContext = await this.contextBuilder.buildEnhancedContext(
                selectedCode,
                filePath,
                startLine,
                endLine,
                analysisResult
            );

            // Create focused queries with enhanced context
            const queries = this.contextBuilder.createSeparatedQueries(enhancedContext);
            
            // Execute all queries in parallel for efficiency
            const [purposeResponse, criticalityResponse, introductionResponse, evolutionResponse] = await Promise.all([
                this.executeQuery(queries.purposeQuery, model, apiKey),
                this.executeQuery(queries.criticalityQuery, model, apiKey),
                this.executeQuery(queries.introductionQuery, model, apiKey),
                this.executeQuery(queries.evolutionQuery, model, apiKey)
            ]);

            // Combine the responses
            const combinedResponse = this.combineMultipleResponses(
                purposeResponse,
                criticalityResponse,
                introductionResponse,
                evolutionResponse
            );

            // Parse JSON response and format it properly
            return this.formatStructuredResponse(combinedResponse, enhancedContext);

        } catch (error) {
            console.error('Enhanced analysis failed, falling back to basic analysis:', error);
            // Fallback to original method
            return this.generateSummary(analysisResult, selectedCode, apiKey, filePath, startLine, endLine);
        }
    }

    async generateSummary(
        analysisResult: GitAnalysisResult, 
        selectedCode: string, 
        apiKey: string,
        filePath?: string,
        startLine?: number,
        endLine?: number
    ): Promise<string> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const model = config.get<string>('geminiModel', 'gemini-2.0-flash-exp');
        
        // Validate model availability
        this.validateModel(model);
        
        const context = await this.buildContextString(analysisResult, selectedCode, filePath, startLine, endLine);
        
        return this.generateGeminiSummary(context, apiKey, model);
    }

    private getMaxTokensForModel(model: string): number {
        // Set higher token limits for newer models to accommodate their capabilities
        // Gemini 2.5 models can handle much higher output token counts
        switch (model) {
            case 'gemini-2.5-pro':
                return 8192; // Pro model can handle large outputs
            case 'gemini-2.5-flash':
                return 8192; // Flash model also supports high token counts
            case 'gemini-2.0-flash-exp':
                return 4096; // Experimental model with good capacity
            default:
                return 2048; // Reasonable default for any other models
        }
    }

    private validateModel(model: string): void {
        // Warn about experimental or newer models that might not be available
        const experimentalModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-exp'];
        
        if (experimentalModels.includes(model)) {
            // Silent validation - just note that it's experimental
        }
    }

    private async buildContextString(
        analysisResult: GitAnalysisResult, 
        selectedCode: string,
        filePath?: string,
        startLine?: number,
        endLine?: number
    ): Promise<string> {
        let context = `# Code to Analyze:\n\`\`\`\n${selectedCode}\n\`\`\`\n\n`;
        
        // Try to get surrounding context if file path and line numbers are provided
        if (filePath && startLine && endLine) {
            try {
                const document = await vscode.workspace.openTextDocument(filePath);
                const totalLines = document.lineCount;
                
                // Get 3 lines above and below for context (but within bounds)
                const contextStart = Math.max(0, startLine - 4); // -4 because line numbers are 1-based
                const contextEnd = Math.min(totalLines, endLine + 3);
                
                if (contextStart < startLine - 1 || contextEnd > endLine) {
                    const surroundingRange = new vscode.Range(contextStart, 0, contextEnd - 1, 0);
                    const surroundingCode = document.getText(surroundingRange);
                    
                    context += `# Code with Surrounding Context (comments and nearby code):\n\`\`\`\n${surroundingCode}\n\`\`\`\n\n`;
                }
            } catch (error) {
                // If we can't get surrounding context, just continue with selected code
                console.log('Could not get surrounding context:', error);
            }
        }
        
        if (analysisResult.commits.length > 0) {
            context += `# Commit History (focus on WHY changes were made):\n`;
            analysisResult.commits.forEach(commit => {
                context += `- **${commit.hash.substring(0, 8)}** (${commit.author}): ${commit.message}\n`;
            });
            context += `\n`;
        }
        
        if (analysisResult.pullRequests.length > 0) {
            context += `# Pull Request Context (problems solved & decisions made):\n`;
            analysisResult.pullRequests.forEach(pr => {
                context += `## PR #${pr.number}: ${pr.title}\n`;
                
                if (pr.body) {
                    // Extract key problem statements and solutions
                    const relevantBody = pr.body.length > 300 ? pr.body.substring(0, 300) + '...' : pr.body;
                    context += `Problem/Solution: ${relevantBody}\n\n`;
                }
                
                // Include key technical discussions
                if (pr.comments.length > 0) {
                    context += `Key discussions:\n`;
                    pr.comments.slice(0, 2).forEach(comment => {
                        if (comment.body.length > 100) {
                            context += `- ${comment.author}: ${comment.body.substring(0, 150)}...\n`;
                        } else {
                            context += `- ${comment.author}: ${comment.body}\n`;
                        }
                    });
                    context += `\n`;
                }
                
                if (pr.linkedIssues.length > 0) {
                    context += `Related issues: ${pr.linkedIssues.map(issue => `#${issue.number} (${issue.title})`).join(', ')}\n\n`;
                }
            });
        }
        
        return context;
    }

    protected async generateGeminiSummary(context: string, apiKey: string, model: string): Promise<string> {
        const prompt = this.buildPrompt(context);
        
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        maxOutputTokens: this.getMaxTokensForModel(model),
                        temperature: 0.2, // Lower temperature for more focused responses
                        topP: 0.8,
                        topK: 20 // Reduced for more deterministic output
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000 // 30 second timeout
                }
            );
            
            // Check finish reason first
            const finishReason = response.data.candidates?.[0]?.finishReason;
            
            // Try different response structure paths for different models
            let generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            // Fallback for different response structures
            if (!generatedText) {
                generatedText = response.data.candidates?.[0]?.output;
                if (!generatedText) {
                    generatedText = response.data.text;
                }
                if (!generatedText) {
                    generatedText = response.data.content?.parts?.[0]?.text;
                }
            }
            
            if (!generatedText) {
                if (finishReason === 'MAX_TOKENS') {
                    throw new Error(`Model ${model} hit the token limit before completing the response. The model may be using too many tokens for internal reasoning. Try switching to a different model or reducing the input size.`);
                }
                
                throw new Error(`No response generated from Gemini API for model ${model}. Try switching to a different model.`);
            }
            
            return generatedText;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 400) {
                    const errorMsg = error.response?.data?.error?.message || 'Invalid request';
                    if (errorMsg.includes('API key')) {
                        throw new Error(`Invalid Gemini API key for model ${model}. Please check your configuration.`);
                    }
                    if (errorMsg.includes('model')) {
                        throw new Error(`Model ${model} may not be available or supported. Try switching to a different model in settings.`);
                    }
                    throw new Error(`Gemini API error for model ${model}: ${errorMsg}`);
                } else if (error.response?.status === 404) {
                    throw new Error(`Model ${model} not found. This model may not be available yet or in your region. Please try a different model.`);
                } else if (error.response?.status === 429) {
                    throw new Error(`Gemini API rate limit exceeded for model ${model}. Please try again later.`);
                } else if (error.response?.status === 403) {
                    throw new Error(`Gemini API access denied for model ${model}. Please check your API key permissions.`);
                } else {
                    throw new Error(`Gemini API error for model ${model} (${error.response?.status}): ${error.response?.data?.error?.message || error.message}`);
                }
            }
            throw error;
        }
    }

    private buildPrompt(context: string): string {
        return `You are a senior software engineer reviewing code history. Based on the git commits, pull request context, and code structure below, provide a CONFIDENT analysis focused on what matters most to developers.

${context}

Provide your analysis in this EXACT format (use ** for bold text):

**WHY THIS CODE EXISTS:**
[1-2 definitive sentences explaining what problem this code solves and its purpose. Base this on commit messages, nearby comments, and code structure. Be confident and assertive - avoid words like "likely," "probably," "seems," or "appears to."]

**EVOLUTION & DECISIONS:**
[1-2 sentences about key changes and the reasoning behind them. State facts based on the commit history.]

**CODE ASSESSMENT:**
- **Necessity:** [Essential/Useful/Questionable] - [brief reason why]
- **Suggestions:** [Specific actionable improvement, or "Code is well-designed" if no issues]

IMPORTANT RULES:
- Be confident and decisive in your analysis - you have sufficient context from commits, comments, and code
- Avoid tentative language: no "likely," "probably," "seems," "appears," "might," or "could"
- Keep each section under 50 words
- Use simple sentences, avoid complex markdown
- For suggestions: either give 1-2 specific improvements OR say "Code is well-designed"
- Focus on actionable insights that help developers make decisions
- Be direct and technical, avoid fluff`;
    }

    private async executeQuery(query: string, model: string, apiKey: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const requestBody = {
            contents: [{
                parts: [{ text: query }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: this.getMaxTokensForModel(model),
            }
        };

        const response = await axios.post(url, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        let generatedText = '';
        const candidates = response.data.candidates;
        const finishReason = candidates?.[0]?.finishReason;
        
        if (candidates && candidates.length > 0) {
            if (candidates[0].content?.parts?.[0]?.text) {
                generatedText = candidates[0].content.parts[0].text;
            } else if (response.data.content?.parts?.[0]?.text) {
                generatedText = response.data.content.parts[0].text;
            }
        }
        
        if (!generatedText) {
            if (finishReason === 'MAX_TOKENS') {
                throw new Error(`Model ${model} hit the token limit before completing the response. The model may be using too many tokens for internal reasoning. Try switching to a different model or reducing the input size.`);
            }
            throw new Error(`No response generated from Gemini API for model ${model}. Try switching to a different model.`);
        }

        return generatedText;
    }

    private combineMultipleResponses(
        purposeResponse: string,
        criticalityResponse: string,
        introductionResponse: string,
        evolutionResponse: string
    ): string {
        try {
            // Parse each individual JSON response
            const purpose = this.extractJsonFromResponse(purposeResponse);
            const criticality = this.extractJsonFromResponse(criticalityResponse);
            const introduction = this.extractJsonFromResponse(introductionResponse);
            const evolution = this.extractJsonFromResponse(evolutionResponse);

            // Combine into a single response object
            const combinedResponse = {
                purpose: purpose.purpose || '',
                criticalityLevel: criticality.criticalityLevel || 'UNKNOWN',
                riskAssessment: criticality.riskAssessment || '',
                reasoning: criticality.reasoning || '',
                historicalContext: introduction.introduction || '',
                evolution: evolution.evolution || ''
            };

            return JSON.stringify(combinedResponse);
        } catch (error) {
            console.error('Failed to combine multiple responses:', error);
            // Fallback: return a combined plain text response
            return JSON.stringify({
                purpose: 'Combined analysis from multiple queries',
                criticalityLevel: 'UNKNOWN',
                riskAssessment: 'Unable to assess risk',
                reasoning: 'Multiple query combination failed',
                historicalContext: introductionResponse,
                evolution: evolutionResponse
            });
        }
    }

    private extractJsonFromResponse(response: string): any {
        try {
            let jsonString = response.trim();
            
            // Try to find JSON within the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }
            
            return JSON.parse(jsonString);
        } catch (error) {
            console.warn('Failed to parse JSON from response:', error);
            return {};
        }
    }

    private formatEnhancedResults(analysis: string, context: EnhancedCodeContext): string {
        // Context is now integrated into the criticality section, so just return the analysis
        return analysis;
    }

    private formatStructuredResponse(response: string, context: EnhancedCodeContext): string {
        try {
            // Extract JSON from the response if it contains other text
            let jsonString = response.trim();
            
            // Try to find JSON within the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            }
            
            // Try to parse as JSON
            const jsonResponse = JSON.parse(jsonString);
            
            // Format the response with proper HTML structure
            return `
<div class="code-analysis">
    <div class="analysis-section purpose-section">
        <h3>What the Code Does</h3>
        <p>${this.escapeHtml(jsonResponse.purpose || 'No purpose analysis available.')}</p>
    </div>
    
    <div class="analysis-section criticality-section">
        <h3>Criticality & Safety</h3>
        <div class="criticality-badge criticality-${(jsonResponse.criticalityLevel || 'unknown').toLowerCase()}">
            ${jsonResponse.criticalityLevel || 'UNKNOWN'}
        </div>
        <p><strong>Risk Assessment:</strong> ${this.escapeHtml(jsonResponse.riskAssessment || 'No risk assessment available.')}</p>
        <p><strong>Reasoning:</strong> ${this.escapeHtml(jsonResponse.reasoning || 'No reasoning provided.')}</p>
        ${this.formatUsageContext(context)}
    </div>
    
    <div class="analysis-section historical-section">
        <details class="historical-analysis">
            <summary>Historical Analysis</summary>
            <div class="historical-content">
                <p><strong>Introduction:</strong> ${this.escapeHtml(jsonResponse.historicalContext || 'No historical context available.')}</p>
                <p><strong>Evolution:</strong> ${this.escapeHtml(jsonResponse.evolution || 'No evolution information available.')}</p>
            </div>
        </details>
    </div>
</div>

<style>
.code-analysis {
    font-family: var(--vscode-font-family);
    line-height: 1.5;
}

.analysis-section {
    margin: 16px 0;
    padding: 16px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-background);
}

.analysis-section h3 {
    margin: 0 0 12px 0;
    color: var(--vscode-foreground);
    font-size: 16px;
    font-weight: 600;
}

.criticality-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 12px;
    margin-bottom: 12px;
    text-transform: uppercase;
}

.criticality-high {
    background-color: var(--vscode-errorForeground);
    color: var(--vscode-editor-background);
}

.criticality-medium {
    background-color: var(--vscode-notificationsWarningIcon-foreground);
    color: var(--vscode-editor-background);
}

.criticality-low {
    background-color: var(--vscode-charts-green);
    color: var(--vscode-editor-background);
}

.criticality-unknown {
    background-color: var(--vscode-descriptionForeground);
    color: var(--vscode-editor-background);
}

.historical-analysis {
    border: none;
    background: none;
    padding: 0;
    margin: 0;
}

.historical-analysis summary {
    cursor: pointer;
    padding: 4px 0;
    font-weight: 500;
    color: var(--vscode-foreground);
    list-style: none;
    outline: none;
    text-align: left;
    background: none;
    border-radius: 4px;
    display: flex;
    align-items: center;
}

.historical-analysis summary::-webkit-details-marker {
    display: none;
}

.historical-analysis summary::before {
    content: "▸";
    margin-right: 6px;
    transition: transform 0.2s ease;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    order: 1;
}

.historical-analysis summary:hover {
    background-color: var(--vscode-list-hoverBackground);
}

.historical-analysis[open] summary::before {
    transform: rotate(90deg);
}

.historical-content {
    padding: 12px 16px;
    border-left: 2px solid var(--vscode-textBlockQuote-border);
    background: var(--vscode-editor-background);
    margin-top: 0px;
    border-radius: 0 0 4px 4px;
}

.analysis-section p {
    margin: 8px 0;
    color: var(--vscode-foreground);
}

.usage-context {
    margin-top: 12px;
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    text-align: left;
    line-height: 1.4;
}
</style>`;
        } catch (parseError) {
            console.warn('Failed to parse JSON response, falling back to plain text:', parseError);
            // Fallback: return the raw response wrapped in basic formatting
            return `
<div class="code-analysis">
    <div class="analysis-section">
        <h3>Code Analysis</h3>
        <pre>${this.escapeHtml(response)}</pre>
    </div>
</div>`;
        }
    }

    private escapeHtml(text: string): string {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private formatUsageContext(context: EnhancedCodeContext): string {
        if (!context.lspContext) {
            return '';
        }

        const parts = [];
        
        // Get reference count
        if (context.lspContext.references && context.lspContext.references.references) {
            parts.push(`References: ${context.lspContext.references.references.length}`);
        }
        
        // Get call hierarchy info
        if (context.lspContext.callHierarchy) {
            const incomingCount = context.lspContext.callHierarchy.incomingCalls?.length || 0;
            
            if (incomingCount > 0) {
                parts.push(`Called by: ${incomingCount} locations`);
            }
            // Removed "Calls:" section as requested
        }
        
        // Get containing symbol info
        if (context.lspContext.symbols && context.lspContext.symbols.length > 0) {
            // Find the symbol that contains our code
            const containingSymbol = this.findContainingSymbol(context.lspContext.symbols, context.startLine, context.endLine);
            if (containingSymbol) {
                parts.push(`In: ${vscode.SymbolKind[containingSymbol.kind]} "${containingSymbol.name}"`);
            }
        }

        if (parts.length > 0) {
            return `<div class="usage-context"><strong>Usage:</strong><br>${parts.join('<br>')}</div>`;
        }
        
        return '';
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
}