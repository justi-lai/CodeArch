/*
 * Copyright (c) 2026 Justin Lai
 * Licensed under the MIT License.
 */

import * as vscode from 'vscode';
import { GitAnalysis, CommitRecord } from './services/gitAnalysis';
import { getWebviewContent } from './webpages/inlineWebview';
import { TreeSitterAnalysis } from './services/treesitterAnalysis';
import { SecretsManager, AIProvider } from './services/secretsManager';
import { AIAnalysis, AIAnalysisResult } from './services/aiAnalysis';

export function activate(context: vscode.ExtensionContext) {
	const gitService = new GitAnalysis();
	const treeSitterService = new TreeSitterAnalysis(context);
	const secretsManager = new SecretsManager(context);
	const aiService = new AIAnalysis();

	treeSitterService.initialize().catch(err => {
		console.error('Failed to initialize Tree-sitter:', err);
	});

	async function runCodeArchAudit(document: vscode.TextDocument, range: vscode.Range) {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "CodeArch: Analyzing Selected Code",
			cancellable: false
		}, async (progress, token) => {

			progress.report({ message: "Searching for relevant history..." });

			try {
				const result: CommitRecord[] = await gitService.performAnalysis(document, range);
				const scopeInfo = await treeSitterService.getScopeInfo(document, range);

				progress.report({ message: "Processing history..." });

				console.log(`Found ${result.length} commits impacting this range.`);
				console.log("Enclosing Scopes (Tree-sitter):", scopeInfo.enclosingScopes);

				let refCount = 0;
				let referenceLocations: string[] = [];
				const targetScope = scopeInfo.enclosingScopes.find(s => s.nameRange);
				if (targetScope && targetScope.nameRange) {
					progress.report({ message: `Finding references for ${targetScope.name}...` });

					const pos = new vscode.Position(
						targetScope.nameRange.startLine - 1,
						targetScope.nameRange.startColumn
					);

					const lsReferences = await vscode.commands.executeCommand<vscode.Location[]>(
						'vscode.executeReferenceProvider',
						document.uri,
						pos
					);

					if (lsReferences && lsReferences.length > 0) {
						const filteredReferences = lsReferences.filter(ref => {
							const isSameFile = ref.uri.toString() === document.uri.toString();
							const isSameStart = ref.range.start.line === (targetScope!.nameRange!.startLine - 1) &&
								ref.range.start.character === targetScope!.nameRange!.startColumn;
							return !(isSameFile && isSameStart);
						});

						refCount = filteredReferences.length;
						referenceLocations = filteredReferences.map(ref => {
							const relPath = vscode.workspace.asRelativePath(ref.uri);
							return `${relPath}:${ref.range.start.line + 1}`;
						});
					} else {
						const recommendations: Record<string, { id: string, name: string }> = {
							'c': { id: 'ms-vscode.cpptools', name: 'C/C++' },
							'cpp': { id: 'ms-vscode.cpptools', name: 'C/C++' },
							'csharp': { id: 'ms-dotnettools.csharp', name: 'C#' },
							'go': { id: 'golang.go', name: 'Go' },
							'java': { id: 'redhat.java', name: 'Java' },
							'javascript': { id: 'vscode.typescript-language-features', name: 'JavaScript' },
							'javascriptreact': { id: 'vscode.typescript-language-features', name: 'JavaScript' },
							'kotlin': { id: 'fwcd.kotlin', name: 'Kotlin' },
							'php': { id: 'devsense.phptools-vscode', name: 'PHP' },
							'python': { id: 'ms-python.python', name: 'Python' },
							'ruby': { id: 'shopify.ruby-lsp', name: 'Ruby' },
							'rust': { id: 'rust-lang.rust-analyzer', name: 'rust-analyzer' },
							'shellscript': { id: 'mads-hartmann.bash-ide-vscode', name: 'Bash' },
							'swift': { id: 'sswp.swift-lang', name: 'Swift' },
							'typescript': { id: 'vscode.typescript-language-features', name: 'TypeScript' },
							'typescriptreact': { id: 'vscode.typescript-language-features', name: 'TypeScript' }
						};

						const rec = recommendations[document.languageId];
						if (rec && !vscode.extensions.getExtension(rec.id)) {
							vscode.window.showInformationMessage(
								`CodeArch: Projects in ${rec.name} require the official ${rec.name} extension for full analysis.`,
								'View Extension'
							).then(selection => {
								if (selection === 'View Extension') {
									vscode.commands.executeCommand('extension.open', rec.id);
								}
							});
						}
					}
				}

				let aiInsight: AIAnalysisResult | string = "";
				const aiConfig = await secretsManager.getConfig();
				if (aiConfig.apiKey) {
					progress.report({ message: `Generating AI Insight with ${aiConfig.provider}...` });
					try {
						aiInsight = await aiService.analyze(
							aiConfig,
							document.getText(),
							vscode.workspace.asRelativePath(document.uri),
							{ start: range.start.line + 1, end: range.end.line + 1 },
							result,
							scopeInfo.enclosingScopes,
							referenceLocations
						);
					} catch (aiError: any) {
						console.error("AI Analysis failed:", aiError);
						aiInsight = `AI analysis failed: ${aiError.message}`;
					}
				} else {
					aiInsight = `<div class="ai-setup-nudge">AI analysis is available! <a href="command:codearch.configureAI">Configure your API Key</a> to get deep insights into the intent and risk of this code.</div>`;
				}

				if (result.length > 0) {
					const fileName = document.fileName.split(/[\\/]/).pop() || 'File';
					const lineRange = `${range.start.line + 1}-${range.end.line + 1}`;

					const panel = vscode.window.createWebviewPanel(
						'codearchResult',
						`Audit: ${fileName} [L${lineRange}]`,
						vscode.ViewColumn.Beside,
						{
							enableScripts: true,
							enableCommandUris: true
						}
					);

					panel.webview.html = getWebviewContent(result, scopeInfo.enclosingScopes, refCount, aiInsight);

				} else {
					vscode.window.showInformationMessage(`Analysis complete. No commits found for this range.`);
				}
			} catch (error: any) {
				vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
			}

			return;
		});
	}

	const configureAICommand = vscode.commands.registerCommand('codearch.configureAI', async () => {
		const providers: { label: string, id: AIProvider }[] = [
			{ label: 'Google Gemini', id: 'gemini' },
			{ label: 'OpenAI', id: 'openai' },
			{ label: 'Anthropic Claude', id: 'claude' },
			{ label: 'Custom (Local/On-Prem)', id: 'custom' }
		];

		const selected = await vscode.window.showQuickPick(providers, {
			placeHolder: 'Select AI Provider'
		});

		if (selected) {
			await secretsManager.setSelectedProvider(selected.id);

			const models: Record<AIProvider, string[]> = {
				'gemini': ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3-pro-preview'],
				'openai': ['gpt-5', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.2', 'gpt-4o'],
				'claude': ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
				'custom': []
			};

			if (selected.id === 'custom') {
				const baseUrl = await vscode.window.showInputBox({
					prompt: 'Enter API Base URL (e.g., http://localhost:11434/v1)',
					value: secretsManager.getCustomUrl(),
					placeHolder: 'http://localhost:11434/v1'
				});

				if (baseUrl) {
					await secretsManager.setCustomUrl(baseUrl);

					const modelName = await vscode.window.showInputBox({
						prompt: 'Enter Model ID (e.g., llama3, mistral)',
						value: secretsManager.getSelectedModel(),
						placeHolder: 'llama3'
					});

					if (modelName) {
						await secretsManager.setSelectedModel(modelName);
						vscode.window.showInformationMessage(`CodeArch: Switched to Custom LLM (${modelName})`);

						// Optional: Prompt for API key if the local provider uses one
						const wantsKey = await vscode.window.showQuickPick(['No', 'Yes'], {
							placeHolder: 'Does your custom provider require an API Key / Bearer Token?'
						});
						if (wantsKey === 'Yes') {
							await secretsManager.promptForApiKey('custom');
						}
					}
				}
			} else {
				const model = await vscode.window.showQuickPick(models[selected.id], {
					placeHolder: `Select model for ${selected.label}`
				});

				if (model) {
					await secretsManager.setSelectedModel(model);
					vscode.window.showInformationMessage(`CodeArch: Switched to ${selected.label} (${model})`);

					const key = await secretsManager.getApiKey(selected.id);
					if (!key) {
						await secretsManager.promptForApiKey(selected.id);
					}
				}
			}
		}
	});

	const setApiKeyCommand = vscode.commands.registerCommand('codearch.setApiKey', async () => {
		const provider = secretsManager.getSelectedProvider();
		await secretsManager.promptForApiKey(provider);
	});

	const analyzeCommand = vscode.commands.registerCommand('codearch.codearchAnalyze', async (document: vscode.TextDocument, range: vscode.Range) => {
		if (!document || !range) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				await runCodeArchAudit(activeEditor.document, activeEditor.selection);
			}
		} else {
			await runCodeArchAudit(document, range);
		}
	});

	const provider = vscode.languages.registerCodeActionsProvider(
		{ scheme: 'file', language: '*' },
		new MyCodeActionProvider(),
		{
			providedCodeActionKinds: MyCodeActionProvider.providedCodeActionKinds
		}
	);

	context.subscriptions.push(analyzeCommand, provider, configureAICommand, setApiKeyCommand);
}

export class MyCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.Refactor
	];

	provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection): vscode.CodeAction[] {
		if (range.isEmpty) {
			return [];
		}

		const action = new vscode.CodeAction('CodeArch: Analyze Selected Code', vscode.CodeActionKind.Refactor);

		action.command = {
			command: 'codearch.codearchAnalyze',
			title: 'CodeArch: Analyze Selected Code',
			arguments: [document, range]
		};

		return [action];
	}
}

export function deactivate() { }
