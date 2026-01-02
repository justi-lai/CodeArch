/*
 * Copyright (c) 2026 Justin Lai
 * Licensed under the MIT License.
 */

import * as vscode from 'vscode';

export type AIProvider = 'gemini' | 'openai' | 'claude' | 'custom';

export interface AIConfig {
    provider: AIProvider;
    model: string;
    apiKey?: string;
    customUrl?: string;
}

export class SecretsManager {
    private readonly SECRET_KEY_PREFIX = 'codearch.apikey.';
    private readonly PROVIDER_SETTING = 'codearch.provider';
    private readonly MODEL_SETTING = 'codearch.model';

    constructor(private context: vscode.ExtensionContext) { }

    public async getApiKey(provider: AIProvider): Promise<string | undefined> {
        return await this.context.secrets.get(`${this.SECRET_KEY_PREFIX}${provider}`);
    }

    public async storeApiKey(provider: AIProvider, key: string): Promise<void> {
        await this.context.secrets.store(`${this.SECRET_KEY_PREFIX}${provider}`, key);
    }

    public async deleteApiKey(provider: AIProvider): Promise<void> {
        await this.context.secrets.delete(`${this.SECRET_KEY_PREFIX}${provider}`);
    }

    public getSelectedProvider(): AIProvider {
        return this.context.globalState.get<AIProvider>(this.PROVIDER_SETTING, 'gemini');
    }

    public async setSelectedProvider(provider: AIProvider): Promise<void> {
        await this.context.globalState.update(this.PROVIDER_SETTING, provider);
    }

    public getSelectedModel(): string {
        const provider = this.getSelectedProvider();
        if (provider === 'custom') {
            return this.context.globalState.get<string>('codearch.customModel', 'local-model');
        }
        const defaultModel = this.getDefaultModelForProvider(provider);
        return this.context.globalState.get<string>(this.MODEL_SETTING, defaultModel);
    }

    public async setSelectedModel(model: string): Promise<void> {
        const provider = this.getSelectedProvider();
        if (provider === 'custom') {
            await this.context.globalState.update('codearch.customModel', model);
        } else {
            await this.context.globalState.update(this.MODEL_SETTING, model);
        }
    }

    public getCustomUrl(): string {
        return this.context.globalState.get<string>('codearch.customUrl', 'http://localhost:11434/v1');
    }

    public async setCustomUrl(url: string): Promise<void> {
        await this.context.globalState.update('codearch.customUrl', url);
    }

    public async getConfig(): Promise<AIConfig> {
        const provider = this.getSelectedProvider();
        const model = this.getSelectedModel();
        const apiKey = await this.getApiKey(provider);
        const customUrl = this.getCustomUrl();

        return { provider, model, apiKey, customUrl };
    }

    public async promptForApiKey(provider: AIProvider): Promise<string | undefined> {
        const key = await vscode.window.showInputBox({
            prompt: `Enter your API Key for ${provider.toUpperCase()}`,
            password: true,
            placeHolder: 'Paste API key here...'
        });

        if (key) {
            await this.storeApiKey(provider, key);
            vscode.window.showInformationMessage(`API Key for ${provider.toUpperCase()} saved successfully.`);
            return key;
        }
        return undefined;
    }

    private getDefaultModelForProvider(provider: AIProvider): string {
        switch (provider) {
            case 'gemini': return 'gemini-1.5-pro';
            case 'openai': return 'gpt-4o';
            case 'claude': return 'claude-3-5-sonnet-latest';
            case 'custom': return 'local-model';
            default: return '';
        }
    }
}
