import * as vscode from 'vscode';
import { GitAnalysis } from './services/gitAnalysis';

export function activate(context: vscode.ExtensionContext) {
	const gitService = new GitAnalysis();

	const analyzeCommand = vscode.commands.registerCommand('codearch.codearchAnalyze', async (document: vscode.TextDocument, range: vscode.Range) => {

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "CodeArch: Analyzing Selected Code",
			cancellable: false
		}, async (progress, token) => {

			progress.report({ message: "Connecting to Git API..." });

			try {
				// Call your new service!
				const result = await gitService.performAnalysis(document, range);

				progress.report({ message: "Processing history..." });
				await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate work

				console.log(result);
				vscode.window.showInformationMessage(`Result: ${result}`);
			} catch (error: any) {
				vscode.window.showErrorMessage(`Analysis failed: ${error.message}`);
			}

			return;
		});
	});

	const provider = vscode.languages.registerCodeActionsProvider(
		{ scheme: 'file', language: '*' },
		new MyCodeActionProvider(),
		{
			providedCodeActionKinds: MyCodeActionProvider.providedCodeActionKinds
		}
	);

	context.subscriptions.push(analyzeCommand, provider);
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
			// Pass the document and range so the service can use them for Git
			arguments: [document, range]
		};

		return [action];
	}
}

export function deactivate() { }
