import * as vscode from 'vscode';
import axios from 'axios';
import { ChatContext, ChatMessage } from '../webview/chatWebviewProvider';

export class ChatService {
    private readonly maxTokens = 8192;
    private readonly temperature = 0.7;
    
    constructor(private readonly context?: vscode.ExtensionContext) {}

    private async getSelectedModel(provider: string): Promise<string> {
        if (!this.context) {
            // Fallback to config if no context available
            const config = vscode.workspace.getConfiguration('codescribe');
            switch (provider) {
                case 'gemini': return config.get<string>('geminiModel', 'gemini-2.0-flash-exp');
                case 'openai': return config.get<string>('openaiModel', 'gpt-4o-mini');
                case 'claude': return config.get<string>('claudeModel', 'claude-sonnet-4-20250514');
                case 'huggingface': return config.get<string>('huggingfaceModel', 'microsoft/DialoGPT-large');
                default: return 'unknown';
            }
        }

        // Get from global state (preferred method)
        const storedModel = await this.context.globalState.get(`codescribe.model.${provider}`) as string;
        if (storedModel) {
            return storedModel;
        }

        // Fallback to defaults if not found in global state
        switch (provider) {
            case 'gemini': return 'gemini-2.0-flash-exp';
            case 'openai': return 'gpt-4o-mini';
            case 'claude': return 'claude-sonnet-4-20250514';
            case 'huggingface': return 'microsoft/DialoGPT-large';
            default: return 'unknown';
        }
    }

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

        const prompt = this._buildPrompt(message, context, previousMessages);

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

    async sendMessageStream(
        message: string,
        mode: 'code',
        context: ChatContext[],
        previousMessages: ChatMessage[] = [],
        apiKey: string,
        onToken: (token: string) => void,
        onComplete?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const provider = config.get<string>('aiProvider', 'gemini');

        if (!apiKey || apiKey.trim() === '') {
            const error = new Error(`${provider} API key not configured. Please run "CodeScribe: Configure API Key" command first.`);
            onError?.(error);
            return;
        }

        const prompt = this._buildPrompt(message, context, previousMessages);

        try {
            await this.executeProviderStreamQuery(provider, prompt, apiKey, onToken, onComplete, onError);
        } catch (error) {
            const processedError = this._processError(error as any, provider);
            onError?.(processedError);
        }
    }

