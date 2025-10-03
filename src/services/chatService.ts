import * as vscode from 'vscode';
import axios from 'axios';
import { ChatContext, ChatMessage } from '../webview/chatWebviewProvider';

export class ChatService {
    private readonly maxTokens = 8192;
    private readonly temperature = 0.7;
    private static readonly API_KEY_SECRET = 'codescribe.gemini.apiKey';

    async sendMessage(
        message: string,
        mode: 'code',
        context: ChatContext[],
        previousMessages: ChatMessage[] = [],
        apiKey?: string
    ): Promise<string> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const model = config.get<string>('geminiModel', 'gemini-2.0-flash-exp');

        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Gemini API key not configured. Please run "CodeScribe: Configure API Key" command first.');
        }

        const prompt = this._buildPrompt(message, mode, context, previousMessages);

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
                        maxOutputTokens: this.maxTokens,
                        temperature: this.temperature,
                        topP: 0.8,
                        topK: 40
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!generatedText) {
                throw new Error('No response generated from AI service');
            }

            return generatedText;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 400) {
                    throw new Error('Invalid request to AI service. Please check your input.');
                } else if (error.response?.status === 401) {
                    throw new Error('Invalid API key. Please check your Gemini API key in settings.');
                } else if (error.response?.status === 429) {
                    throw new Error('Rate limit exceeded. Please try again in a moment.');
                } else {
                    throw new Error(`AI service error: ${error.response?.statusText || error.message}`);
                }
            }
            throw error;
        }
    }

    private _buildPrompt(
        message: string,
        mode: 'code',
        context: ChatContext[],
        previousMessages: ChatMessage[]
    ): string {
        let prompt = this._buildCodePrompt();

        // Add context if available
        if (context.length > 0) {
            prompt += '\n\n**AVAILABLE CONTEXT:**\n';
            context.forEach((ctx, index) => {
                prompt += `\n### Context ${index + 1}: ${ctx.title} (${ctx.type})\n`;
                if (ctx.filePath) {
                    prompt += `File: ${ctx.filePath}\n`;
                }
                if (ctx.startLine && ctx.endLine) {
                    prompt += `Lines: ${ctx.startLine}-${ctx.endLine}\n`;
                }
                prompt += `\`\`\`\n${ctx.content}\n\`\`\`\n`;
            });
        }

        // Add conversation history (last 5 messages to keep context manageable)
        if (previousMessages.length > 0) {
            prompt += '\n\n**CONVERSATION HISTORY:**\n';
            const recentMessages = previousMessages.slice(-5);
            recentMessages.forEach(msg => {
                const role = msg.role === 'user' ? 'Human' : 'Assistant';
                prompt += `\n${role}: ${msg.content}\n`;
            });
        }

        // Add current user message
        prompt += `\n\n**CURRENT QUESTION:**\n${message}\n\n`;

        prompt += this._getResponseGuidelines();

        return prompt;
    }

    private _buildCodePrompt(): string {
        return `You are CodeScribe, an expert software engineering assistant specializing in code analysis, debugging, and development guidance. You help developers understand, improve, and work with their code.

**YOUR CAPABILITIES:**
- Code review and analysis
- Debugging assistance
- Best practices recommendations
- Performance optimization
- Architecture guidance
- Bug identification and fixes
- Code explanation and documentation
- Testing strategies
- Refactoring suggestions

**YOUR PERSONALITY:**
- Helpful and knowledgeable
- Clear and concise in explanations
- Practical and actionable advice
- Patient with developers of all skill levels
- Focus on code quality and maintainability`;
    }

    private _getResponseGuidelines(): string {
        const baseGuidelines = `
**RESPONSE GUIDELINES:**
- Provide clear, actionable answers
- Use code examples when helpful
- Reference the provided context when relevant
- Ask clarifying questions if the request is ambiguous
- Suggest next steps or follow-up actions
- Keep responses concise but comprehensive`;

        return baseGuidelines;
    }
}
