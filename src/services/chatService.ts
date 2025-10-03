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
        const provider = config.get<string>('aiProvider', 'gemini');

        if (!apiKey || apiKey.trim() === '') {
            throw new Error(`${provider} API key not configured. Please run "CodeScribe: Configure API Key" command first.`);
        }

        const prompt = this._buildPrompt(message, mode, context, previousMessages);

        try {
            return await this.executeProviderQuery(provider, prompt, apiKey);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 400) {
                    throw new Error('Invalid request to AI service. Please check your input.');
                } else if (error.response?.status === 401) {
                    throw new Error(`Invalid API key. Please check your ${provider} API key in settings.`);
                } else if (error.response?.status === 429) {
                    throw new Error('Rate limit exceeded. Please try again in a moment.');
                } else {
                    throw new Error(`AI service error: ${error.response?.statusText || error.message}`);
                }
            }
            throw error;
        }
    }

    private async executeProviderQuery(provider: string, prompt: string, apiKey: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('codescribe');
        
        switch (provider) {
            case 'gemini':
                return this.executeGeminiQuery(prompt, config.get<string>('geminiModel', 'gemini-1.5-pro'), apiKey);
            case 'openai':
                return this.executeOpenAIQuery(prompt, config.get<string>('openaiModel', 'gpt-4o-mini'), apiKey);
            case 'claude':
                return this.executeClaudeQuery(prompt, config.get<string>('claudeModel', 'claude-3-5-sonnet-20241022'), apiKey);
            case 'huggingface':
                const model = config.get<string>('huggingfaceModel');
                if (!model || model.trim() === '') {
                    throw new Error('Hugging Face model ID is required. Please configure a model in settings (e.g., "microsoft/DialoGPT-large").');
                }
                return this.executeHuggingFaceQuery(prompt, model, apiKey);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    private async executeGeminiQuery(prompt: string, model: string, apiKey: string): Promise<string> {
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
            throw new Error('No response generated from Gemini');
        }

        return generatedText;
    }

    private async executeOpenAIQuery(prompt: string, model: string, apiKey: string): Promise<string> {
        const requestBody = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            ...(this.isGPT5Model(model) 
                ? { 
                    max_completion_tokens: this.maxTokens
                    // GPT-5 models only support default temperature of 1
                }
                : { 
                    temperature: this.temperature,
                    max_tokens: this.maxTokens 
                }
            )
        };

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 30000
            }
        );

        const generatedText = response.data.choices?.[0]?.message?.content;
        
        if (!generatedText) {
            throw new Error('No response generated from OpenAI');
        }

        return generatedText;
    }

    private async executeClaudeQuery(prompt: string, model: string, apiKey: string): Promise<string> {
        const response = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
                model: model,
                max_tokens: this.maxTokens,
                messages: [{ role: 'user', content: prompt }],
                temperature: this.temperature
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                timeout: 30000
            }
        );

        const generatedText = response.data.content?.[0]?.text;
        
        if (!generatedText) {
            throw new Error('No response generated from Claude');
        }

        return generatedText;
    }

    private async executeHuggingFaceQuery(prompt: string, model: string, apiKey: string): Promise<string> {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${model}`,
            {
                inputs: prompt,
                parameters: {
                    temperature: this.temperature,
                    max_new_tokens: 1000,
                    return_full_text: false
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 30000
            }
        );

        let generatedText = '';
        
        if (Array.isArray(response.data) && response.data.length > 0) {
            generatedText = response.data[0].generated_text || response.data[0].text || '';
        } else if (response.data.generated_text) {
            generatedText = response.data.generated_text;
        }
        
        if (!generatedText) {
            throw new Error('No response generated from Hugging Face');
        }

        return generatedText;
    }

    private isGPT5Model(model: string): boolean {
        return model.startsWith('gpt-5');
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