    private _processError(error: any, provider: string): Error {
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 400) {
                return new Error('Invalid request to AI service. Please check your input.');
            } else if (error.response?.status === 401) {
                return new Error(`Invalid API key. Please check your ${provider} API key in settings.`);
            } else if (error.response?.status === 429) {
                return new Error('Rate limit exceeded. Please try again in a moment.');
            } else {
                return new Error(`AI service error: ${error.response?.statusText || error.message}`);
            }
        }
        return error;
    }

    private async executeProviderQuery(provider: string, prompt: string, apiKey: string): Promise<string> {
        const model = await this.getSelectedModel(provider);
        
        switch (provider) {
            case 'gemini':
                return this.executeGeminiQuery(prompt, model, apiKey);
            case 'openai':
                return this.executeOpenAIQuery(prompt, model, apiKey);
            case 'claude':
                return this.executeClaudeQuery(prompt, model, apiKey);
            case 'huggingface':
                if (!model || model.trim() === '') {
                    throw new Error('Hugging Face model ID is required. Please configure a model in settings (e.g., "microsoft/DialoGPT-large").');
                }
                return this.executeHuggingFaceQuery(prompt, model, apiKey);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    private async executeProviderStreamQuery(
        provider: string,
        prompt: string,
        apiKey: string,
        onToken: (token: string) => void,
        onComplete?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        const model = await this.getSelectedModel(provider);
        
        switch (provider) {
            case 'gemini':
                return this.executeGeminiStreamQuery(prompt, model, apiKey, onToken, onComplete, onError);
            case 'openai':
                return this.executeOpenAIStreamQuery(prompt, model, apiKey, onToken, onComplete, onError);
            case 'claude':
                return this.executeClaudeStreamQuery(prompt, model, apiKey, onToken, onComplete, onError);
            case 'huggingface':
                // Hugging Face streaming not implemented yet, fallback to regular query
                try {
                    if (!model || model.trim() === '') {
                        throw new Error('Hugging Face model ID is required. Please configure a model in settings (e.g., "microsoft/DialoGPT-large").');
                    }
                    const response = await this.executeHuggingFaceQuery(prompt, model, apiKey);
                    onToken(response);
                    onComplete?.();
                } catch (error) {
                    onError?.(error as Error);
                }
                break;
            default:
                onError?.(new Error(`Unsupported provider: ${provider}`));
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

    private async executeGeminiStreamQuery(
        prompt: string, 
        model: string, 
        apiKey: string, 
        onToken: (token: string) => void,
        onComplete?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        try {
            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`,
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
                    responseType: 'stream',
                    timeout: 30000
                }
            );

            let buffer = '';
            
            response.data.on('data', (chunk: Buffer) => {
                const chunkStr = chunk.toString();
                buffer += chunkStr;
                
                // Gemini streams an array of JSON objects, split by lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || trimmedLine === '[' || trimmedLine === ']' || trimmedLine === ',') {
                        continue;
                    }
                    
                    let jsonString = trimmedLine;
                    
                    // Remove leading comma if present (array elements)
                    if (jsonString.startsWith(',')) {
                        jsonString = jsonString.slice(1).trim();
                    }
                    
                    // Remove trailing comma if present
                    if (jsonString.endsWith(',')) {
                        jsonString = jsonString.slice(0, -1).trim();
                    }
                    
                    // Check if this line contains text content
                    if (jsonString.includes('"text":')) {
                        try {
                            // Extract text content from the line
                            const textMatch = jsonString.match(/"text":\s*"([^"\\]*(\\.[^"\\]*)*)"/);
                            if (textMatch && textMatch[1]) {
                                // Unescape the JSON string
                                const text = textMatch[1]
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\t/g, '\t')
                                    .replace(/\\"/g, '"')
                                    .replace(/\\\\/g, '\\');
                                    
                                onToken(text);
                            }
                        } catch (parseError) {
            
                        }
                    }
                }
            });

            response.data.on('end', () => {
                onComplete?.();
            });

            response.data.on('error', (error: Error) => {
                console.error('Gemini stream error:', error);
                onError?.(error);
            });

        } catch (error) {
            console.error('Gemini streaming request failed:', error);
            onError?.(error as Error);
        }
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

    private async executeOpenAIStreamQuery(
        prompt: string, 
        model: string, 
        apiKey: string, 
        onToken: (token: string) => void,
        onComplete?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        try {
            // Check if this is a GPT-5 model and warn about potential availability issues
            if (this.isGPT5Model(model)) {

            }

            const requestBody = {
                model: model,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
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
                    responseType: 'stream',
                    timeout: 30000
                }
            );

            let buffer = '';
            response.data.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim().startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === '[DONE]') {
                            onComplete?.();
                            return;
                        }
                        try {
                            const data = JSON.parse(jsonStr);
                            const content = data.choices?.[0]?.delta?.content;
                            if (content) {
                                onToken(content);
                            }
                        } catch (parseError) {

                        }
                    }
                }
            });

            response.data.on('end', () => {
                onComplete?.();
            });

            response.data.on('error', (error: Error) => {
                onError?.(error);
            });

        } catch (error) {
            console.error('OpenAI streaming request failed:', error);
            if (axios.isAxiosError(error) && error.response) {
                // For streaming responses, we need to read the response body differently
                let errorBody = '';
                try {
                    if (error.response.data && typeof error.response.data.read === 'function') {
                        // It's a readable stream
                        const chunks: Buffer[] = [];
                        error.response.data.on('data', (chunk: Buffer) => chunks.push(chunk));
                        error.response.data.on('end', () => {
                            errorBody = Buffer.concat(chunks).toString();
                            console.error('OpenAI error response body:', errorBody);
                        });
                    } else {
                        try {
                            errorBody = JSON.stringify(error.response.data);
                            console.error('OpenAI error response:', errorBody);
                        } catch (jsonError) {
                            console.error('OpenAI error response (non-JSON):', error.response.data);
                            errorBody = '[Complex object - see console]';
                        }
                    }
                } catch (parseError) {
                    console.error('Failed to parse OpenAI error response:', parseError);
                }
                
                // Check if this is a GPT-5 streaming verification error
                // We can see from the console log that this is the specific error we're looking for
                if (error.response.status === 400 && this.isGPT5Model(model)) {
                    
                    // Fallback to non-streaming mode for GPT-5 models
                    try {
                        const response = await this.executeOpenAIQuery(prompt, model, apiKey);
                        // Simulate streaming by sending the full response at once
                        onToken(response);
                        onComplete?.();
                        return;
                    } catch (fallbackError) {
                        console.error('GPT-5 non-streaming fallback also failed:', fallbackError);
                        onError?.(new Error(`GPT-5 model ${model} requires organization verification for streaming. Non-streaming mode also failed. Please verify your organization at https://platform.openai.com/settings/organization/general or use GPT-4o models instead.`));
                        return;
                    }
                }
                
                // Create a more specific error message based on status and any available info
                let errorMessage = `OpenAI API error (${error.response.status})`;
                if (error.response.status === 400) {
                    if (this.isGPT5Model(model)) {
                        errorMessage += `: The ${model} model streaming requires organization verification. Please verify at https://platform.openai.com/settings/organization/general or use GPT-4o models instead.`;
                    } else {
                        errorMessage += ': Invalid request. This could be due to an unsupported model or request format.';
                    }
                } else if (error.response.status === 404) {
                    errorMessage += ': Model not found. The specified model may not be available for your account.';
                }
                onError?.(new Error(errorMessage));
            } else {
                onError?.(error as Error);
            }
        }
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

    private async executeClaudeStreamQuery(
        prompt: string, 
        model: string, 
        apiKey: string, 
        onToken: (token: string) => void,
        onComplete?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: model,
                    max_tokens: this.maxTokens,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: this.temperature,
                    stream: true
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    responseType: 'stream',
                    timeout: 30000
                }
            );

            let buffer = '';
            response.data.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim().startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === '[DONE]') {
                            onComplete?.();
                            return;
                        }
                        try {
                            const data = JSON.parse(jsonStr);
                            if (data.type === 'content_block_delta' && data.delta?.text) {
                                onToken(data.delta.text);
                            } else if (data.type === 'message_stop') {
                                onComplete?.();
                                return;
                            }
                        } catch (parseError) {

                        }
                    }
                }
            });

            response.data.on('end', () => {
                onComplete?.();
            });

            response.data.on('error', (error: Error) => {
                onError?.(error);
            });

        } catch (error) {
            onError?.(error as Error);
        }
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
