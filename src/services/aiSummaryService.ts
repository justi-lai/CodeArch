import axios from 'axios';
import * as vscode from 'vscode';
import { GitAnalysisResult } from '../types';

export class AiSummaryService {
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
}