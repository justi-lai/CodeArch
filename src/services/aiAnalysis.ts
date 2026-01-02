import { AIConfig } from "./secretsManager";
import { CommitRecord } from "./gitAnalysis";
import { EnclosingScope } from "./treesitterAnalysis";

/*
 * Copyright (c) 2026 Justin Lai
 * Licensed under the MIT License.
 */

export interface AIAnalysisResult {
    intent: string;
    analysis: string;
    risk: string;
    verdict: string;
}

export class AIAnalysis {
    constructor() { }

    public async analyze(
        config: AIConfig,
        documentText: string,
        relativePath: string,
        lineRange: { start: number, end: number },
        commits: CommitRecord[],
        scopes: EnclosingScope[],
        references: string[]
    ): Promise<AIAnalysisResult> {
        if (config.provider !== 'custom' && !config.apiKey) {
            throw new Error(`API Key for ${config.provider} is not configured.`);
        }

        const prompt = this.constructPrompt(
            documentText,
            relativePath,
            lineRange,
            commits,
            scopes,
            references
        );

        let rawResponse = "";
        switch (config.provider) {
            case 'gemini':
                rawResponse = await this.callGemini(config.apiKey!, config.model, prompt);
                break;
            case 'openai':
                rawResponse = await this.callOpenAI(config.apiKey!, config.model, prompt);
                break;
            case 'claude':
                rawResponse = await this.callClaude(config.apiKey!, config.model, prompt);
                break;
            case 'custom':
                rawResponse = await this.callCustom(config.apiKey, config.customUrl, config.model, prompt);
                break;
            default:
                throw new Error(`Unsupported provider: ${config.provider}`);
        }

        return this.parseResponse(rawResponse);
    }

    private parseResponse(raw: string): AIAnalysisResult {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    intent: parsed.intent || "No intent detected.",
                    analysis: parsed.analysis || "No logic analysis provided.",
                    risk: parsed.risk || "No risk assessment provided.",
                    verdict: parsed.verdict || "No verdict reached."
                };
            } catch (e) {
                console.error("Failed to parse AI JSON response:", e);
            }
        }

        return {
            intent: "Failed to parse structured intent.",
            analysis: "Failed to parse structured analysis.",
            risk: "Failed to parse structured risk.",
            verdict: raw
        };
    }

    private constructPrompt(
        documentText: string,
        relativePath: string,
        lineRange: { start: number, end: number },
        commits: CommitRecord[],
        scopes: EnclosingScope[],
        references: string[]
    ): string {
        const targetCode = this.extractTargetCode(documentText, lineRange);
        const scoopContext = scopes.map(s => `${s.type.replace('_', ' ')}: ${s.name}`).join(' -> ');

        let historyEvidence = commits.map(c => {
            return `Commit: ${c.hash.substring(0, 7)}
Author: ${c.author}
Date: ${c.date}
Message: "${c.message}"
Diff:
${c.lineRangeDiff}`;
        }).join('\n\n---\n\n');

        let usageStats = references.length > 0
            ? `ACTIVE USAGE: Found ${references.length} project-wide reference(s). Some locations include:\n${references.slice(0, 10).map(r => `- ${r}`).join('\n')}${references.length > 10 ? `\n...and ${references.length - 10} more places.` : ''}`
            : "ORPHANED CODE: This code has 0 project-wide references. It is not being called anywhere else in the workspace.";

        return `### SYSTEM ROLE
You are a senior code auditor. Synthesize code, history, and usage data into a structured audit.

### 1. THE CODE (CURRENT STATE)
File: ${relativePath}
Context: ${scoopContext}
Target Range: Lines ${lineRange.start} to ${lineRange.end}

Code Snapshot (">" indicates target lines):
${targetCode}

### 2. THE HISTORY (EVIDENCE)
${historyEvidence}

### 3. THE USAGE (BLAST RADIUS)
${usageStats}

### YOUR TASK
Respond ONLY with a JSON object containing the following keys (values should be valid Markdown strings):
{
  "intent": "Why does this line exist? Focus on the hidden intent discovered through the git history compared to the current code.",
  "analysis": "Identify code smells, accidental remains of temporary fixes (e.g., 'hack', 'temporary workaround'), forgotten debug logic, or inconsistencies between the history and current implementation.",
  "risk": "What is the risk or technical debt associated with this line, considering its current usage?",
  "verdict": "A concise one-sentence conclusion (e.g., 'Refactor suggested to clarify intent', or 'Risk is low but watch for side effects')."
}`;
    }

    private extractTargetCode(text: string, range: { start: number, end: number }): string {
        const lines = text.split('\n');
        const start = Math.max(0, range.start - 6);
        const end = Math.min(lines.length, range.end + 6);

        return lines.slice(start, end).map((line, i) => {
            const actualLineNum = start + i + 1;
            const isTarget = actualLineNum >= range.start && actualLineNum <= range.end;
            const prefix = isTarget ? '>' : ' ';
            return `${prefix} ${actualLineNum.toString().padStart(4)} | ${line}`;
        }).join('\n');
    }

    private async callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            })
        });

        if (!response.ok) {
            const err: any = await response.json();
            throw new Error(`Gemini API error: ${err.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    private async callOpenAI(apiKey: string, model: string, prompt: string): Promise<string> {
        const url = `https://api.openai.com/v1/chat/completions`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const err: any = await response.json();
            throw new Error(`OpenAI API error: ${err.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        return data.choices[0].message.content;
    }

    private async callClaude(apiKey: string, model: string, prompt: string): Promise<string> {
        const url = `https://api.anthropic.com/v1/messages`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Claude API error: ${err.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        return data.content[0].text;
    }

    private async callCustom(apiKey: string | undefined, baseUrl: string | undefined, model: string, prompt: string): Promise<string> {
        let cleanBaseUrl = (baseUrl || 'http://localhost:11434/v1').trim();
        if (cleanBaseUrl.endsWith('/')) {
            cleanBaseUrl = cleanBaseUrl.slice(0, -1);
        }

        const url = cleanBaseUrl.endsWith('/chat/completions')
            ? cleanBaseUrl
            : `${cleanBaseUrl}/chat/completions`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const err: any = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(`Custom LLM API error: ${err.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        return data.choices[0].message.content;
    }
}
