import * as vscode from 'vscode';
import { DependencyValidator } from './services/dependencyValidator';
import { ApiKeyManager } from './services/apiKeyManager';
import { CodeScribeWebviewProvider } from './webview/codescribeWebviewProvider';
import { ChatWebviewProvider } from './webview/chatWebviewProvider';
import { GitAnalysisEngine } from './services/gitAnalysisEngine';
import { AiSummaryService } from './services/aiSummaryService';
import { ErrorHandler, UserFeedback } from './services/errorHandler';

export function activate(context: vscode.ExtensionContext) {

    // Initialize services
    const dependencyValidator = new DependencyValidator();
    const apiKeyManager = new ApiKeyManager(context);
    const gitAnalysisEngine = new GitAnalysisEngine();
    const aiSummaryService = new AiSummaryService(context);
    const webviewProvider = new CodeScribeWebviewProvider(context.extensionUri);
    const chatWebviewProvider = new ChatWebviewProvider(context.extensionUri, apiKeyManager, webviewProvider, context);

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'codescribe.resultsView',
            webviewProvider
        )
    );
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'codescribe.chatView',
            chatWebviewProvider
        )
    );

    // Register commands
    const showChatCommand = vscode.commands.registerCommand(
        'codescribe.showChat',
        async () => {
            // Focus on the chat view to expand it
            await vscode.commands.executeCommand('codescribe.chatView.focus');
        }
    );

    const hideChatCommand = vscode.commands.registerCommand(
        'codescribe.hideChat',
        async () => {
            // Focus on results view to collapse chat
            await vscode.commands.executeCommand('codescribe.resultsView.focus');
        }
    );

    const addToChatCommand = vscode.commands.registerCommand(
        'codescribe.addToChat',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor found.');
                return;
            }

            const selection = editor.selection;
            if (selection.isEmpty) {
                vscode.window.showErrorMessage('Please select a block of code to add to chat.');
                return;
            }

            const document = editor.document;
            const selectedText = document.getText(selection);
            const filePath = document.fileName;
            const startLine = selection.start.line + 1;
            const endLine = selection.end.line + 1;

            // Add context to chat
            chatWebviewProvider.addContext({
                id: Date.now().toString(),
                type: 'code',
                content: selectedText,
                filePath,
                startLine,
                endLine,
                timestamp: new Date(),
                title: `Code from ${filePath.split('/').pop()} (${startLine}-${endLine})`
            });

            // Show chat panel
            await vscode.commands.executeCommand('codescribe.chatView.focus');
        }
    );

    const analyzeSelectionCommand = vscode.commands.registerCommand(
        'codescribe.analyzeSelection',
        async () => {
            try {
                // Validate dependencies first
                const dependenciesValid = await dependencyValidator.validateDependencies();
                if (!dependenciesValid) {
                    return;
                }

                // Check if API key is configured
                const hasApiKey = await apiKeyManager.hasApiKey();
                if (!hasApiKey) {
                    const configure = await vscode.window.showInformationMessage(
                        'CodeScribe requires a Gemini API key to generate summaries.',
                        'Configure Gemini API Key'
                    );
                    if (configure) {
                        await vscode.commands.executeCommand('codescribe.configureApiKey');
                        // Check again if user actually configured it
                        const hasApiKeyAfterConfig = await apiKeyManager.hasApiKey();
                        if (!hasApiKeyAfterConfig) {
                            return;
                        }
                    } else {
                        return;
                    }
                }

                // Get active editor and selection
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor found.');
                    return;
                }

                const selection = editor.selection;
                if (selection.isEmpty) {
                    vscode.window.showErrorMessage('Please select a block of code to analyze.');
                    return;
                }

                // Show progress
                await UserFeedback.showProgress(
                    'CodeScribe: Analyzing code history...',
                    async (progress, token) => {
                    try {
                        const document = editor.document;
                        const selectedText = document.getText(selection);
                        const filePath = document.fileName;
                        const startLine = selection.start.line + 1; // Convert to 1-based
                        const endLine = selection.end.line + 1;

                        progress.report({ increment: 20, message: 'Analyzing git history...' });

                        // Analyze git history
                        const analysisResult = await gitAnalysisEngine.analyzeSelection(
                            filePath,
                            startLine,
                            endLine
                        );

                        if (token.isCancellationRequested) {
                            return;
                        }

                        progress.report({ increment: 40, message: 'Generating AI summary...' });

                        // Generate enhanced AI summary with AST and LSP analysis
                        const summary = await aiSummaryService.generateEnhancedSummary(
                            analysisResult,
                            selectedText,
                            await apiKeyManager.getApiKey(),
                            filePath,
                            startLine,
                            endLine
                        );

                        if (token.isCancellationRequested) {
                            return;
                        }

                        progress.report({ increment: 40, message: 'Displaying results...' });

                        // Ensure the webview is revealed first
                        await vscode.commands.executeCommand('codescribe.resultsView.focus');
                        
                        // Small delay to ensure webview is ready
                        await new Promise(resolve => setTimeout(resolve, 100));

                        // Show results in webview
                        await webviewProvider.showResults({
                            summary,
                            analysisResult,
                            selectedText,
                            filePath: filePath,
                            lineRange: `${startLine}-${endLine}`
                        });

                    } catch (error) {
                        console.error('Error analyzing selection:', error);
                        await ErrorHandler.handleError(
                            error instanceof Error ? error : new Error('Unknown error occurred'),
                            'analyzeSelection'
                        );
                    }
                });

            } catch (error) {
                console.error('Error in analyzeSelection command:', error);
                await ErrorHandler.handleError(
                    error instanceof Error ? error : new Error('Unknown error occurred'),
                    'analyzeSelection command'
                );
            }
        }
    );

    const configureApiKeyCommand = vscode.commands.registerCommand(
        'codescribe.configureApiKey',
        async () => {
            await apiKeyManager.configureApiKey();
        }
    );

    const selectModelCommand = vscode.commands.registerCommand(
        'codescribe.selectModel',
        async () => {
            await selectModel();
        }
    );

    const reanalyzeWithModeCommand = vscode.commands.registerCommand(
        'codescribe.reanalyzeWithMode',
        async (args: { results: any }) => {
            try {
                const { results } = args;
                
                // Get API key
                const apiKey = await apiKeyManager.getApiKey();
                
                // Generate enhanced summary using AST and LSP analysis
                const startLine = parseInt(results.lineRange.split('-')[0]);
                const endLine = parseInt(results.lineRange.split('-')[1]);
                const summary = await aiSummaryService.generateEnhancedSummary(
                    results.analysisResult,
                    results.selectedText,
                    apiKey,
                    results.filePath,
                    startLine,
                    endLine
                );

                // Update webview with new summary
                await webviewProvider.showResults({
                    ...results,
                    summary
                });

            } catch (error) {
                console.error('Error re-analyzing:', error);
                await ErrorHandler.handleError(
                    error instanceof Error ? error : new Error('Unknown error occurred'),
                    'reanalyzeWithMode'
                );
            }
        }
    );

    // Add to subscriptions
    context.subscriptions.push(showChatCommand);
    context.subscriptions.push(hideChatCommand);
    context.subscriptions.push(addToChatCommand);
    context.subscriptions.push(analyzeSelectionCommand);
    context.subscriptions.push(configureApiKeyCommand);
    context.subscriptions.push(selectModelCommand);
    context.subscriptions.push(reanalyzeWithModeCommand);

    // Check dependencies on startup
    dependencyValidator.validateDependencies();

    async function selectModel() {
        const config = vscode.workspace.getConfiguration('codescribe');
        const currentProvider = config.get<string>('aiProvider', 'gemini');
        
        const modelOptions = getModelsForProvider(currentProvider);
        const currentModel = (await context.globalState.get(`codescribe.model.${currentProvider}`) as string) || modelOptions[0].value;
        
        // For Hugging Face, if we have a custom model that's not 'custom', add it to the options
        if (currentProvider === 'huggingface' && currentModel && currentModel !== 'custom' && !modelOptions.find(opt => opt.value === currentModel)) {
            modelOptions.unshift({
                label: `${currentModel} (Custom)`,
                description: 'Your custom Hugging Face model',
                value: currentModel
            });
        }
        
        const selection = await vscode.window.showQuickPick(
            modelOptions.map(option => ({
                ...option,
                label: option.value === currentModel ? `${option.label} (Current)` : option.label,
                picked: option.value === currentModel
            })),
            {
                placeHolder: `Select ${currentProvider.toUpperCase()} model (Current: ${modelOptions.find(opt => opt.value === currentModel)?.label || currentModel})`,
                matchOnDescription: true,
                matchOnDetail: true
            }
        );

        if (selection) {
            let modelValue = selection.value;
            
            // Handle Hugging Face custom model input
            if (currentProvider === 'huggingface' && selection.value === 'custom') {
                const customModel = await vscode.window.showInputBox({
                    prompt: 'Enter Hugging Face model ID (e.g., microsoft/DialoGPT-large)',
                    placeHolder: 'microsoft/DialoGPT-large',
                    validateInput: (value) => {
                        if (!value || value.trim() === '') {
                            return 'Model ID is required';
                        }
                        if (!value.includes('/')) {
                            return 'Model ID should be in format: publisher/model-name';
                        }
                        return undefined;
                    }
                });
                
                if (!customModel) {
                    return; // User cancelled
                }
                modelValue = customModel;
            }
            
            await context.globalState.update(`codescribe.model.${currentProvider}`, modelValue);
            vscode.window.showInformationMessage(
                `CodeScribe: Selected ${selection.label} for ${currentProvider.toUpperCase()}`
            );
        }
    }

    function getModelsForProvider(provider: string): Array<{label: string, description: string, value: string}> {
        switch (provider) {
            case 'gemini':
                return [
                    { label: 'Gemini 2.0 Flash', description: 'Fast and efficient - best for speed', value: 'gemini-2.0-flash-exp' },
                    { label: 'Gemini 2.5 Flash', description: 'Advanced flash model', value: 'gemini-2.5-flash' },
                    { label: 'Gemini 2.5 Pro', description: 'Most capable Gemini model', value: 'gemini-2.5-pro' }
                ];
            case 'openai':
                return [
                    { label: 'GPT-4o Mini', description: 'Fast, cost-effective, perfect for code analysis', value: 'gpt-4o-mini' },
                    { label: 'GPT-4o', description: 'More capable but slower than mini', value: 'gpt-4o' },
                    { label: 'GPT-5 Mini', description: 'Latest tech but slower (may not be available)', value: 'gpt-5-mini' },
                    { label: 'GPT-5', description: 'Maximum capabilities but slowest (may not be available)', value: 'gpt-5' }
                ];
            case 'claude':
                return [
                    { label: 'Claude Sonnet 4', description: 'Best balance of performance and cost', value: 'claude-sonnet-4-20250514' },
                    { label: 'Claude Sonnet 4.5', description: 'Latest and most capable Sonnet model', value: 'claude-sonnet-4-5-20250929' },
                    { label: 'Claude Sonnet 3.7', description: 'Previous generation Sonnet model', value: 'claude-3-7-sonnet-20250219' }
                ];
            case 'huggingface':
                return [
                    { label: 'Enter Custom Model ID', description: 'You will be prompted to enter the model ID', value: 'custom' }
                ];
            default:
                return [];
        }
    }
}

export function deactivate() {}