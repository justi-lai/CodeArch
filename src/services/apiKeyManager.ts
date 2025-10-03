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

export class ApiKeyManager {
    private static readonly GEMINI_API_KEY_SECRET = 'codescribe.geminiApiKey';
    private static readonly OPENAI_API_KEY_SECRET = 'codescribe.openaiApiKey';
    private static readonly CLAUDE_API_KEY_SECRET = 'codescribe.claudeApiKey';
    private static readonly HUGGINGFACE_API_KEY_SECRET = 'codescribe.huggingfaceApiKey';

    constructor(private context: vscode.ExtensionContext) {}

    async hasApiKey(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const provider = config.get<string>('aiProvider', 'gemini');
        const apiKey = await this.getProviderApiKey(provider);
        return !!apiKey;
    }

    async getApiKey(): Promise<string> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const provider = config.get<string>('aiProvider', 'gemini');
        const apiKey = await this.getProviderApiKey(provider);
        
        if (!apiKey) {
            throw new Error(`No ${provider} API key configured. Please run "CodeScribe: Configure API Key" command.`);
        }
        return apiKey;
    }

    private async getProviderApiKey(provider: string): Promise<string | undefined> {
        switch (provider) {
            case 'gemini':
                return await this.context.secrets.get(ApiKeyManager.GEMINI_API_KEY_SECRET);
            case 'openai':
                return await this.context.secrets.get(ApiKeyManager.OPENAI_API_KEY_SECRET);
            case 'claude':
                return await this.context.secrets.get(ApiKeyManager.CLAUDE_API_KEY_SECRET);
            case 'huggingface':
                return await this.context.secrets.get(ApiKeyManager.HUGGINGFACE_API_KEY_SECRET);
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    async configureApiKey(): Promise<void> {
        const config = vscode.workspace.getConfiguration('codescribe');

        // Let user choose AI provider
        const provider = await vscode.window.showQuickPick([
            {
                label: 'Gemini',
                description: 'Google AI Studio (recommended)',
                detail: 'Free tier available, excellent for code analysis',
                value: 'gemini'
            },
            {
                label: 'OpenAI',
                description: 'GPT-4 and other OpenAI models',
                detail: 'Requires paid API access',
                value: 'openai'
            },
            {
                label: 'Claude',
                description: 'Anthropic Claude models',
                detail: 'Requires paid API access',
                value: 'claude'
            },
            {
                label: 'Hugging Face',
                description: 'Open source models',
                detail: 'Free inference API with rate limits',
                value: 'huggingface'
            }
        ], {
            placeHolder: 'Select your AI provider',
            ignoreFocusOut: true
        });

        if (!provider) {
            return;
        }

        // Update provider configuration
        await config.update('aiProvider', provider.value, vscode.ConfigurationTarget.Global);

        // Get API key with provider-specific validation
        const apiKey = await this.getProviderApiKeyInput(provider.value);

        if (!apiKey) {
            return;
        }

        // Store the API key securely
        await this.storeProviderApiKey(provider.value, apiKey);

        vscode.window.showInformationMessage(
            `${provider.label} API key configured successfully!`
        );
    }

    private async getProviderApiKeyInput(provider: string): Promise<string | undefined> {
        const prompts = {
            gemini: {
                prompt: 'Enter your Google AI Studio API key (get it from https://makersuite.google.com/app/apikey)',
                placeholder: 'AIza...',
                validator: (value: string) => {
                    if (!value || value.trim().length === 0) return 'API key cannot be empty';
                    if (!value.startsWith('AIza')) return 'Google AI Studio API keys typically start with "AIza"';
                    if (value.length < 30) return 'API key seems too short';
                    return undefined;
                }
            },
            openai: {
                prompt: 'Enter your OpenAI API key (get it from https://platform.openai.com/api-keys)',
                placeholder: 'sk-...',
                validator: (value: string) => {
                    if (!value || value.trim().length === 0) return 'API key cannot be empty';
                    if (!value.startsWith('sk-')) return 'OpenAI API keys start with "sk-"';
                    if (value.length < 40) return 'API key seems too short';
                    return undefined;
                }
            },
            claude: {
                prompt: 'Enter your Anthropic Claude API key (get it from https://console.anthropic.com/)',
                placeholder: 'sk-ant-...',
                validator: (value: string) => {
                    if (!value || value.trim().length === 0) return 'API key cannot be empty';
                    if (!value.startsWith('sk-ant-')) return 'Claude API keys start with "sk-ant-"';
                    if (value.length < 40) return 'API key seems too short';
                    return undefined;
                }
            },
            huggingface: {
                prompt: 'Enter your Hugging Face API token (get it from https://huggingface.co/settings/tokens)',
                placeholder: 'hf_...',
                validator: (value: string) => {
                    if (!value || value.trim().length === 0) return 'API token cannot be empty';
                    if (!value.startsWith('hf_')) return 'Hugging Face tokens start with "hf_"';
                    if (value.length < 30) return 'API token seems too short';
                    return undefined;
                }
            }
        };

        const config = (prompts as any)[provider];
        if (!config) {
            throw new Error(`Unknown provider: ${provider}`);
        }

        return await vscode.window.showInputBox({
            prompt: config.prompt,
            placeHolder: config.placeholder,
            password: true,
            ignoreFocusOut: true,
            validateInput: config.validator
        });
    }

    private async storeProviderApiKey(provider: string, apiKey: string): Promise<void> {
        switch (provider) {
            case 'gemini':
                await this.context.secrets.store(ApiKeyManager.GEMINI_API_KEY_SECRET, apiKey.trim());
                break;
            case 'openai':
                await this.context.secrets.store(ApiKeyManager.OPENAI_API_KEY_SECRET, apiKey.trim());
                break;
            case 'claude':
                await this.context.secrets.store(ApiKeyManager.CLAUDE_API_KEY_SECRET, apiKey.trim());
                break;
            case 'huggingface':
                await this.context.secrets.store(ApiKeyManager.HUGGINGFACE_API_KEY_SECRET, apiKey.trim());
                break;
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    async clearApiKey(): Promise<void> {
        const config = vscode.workspace.getConfiguration('codescribe');
        const provider = config.get<string>('aiProvider', 'gemini');
        
        switch (provider) {
            case 'gemini':
                await this.context.secrets.delete(ApiKeyManager.GEMINI_API_KEY_SECRET);
                break;
            case 'openai':
                await this.context.secrets.delete(ApiKeyManager.OPENAI_API_KEY_SECRET);
                break;
            case 'claude':
                await this.context.secrets.delete(ApiKeyManager.CLAUDE_API_KEY_SECRET);
                break;
            case 'huggingface':
                await this.context.secrets.delete(ApiKeyManager.HUGGINGFACE_API_KEY_SECRET);
                break;
        }
        
        vscode.window.showInformationMessage(`${provider} API key cleared successfully.`);
    }

    getModelName(): string {
        const config = vscode.workspace.getConfiguration('codescribe');
        const provider = config.get<string>('aiProvider', 'gemini');
        
        switch (provider) {
            case 'gemini':
                return config.get<string>('geminiModel', 'gemini-2.0-flash-exp');
            case 'openai':
                return config.get<string>('openaiModel', 'gpt-4o');
            case 'claude':
                return config.get<string>('claudeModel', 'claude-3-5-sonnet-20241022');
            case 'huggingface':
                return config.get<string>('huggingfaceModel', 'microsoft/DialoGPT-large');
            default:
                return 'unknown';
        }
    }
}