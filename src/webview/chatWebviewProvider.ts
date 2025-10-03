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
import { ChatService } from '../services/chatService';
import { ApiKeyManager } from '../services/apiKeyManager';
import { CodeArchWebviewProvider } from './codearchWebviewProvider';
import { GitAnalysisEngine } from '../services/gitAnalysisEngine';

export interface ChatContext {
    id: string;
    type: 'code' | 'diff' | 'analysis';
    content: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    timestamp: Date;
    title: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    mode: 'code';
    isTyping?: boolean;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codearch.chatView';
    private _view?: vscode.WebviewView;
    private _chatService: ChatService;
    private _context: ChatContext[] = [];
    private _messages: ChatMessage[] = [];
    private _currentMode: 'code' = 'code';
    private _updateThrottleTimeout?: NodeJS.Timeout;
    private _pendingUpdate = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _apiKeyManager: ApiKeyManager,
        private readonly _codearchProvider?: CodeArchWebviewProvider,
        private readonly _extensionContext?: vscode.ExtensionContext
    ) {
        this._chatService = new ChatService(this._extensionContext);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Try to set a reasonable initial height and configuration
        if (webviewView.description !== undefined) {
            webviewView.description = '';
        }
        
        // Set badge to indicate it's available
        webviewView.badge = undefined;
        
        // Store reference for ensuring visibility
        this._view = webviewView;

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'sendMessage':
                        await this._handleSendMessage(message.content);
                        break;
                    case 'addContext':
                        await this._handleContextType(message.contextType);
                        break;
                    case 'selectCommitDiff':
                        this._addCommitDiff(message.commitId, message.commitTitle, message.diff);
                        break;
                    case 'removeContext':
                        this._removeContext(message.contextId);
                        break;
                    case 'clearChat':
                        this._clearChat();
                        break;
                    case 'newChat':
                        this._newChat();
                        break;
                }
            }
        );

        this._updateWebview();
    }

    public async addContext(context: ChatContext) {
        // Ensure the chat view is visible first
        await this.ensureVisible();
        
        // Check if this exact context already exists
        const existingIndex = this._context.findIndex(c => 
            c.filePath === context.filePath && 
            c.startLine === context.startLine && 
            c.endLine === context.endLine &&
            c.content === context.content
        );
        
        // If exact same context exists, don't add duplicate
        if (existingIndex === -1) {
            this._context.push(context);
            this._updateContextOnly();
        }
    }

    public async addCodeContext(code: string, filePath?: string, startLine?: number, endLine?: number) {
        const context: ChatContext = {
            id: this._generateId(),
            type: 'code',
            content: code,
            filePath,
            startLine,
            endLine,
            timestamp: new Date(),
            title: this._generateContextTitle('code', filePath, startLine, endLine)
        };
        
        await this.addContext(context);
    }

    public async addAnalysisContext(analysis: string, filePath?: string) {
        const context: ChatContext = {
            id: this._generateId(),
            type: 'analysis',
            content: analysis,
            filePath,
            timestamp: new Date(),
            title: this._generateContextTitle('analysis', filePath)
        };
        
        await this.addContext(context);
    }

    private async _handleSendMessage(content: string) {
        if (!content.trim()) return;

        // Add user message
        const userMessage: ChatMessage = {
            id: this._generateId(),
            role: 'user',
            content: content.trim(),
            timestamp: new Date(),
            mode: this._currentMode
        };
        
        this._messages.push(userMessage);
        this._updateWebview();

        try {
            // Get API key
            const apiKey = await this._apiKeyManager.getApiKey();
            
            // Add typing indicator
            const typingId = this._generateId();
            const typingMessage: ChatMessage = {
                id: typingId,
                role: 'assistant',
                content: '...',
                timestamp: new Date(),
                mode: this._currentMode,
                isTyping: true
            };
            
            this._messages.push(typingMessage);
            this._updateWebview();
            
            // Remove typing indicator and add streaming response message
            const typingIndex = this._messages.findIndex(m => m.id === typingId);
            if (typingIndex !== -1) {
                this._messages.splice(typingIndex, 1);
            }

            // Create streaming response message
            const responseMessage: ChatMessage = {
                id: this._generateId(),
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                mode: this._currentMode
            };
            
            this._messages.push(responseMessage);
            this._updateWebview();

            // Get AI response with streaming
            await this._chatService.sendMessageStream(
                content,
                this._currentMode,
                this._context,
                this._messages.slice(0, -1), // Exclude the streaming response message
                apiKey,
                (token: string) => {
                    // Update the response message with new token
                    responseMessage.content += token;
                    this._throttledUpdateMessages();
                },
                () => {
                    // Streaming complete - do final update
                    if (this._updateThrottleTimeout) {
                        clearTimeout(this._updateThrottleTimeout);
                    }
                    this._updateMessagesOnly();
                },
                (error: Error) => {
                    // Handle streaming error
                    throw error;
                }
            );
        } catch (error) {
            console.error('Chat error:', error);
            
            // Add error message
            const errorMessage: ChatMessage = {
                id: this._generateId(),
                role: 'assistant',
                content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
                mode: this._currentMode
            };

            this._messages.push(errorMessage);
            this._updateWebview();
        }
    }

    private async _handleContextType(contextType: string) {
        switch (contextType) {
            case 'file':
                await this._addActiveFile();
                break;
            case 'selection':
                await this._addCurrentSelection();
                break;
            case 'analysis':
                await this._addCurrentAnalysis();
                break;
            case 'gitdiff':
                await this._addGitDiff();
                break;
            case 'workspace':
                await this._addGitChanges();
                break;
            default:
                await this._showContextSelector();
                break;
        }
    }

    private async _showContextSelector() {
        const options = [
            'Current Selection',
            'Active File',
            'Git Changes',
            'Current Analysis'
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select context to add to chat'
        });

        if (!selected) return;

        switch (selected) {
            case 'Current Selection':
                await this._addCurrentSelection();
                break;
            case 'Active File':
                await this._addActiveFile();
                break;
            case 'Git Changes':
                await this._addGitChanges();
                break;
            case 'Current Analysis':
                await this._addCurrentAnalysis();
                break;
        }
    }

    private async _addCurrentSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('No text selected');
            return;
        }

        const selectedText = editor.document.getText(editor.selection);
        await this.addCodeContext(
            selectedText,
            editor.document.uri.fsPath,
            editor.selection.start.line + 1,
            editor.selection.end.line + 1
        );
        vscode.window.showInformationMessage(`Added selection context: ${selectedText.length} characters`);
    }

    private async _addActiveFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active file');
            return;
        }

        const fileContent = editor.document.getText();
        await this.addCodeContext(fileContent, editor.document.uri.fsPath);
        vscode.window.showInformationMessage(`Added file context: ${editor.document.fileName} (${fileContent.length} characters)`);
    }

    private async _addGitChanges() {
        // This would integrate with git to get current changes
        vscode.window.showInformationMessage('Git changes context coming soon!');
    }

    private async _addGitDiff() {
        try {
            // Get current git analysis results from the codearch provider
            const currentResults = this._codearchProvider?.getCurrentResults();
            
            if (!currentResults) {
                vscode.window.showErrorMessage('No analysis results available. Please run codearch analysis first to see commit diffs.');
                return;
            }

            if (!currentResults.analysisResult || !currentResults.analysisResult.commits || currentResults.analysisResult.commits.length === 0) {
                vscode.window.showInformationMessage('No git commits found in the current analysis results. Run analysis on a file with git history to see commit diffs.');
                return;
            }

            // Create list of available diffs from commits
            const commitOptions = currentResults.analysisResult.commits
                .filter(commit => commit.diff && commit.diff.trim())
                .map(commit => {
                    return {
                        id: commit.hash,
                        title: `${commit.hash.substring(0, 7)} - ${commit.message}`,
                        diff: commit.diff!,
                        author: commit.author,
                        date: commit.date
                    };
                });

            if (commitOptions.length === 0) {
                vscode.window.showInformationMessage('No commit diffs available in the current analysis results. The analyzed commits may not have diff information.');
                return;
            }

            // Show secondary dropdown with commit diffs
            this._showGitDiffDropdown(commitOptions);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to get git diffs: ${errorMessage}`);
        }
    }

    private _showGitDiffDropdown(commitOptions: Array<{id: string, title: string, diff: string, author: string, date: string}>) {
        // Send the commit options to the webview to show a secondary dropdown
        this._view?.webview.postMessage({
            command: 'showGitDiffDropdown',
            commits: commitOptions
        });
    }

    private _addCommitDiff(_commitId: string, commitTitle: string, diff: string) {
        // Add the selected commit diff as context
        const context: ChatContext = {
            id: this._generateId(),
            type: 'diff',
            content: `## Commit: ${commitTitle}\n\n\`\`\`diff\n${diff}\n\`\`\``,
            title: `Diff: ${commitTitle.substring(0, 30)}...`,
            timestamp: new Date()
        };

        this._context.push(context);
        this._updateContextOnly();
    }


    private async _addCurrentAnalysis() {
        // Get the latest analysis from the main codearch provider
        const currentResults = this._codearchProvider?.getCurrentResults();
        
        if (!currentResults) {
            const runAnalysis = await vscode.window.showInformationMessage(
                'No recent analysis found. Would you like to run codearch analysis first?',
                'Run Analysis',
                'Cancel'
            );
            
            if (runAnalysis === 'Run Analysis') {
                await vscode.commands.executeCommand('codearch.analyzeGitChanges');
                vscode.window.showInformationMessage('Please run the analysis and try adding context again.');
            }
            return;
        }

        // Only add the analysis summary (code is auto-added on send)
        await this.addAnalysisContext(currentResults.summary, 'codearch Analysis');
        
        vscode.window.showInformationMessage(
            `Added analysis context: ${currentResults.summary.length} chars of analysis`
        );
    }

    private _removeContext(contextId: string) {
        this._context = this._context.filter(c => c.id !== contextId);
        this._updateContextOnly();
    }

    private _clearChat() {
        this._messages = [];
        this._updateWebview();
    }

    private _newChat() {
        // Clear messages and context to start fresh
        this._messages = [];
        this._context = [];
        this._updateWebview();
    }

    public async ensureVisible() {
        // Ensure the chat view is visible and expanded
        if (this._view) {
            await vscode.commands.executeCommand('codearch.chatView.focus');
        }
    }

    private _generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    private _generateContextTitle(type: string, filePath?: string, startLine?: number, endLine?: number): string {
        if (filePath) {
            const fileName = filePath.split('/').pop() || filePath;
            if (startLine && endLine) {
                return `${fileName}:${startLine}-${endLine}`;
            }
            return fileName;
        }
        return `${type} context`;
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview();
        }
    }

    private _updateContextOnly() {
        if (this._view) {
            // Send a message to update context without resetting the entire HTML
            this._view.webview.postMessage({
                command: 'updateContext',
                context: this._context
            });
        }
    }

    private _updateMessagesOnly() {
        if (this._view) {
            // Send a message to update messages without resetting the entire HTML
            this._view.webview.postMessage({
                command: 'updateMessages',
                messages: this._getMessagesHTML()
            });
        }
    }

    private _throttledUpdateWebview() {
        if (this._updateThrottleTimeout) {
            clearTimeout(this._updateThrottleTimeout);
        }
        
        this._pendingUpdate = true;
        this._updateThrottleTimeout = setTimeout(() => {
            if (this._pendingUpdate) {
                this._updateWebview();
                this._pendingUpdate = false;
            }
        }, 100); // Update every 100ms during streaming
    }

    private _throttledUpdateMessages() {
        if (this._updateThrottleTimeout) {
            clearTimeout(this._updateThrottleTimeout);
        }
        
        this._pendingUpdate = true;
        this._updateThrottleTimeout = setTimeout(() => {
            if (this._pendingUpdate) {
                this._updateMessagesOnly();
                this._pendingUpdate = false;
            }
        }, 100); // Update every 100ms during streaming
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>codearch Chat</title>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css">
            <style>
                ${this._getCSSStyles()}
            </style>
        </head>
        <body>
            <div class="chat-container">
                <!-- Messages area -->
                <div class="messages-container" id="messagesContainer">
                    ${this._getMessagesHTML()}
                </div>

                <!-- Input area (bottom) -->
                <div class="input-area">
                    <!-- Context and mode controls above textbox -->
                    <div class="input-controls">
                        <div class="context-controls">
                            <button class="add-context-btn" onclick="toggleContextDropdown()" title="Add context">
                                <span class="codicon codicon-add"></span>
                            </button>
                            <!-- Context dropdown -->
                            <div class="context-dropdown" id="contextDropdown" style="display: none;">
                                <div class="context-dropdown-item" onclick="addContext('file')">
                                    <span class="codicon codicon-file"></span>
                                    <span>Add File</span>
                                </div>
                                <div class="context-dropdown-item" onclick="addContext('selection')">
                                    <span class="codicon codicon-selection"></span>
                                    <span>Add Selection</span>
                                </div>
                                <div class="context-dropdown-item" onclick="addContext('analysis')">
                                    <span class="codicon codicon-search"></span>
                                    <span>Add Analysis</span>
                                </div>
                                <div class="context-dropdown-item" onclick="addContext('gitdiff')">
                                    <span class="codicon codicon-git-compare"></span>
                                    <span>Add Git Diff</span>
                                </div>
                            </div>
                            <!-- Context chips container -->
                            <div class="context-chips-container" id="contextChipsContainer">
                                ${this._context.map(ctx => `
                                    <div class="context-chip" onclick="removeContext('${ctx.id}')" title="Click to remove: ${ctx.title}">
                                        <span class="context-chip-text">${ctx.title}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <!-- New Chat button -->
                        <div class="chat-controls">
                            <button class="new-chat-btn" onclick="newChat()" title="Start a new chat">
                                <span class="codicon codicon-refresh"></span>
                                New
                            </button>
                        </div>

                    </div>
                    <!-- Textbox with send button -->
                    <div class="input-box">
                        <textarea id="messageInput" placeholder="Ask about your code..." 
                                onkeydown="handleKeyDown(event)" oninput="adjustTextareaHeight(this)"></textarea>
                        <button class="send-btn" onclick="sendMessage()" title="Send message">
                            <span class="codicon codicon-send"></span>
                        </button>
                    </div>
                </div>
            </div>

            <script>
                ${this._getJavaScript()}
            </script>
        </body>
        </html>`;
    }

    private _getContextHTML(): string {
        if (this._context.length === 0) {
            return '<div class="context-items"></div>';
        }

        return `
            <div class="context-items">
                ${this._context.map(ctx => `
                    <div class="context-item">
                        <span class="context-type">${ctx.type}</span>
                        <span class="context-title">${ctx.title}</span>
                        <button class="remove-context-btn" onclick="removeContext('${ctx.id}')" title="Remove context">
                            <span class="codicon codicon-close"></span>
                        </button>
                    </div>
                `).join('')}
            </div>`;
    }

    private _getMessagesHTML(): string {
        if (this._messages.length === 0) {
            return this._getLandingPageHTML();
        }
        
        return this._messages.map(msg => `
            <div class="message ${msg.role}">
                <div class="message-time">${this._formatTime(msg.timestamp)}</div>
                <div class="message-content">${msg.isTyping ? this._getTypingIndicator() : this._formatMessageContent(msg.content)}</div>
            </div>
        `).join('');
    }

    private _getLandingPageHTML(): string {
        return `
            <div class="chat-landing">
                <div class="landing-header">
                    <h1>What can I help you with?</h1>
                </div>

                <div class="capabilities-list">
                    <div class="capability-item">
                        <span class="codicon codicon-file-code"></span>
                        <span>Add context from codearch analysis automatically</span>
                    </div>
                    <div class="capability-item">
                        <span class="codicon codicon-add"></span>
                        <span>Manually add file context using the + button</span>
                    </div>
                    <div class="capability-item">
                        <span class="codicon codicon-selection"></span>
                        <span>Include highlighted code from your editor</span>
                    </div>
                    <div class="capability-item">
                        <span class="codicon codicon-git-commit"></span>
                        <span>Analyze git diffs and commit changes</span>
                    </div>
                </div>
            </div>
        `;
    }

    private _getCodeCapabilities(): string {
        return `
            <div class="capability">
                <span class="codicon codicon-search"></span>
                <span>Code review & analysis</span>
            </div>
            <div class="capability">
                <span class="codicon codicon-bug"></span>
                <span>Debugging assistance</span>
            </div>
            <div class="capability">
                <span class="codicon codicon-rocket"></span>
                <span>Performance optimization</span>
            </div>
            <div class="capability">
                <span class="codicon codicon-organization"></span>
                <span>Architecture guidance</span>
            </div>
            <div class="capability">
                <span class="codicon codicon-book"></span>
                <span>Best practices</span>
            </div>
            <div class="capability">
                <span class="codicon codicon-beaker"></span>
                <span>Testing strategies</span>
            </div>
        `;
    }

    private _getCodeExamples(): string {
        return `
            <div class="example-prompt" onclick="insertPrompt('Explain how this function works')">
                "Explain how this function works"
            </div>
            <div class="example-prompt" onclick="insertPrompt('How can I improve this code\\'s performance?')">
                "How can I improve this code's performance?"
            </div>
            <div class="example-prompt" onclick="insertPrompt('Find potential bugs in this implementation')">
                "Find potential bugs in this implementation"
            </div>
            <div class="example-prompt" onclick="insertPrompt('Suggest better patterns for this code')">
                "Suggest better patterns for this code"
            </div>
        `;
    }

    private _formatMessageContent(content: string): string {
        return this._parseMarkdown(content);
    }

    private _parseMarkdown(markdown: string): string {
        let html = markdown;

        // Escape HTML to prevent injection, but preserve our markdown
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Code blocks (must be processed before inline code)
        html = html.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
            const language = lang ? ` class="language-${lang}"` : '';
            return `<pre><code${language}>${code.trim()}</code></pre>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Headers
        html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

        // Bold and italic (bold first to avoid conflicts)
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Lists (unordered) - process consecutive list items
        html = html.replace(/^- (.*$)/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*?<\/li>(?:\n<li>.*?<\/li>)*)/gm, '<ul>$1</ul>');

        // Lists (ordered) - process consecutive numbered list items
        html = html.replace(/^\d+\. (.*$)/gm, '<li class="ordered">$1</li>');
        html = html.replace(/(<li class="ordered">.*?<\/li>(?:\n<li class="ordered">.*?<\/li>)*)/gm, (match) => {
            // Remove the "ordered" class and wrap in ol
            const cleanedMatch = match.replace(/ class="ordered"/g, '');
            return '<ol>' + cleanedMatch + '</ol>';
        });

        // Blockquotes
        html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');

        // Horizontal rules
        html = html.replace(/^---$/gm, '<hr>');

        // Line breaks (convert remaining \n to <br>, but not inside pre/code blocks)
        html = html.replace(/\n(?!<\/?(pre|code|ul|ol|li|h[1-6]|blockquote))/g, '<br>');

        // Clean up multiple br tags
        html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

        return html;
    }

    private _formatTime(timestamp: Date): string {
        return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    private _getTypingIndicator(): string {
        return `
            <div class="typing-indicator">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
    }

    private _getCSSStyles(): string {
        return `
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: var(--vscode-font-family);
                font-size: 13px;
                background-color: var(--vscode-sideBar-background);
                color: var(--vscode-foreground);
                margin: 0;
                padding: 0;
                height: 100vh;
                overflow: hidden;
            }

            .chat-container {
                display: flex;
                flex-direction: column;
                height: 100vh;
                position: relative;
            }

            /* Messages area */
            .messages-container {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 70px; /* Minimum space for input area */
                overflow-y: auto;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .message {
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 12px;
                margin-bottom: 12px;
            }

            .message.user {
                align-items: flex-end;
                margin-left: 25%; /* Start user messages 25% from left (3/4 width) */
            }

            .message.assistant {
                align-items: flex-start;
                margin-right: 25%; /* Give assistant messages some right margin */
            }

            .message-time {
                font-size: 9px;
                opacity: 0.4;
                margin-bottom: 2px;
            }

            .message.user .message-time {
                text-align: right;
            }

            .message.assistant .message-time {
                text-align: left;
            }

            .message-content {
                line-height: 1.4;
                white-space: pre-wrap;
                word-wrap: break-word;
                max-width: 100%;
            }

            .message.user .message-content {
                background-color: var(--vscode-input-background);
                padding: 8px 12px;
                border-radius: 12px;
                border: 1px solid var(--vscode-input-border);
                text-align: left;
            }

            .message.assistant .message-content {
                background-color: transparent;
                padding: 4px 0;
                text-align: left;
            }

            /* Typing indicator */
            .typing-indicator {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 8px 0;
            }

            .typing-indicator .dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background-color: var(--vscode-foreground);
                opacity: 0.4;
                animation: typing 1.4s infinite;
            }

            .typing-indicator .dot:nth-child(1) { animation-delay: 0s; }
            .typing-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
            .typing-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

            @keyframes typing {
                0%, 60%, 100% { opacity: 0.4; }
                30% { opacity: 1; }
            }

            /* Markdown Styles */
            .message-content h1, .message-content h2, .message-content h3 {
                color: var(--vscode-foreground);
                margin: 16px 0 8px 0;
                font-weight: 600;
                line-height: 1.2;
            }

            .message-content h1 { 
                font-size: 1.4em; 
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 4px;
            }
            .message-content h2 { 
                font-size: 1.2em; 
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 2px;
            }
            .message-content h3 { 
                font-size: 1.1em; 
            }

            .message-content pre {
                background-color: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                padding: 12px;
                margin: 12px 0;
                overflow-x: auto;
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
                line-height: 1.4;
            }

            .message-content code {
                background-color: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 3px;
                padding: 2px 4px;
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
                color: var(--vscode-textPreformat-foreground);
            }

            .message-content pre code {
                background: none;
                border: none;
                padding: 0;
                border-radius: 0;
            }

            .message-content ul, .message-content ol {
                margin: 8px 0;
                padding-left: 24px;
            }

            .message-content li {
                margin: 4px 0;
                line-height: 1.4;
            }

            .message-content blockquote {
                border-left: 4px solid var(--vscode-textLink-foreground);
                margin: 12px 0;
                padding: 8px 16px;
                background-color: var(--vscode-textBlockQuote-background);
                font-style: italic;
                border-radius: 0 4px 4px 0;
            }

            .message-content hr {
                border: none;
                border-top: 1px solid var(--vscode-panel-border);
                margin: 16px 0;
            }

            .message-content a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }

            .message-content a:hover {
                text-decoration: underline;
            }

            .message-content strong {
                font-weight: 600;
                color: var(--vscode-foreground);
            }

            .message-content em {
                font-style: italic;
                color: var(--vscode-foreground);
            }

            /* Input area */
            .input-area {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                border-top: 1px solid var(--vscode-panel-border);
                background-color: var(--vscode-sideBar-background);
                display: flex;
                flex-direction: column;
                min-height: 70px;
                max-height: 170px; /* Increased to accommodate controls properly */
                justify-content: flex-end;
            }

            .input-controls {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 8px 4px 8px;
                font-size: 10px;
                min-height: 24px; /* Ensure controls don't get compressed */
                flex-shrink: 0; /* Prevent shrinking */
            }

            .context-controls {
                display: flex;
                align-items: center;
                gap: 6px;
                flex: 1;
                min-width: 0; /* Allow shrinking */
            }

            .add-context-btn {
                background: none;
                border: 1px solid var(--vscode-button-border);
                color: var(--vscode-button-secondaryForeground);
                cursor: pointer;
                padding: 2px 4px;
                border-radius: 3px;
                font-size: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                position: relative;
                flex-shrink: 0;
            }

            .add-context-btn:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }

            .chat-controls {
                display: flex;
                align-items: center;
                margin-left: auto;
                flex-shrink: 0;
            }

            .new-chat-btn {
                background: none;
                border: 1px solid var(--vscode-button-border);
                color: var(--vscode-button-secondaryForeground);
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 10px;
                display: flex;
                align-items: center;
                gap: 3px;
                height: 20px;
                flex-shrink: 0;
            }

            .new-chat-btn:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }

            /* Context dropdown */
            .context-dropdown {
                position: absolute;
                left: 0;
                background-color: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                z-index: 1000;
                min-width: 120px;
            }

            .context-dropdown.dropdown-down {
                top: 20px; /* Below button */
            }

            .context-dropdown.dropdown-up {
                bottom: 20px; /* Above button */
            }

            .context-dropdown-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                cursor: pointer;
                font-size: 11px;
                color: var(--vscode-dropdown-foreground);
            }

            .context-dropdown-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .context-dropdown-item:first-child {
                border-radius: 4px 4px 0 0;
            }

            .context-dropdown-item:last-child {
                border-radius: 0 0 4px 4px;
            }

            /* Git diff dropdown */
            .git-diff-dropdown {
                position: absolute;
                left: 0;
                background-color: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px var(--vscode-widget-shadow);
                z-index: 1000;
                min-width: 300px;
                max-height: 250px;
                overflow-y: auto;
                display: none;
            }

            .git-diff-dropdown.dropdown-down {
                top: 20px; /* Below button */
            }

            .git-diff-dropdown.dropdown-up {
                bottom: 20px; /* Above button */
            }

            .git-diff-item {
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--vscode-panel-border);
                color: var(--vscode-dropdown-foreground);
            }

            .git-diff-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .git-diff-item:last-child {
                border-bottom: none;
            }

            .commit-hash {
                font-family: var(--vscode-editor-font-family);
                font-size: 10px;
                color: var(--vscode-textLink-foreground);
                font-weight: bold;
                margin-bottom: 2px;
            }

            .commit-message {
                font-size: 11px;
                font-weight: 500;
                margin-bottom: 2px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .commit-author {
                font-size: 10px;
                opacity: 0.7;
            }

            /* Context chips container */
            .context-chips-container {
                display: flex;
                align-items: center;
                gap: 4px;
                overflow-x: auto;
                flex: 1;
                min-width: 0;
                max-width: calc(100% - 50px); /* Reserve minimal space for mode controls */
                padding-right: 8px;
                scroll-behavior: smooth;
                /* Hide scrollbar but keep functionality */
                scrollbar-width: none; /* Firefox */
                -ms-overflow-style: none; /* IE and Edge */
            }

            .context-chips-container::-webkit-scrollbar {
                display: none; /* Chrome, Safari, Opera */
            }

            /* Context chips */
            .context-chip {
                background-color: var(--vscode-textCodeBlock-background);
                color: var(--vscode-textPreformat-foreground);
                border-radius: 3px;
                padding: 1px 6px;
                font-size: 10px;
                white-space: nowrap;
                cursor: pointer;
                max-width: 120px;
                flex-shrink: 0;
                transition: all 0.2s;
                border: 1px solid var(--vscode-input-border);
                margin: 1px 2px;
            }

            .context-chip:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
                transform: scale(0.95);
            }

            .context-chip-text {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                display: inline-block;
                max-width: 100%;
            }

            .context-count {
                opacity: 0.6;
                font-size: 10px;
            }

            .mode-controls {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .mode-label {
                opacity: 0.6;
                font-size: 10px;
            }

            /* Input box */
            .input-box {
                position: relative;
                margin: 4px 8px 8px 8px;
                display: flex;
                align-items: flex-end;
                width: calc(100% - 16px); /* Account for left/right margins */
            }

            #messageInput {
                width: 100%;
                background-color: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                color: var(--vscode-input-foreground);
                border-radius: 6px;
                padding: 8px 32px 8px 8px;
                resize: none;
                font-family: var(--vscode-font-family);
                font-size: 12px;
                line-height: 1.4;
                min-height: 32px;
                max-height: 120px;
                outline: none;
                overflow-y: auto;
                vertical-align: bottom;
                /* Hide scrollbar but keep functionality */
                scrollbar-width: none; /* Firefox */
                -ms-overflow-style: none; /* IE and Edge */
            }

            #messageInput::-webkit-scrollbar {
                display: none; /* Chrome, Safari, Opera */
            }

            #messageInput:focus {
                border-color: var(--vscode-focusBorder);
            }

            #messageInput::placeholder {
                color: var(--vscode-input-placeholderForeground);
                opacity: 0.6;
            }

            .send-btn {
                position: absolute;
                right: 4px;
                bottom: 4px;
                background: none;
                border: none;
                color: var(--vscode-button-foreground);
                cursor: pointer;
                width: 24px;
                height: 24px;
                border-radius: 3px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.6;
                transition: all 0.2s;
            }

            .send-btn:hover {
                opacity: 1;
                background-color: var(--vscode-button-background);
            }

            .send-btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
            }

            /* Scrollbar */
            .messages-container::-webkit-scrollbar {
                width: 6px;
            }

            .messages-container::-webkit-scrollbar-track {
                background: transparent;
            }

            .messages-container::-webkit-scrollbar-thumb {
                background: var(--vscode-scrollbarSlider-background);
                border-radius: 3px;
            }

            .messages-container::-webkit-scrollbar-thumb:hover {
                background: var(--vscode-scrollbarSlider-hoverBackground);
            }

            /* Landing Page Styles */
            .chat-landing {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                padding: 60px 20px;
                text-align: center;
                background: var(--vscode-editor-background);
                color: var(--vscode-foreground);
            }

            .landing-header h1 {
                font-size: 24px;
                font-weight: 400;
                margin: 0 0 40px 0;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
            }

            .capabilities-list {
                width: 100%;
                max-width: 500px;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }

            .capability-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 0;
                font-size: 14px;
                color: var(--vscode-foreground);
                line-height: 1.4;
            }

            .capability-item .codicon {
                color: var(--vscode-textLink-foreground);
                font-size: 16px;
                flex-shrink: 0;
            }

            @media (max-width: 600px) {
                .chat-landing {
                    padding: 40px 16px;
                }
                
                .landing-header h1 {
                    font-size: 20px;
                }
                
                .capabilities-list {
                    max-width: 100%;
                }
            }
        `;
    }



    private _getJavaScript(): string {
        return `
            const vscode = acquireVsCodeApi();

            function toggleContextDropdown() {
                const dropdown = document.getElementById('contextDropdown');
                const button = document.querySelector('.add-context-btn');
                
                if (dropdown.style.display === 'none') {
                    // Calculate optimal dropdown direction
                    const buttonRect = button.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    const isInBottomHalf = buttonRect.top > (viewportHeight / 2);
                    
                    // Reset positioning classes
                    dropdown.classList.remove('dropdown-up', 'dropdown-down');
                    
                    if (isInBottomHalf) {
                        // Show dropdown above button
                        dropdown.classList.add('dropdown-up');
                    } else {
                        // Show dropdown below button
                        dropdown.classList.add('dropdown-down');
                    }
                    
                    dropdown.style.display = 'block';
                    // Close dropdown when clicking outside
                    setTimeout(() => {
                        document.addEventListener('click', closeDropdown);
                    }, 0);
                } else {
                    dropdown.style.display = 'none';
                }
            }

            function closeDropdown(event) {
                const dropdown = document.getElementById('contextDropdown');
                const button = document.querySelector('.add-context-btn');
                if (!dropdown.contains(event.target) && !button.contains(event.target)) {
                    dropdown.style.display = 'none';
                    document.removeEventListener('click', closeDropdown);
                }
            }

            function addContext(type) {
                // Close dropdown
                document.getElementById('contextDropdown').style.display = 'none';
                document.removeEventListener('click', closeDropdown);
                
                vscode.postMessage({
                    command: 'addContext',
                    contextType: type
                });
            }

            function removeContext(contextId) {
                // Immediately hide the context chip for better UX
                const chipElement = event.target.closest('.context-chip');
                if (chipElement) {
                    chipElement.style.opacity = '0.3';
                    chipElement.style.pointerEvents = 'none';
                }
                
                vscode.postMessage({
                    command: 'removeContext',
                    contextId: contextId
                });
            }

            function clearChat() {
                vscode.postMessage({
                    command: 'clearChat'
                });
            }

            function updateContextDisplay(context) {
                // Update the context display without refreshing the entire page
                const contextContainer = document.getElementById('contextChipsContainer');
                if (contextContainer) {
                    contextContainer.innerHTML = context.map(ctx => \`
                        <div class="context-chip" onclick="removeContext('\${ctx.id}')" title="Click to remove: \${ctx.title}">
                            <span class="context-chip-text">\${ctx.title}</span>
                        </div>
                    \`).join('');
                }
            }

            function updateMessagesDisplay(messagesHTML) {
                // Update the messages display without refreshing the entire page
                const messagesContainer = document.getElementById('messagesContainer');
                if (messagesContainer) {
                    messagesContainer.innerHTML = messagesHTML;
                    // Scroll to bottom to show new messages
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }
            }

            function newChat() {
                // Clear the current chat
                vscode.postMessage({
                    command: 'newChat'
                });
            }

            function sendMessage() {
                const input = document.getElementById('messageInput');
                const content = input.value.trim();
                
                if (!content) return;

                vscode.postMessage({
                    command: 'sendMessage',
                    content: content
                });

                input.value = '';
                adjustTextareaHeight(input);
            }

            function handleKeyDown(event) {
                const textarea = event.target;
                
                if (event.key === 'Enter') {
                    if (event.shiftKey) {
                        // Allow new line with Shift+Enter
                        return;
                    } else {
                        event.preventDefault();
                        sendMessage();
                    }
                }
                
                // Auto-adjust height
                setTimeout(() => adjustTextareaHeight(textarea), 0);
            }

            function adjustTextareaHeight(textarea) {
                if (!textarea) {
                    textarea = document.getElementById('messageInput');
                }
                textarea.style.height = 'auto';
                const newHeight = Math.min(textarea.scrollHeight, 120);
                textarea.style.height = newHeight + 'px';
                
                // Adjust messages container to account for input area height
                const inputArea = textarea.closest('.input-area');
                const messagesContainer = document.getElementById('messagesContainer');
                if (inputArea && messagesContainer) {
                    // Add some buffer to prevent overlap
                    const inputAreaHeight = Math.min(inputArea.offsetHeight + 10, 180);
                    messagesContainer.style.bottom = inputAreaHeight + 'px';
                }
            }

            // Auto-scroll to bottom when new messages are added
            function scrollToBottom() {
                const container = document.getElementById('messagesContainer');
                container.scrollTop = container.scrollHeight;
            }

            // Initialize
            document.addEventListener('DOMContentLoaded', () => {
                scrollToBottom();
                const messageInput = document.getElementById('messageInput');
                messageInput.focus();
                // Initial height adjustment
                adjustTextareaHeight(messageInput);
                
                // Add horizontal scroll wheel support for context chips
                const contextContainer = document.getElementById('contextChipsContainer');
                if (contextContainer) {
                    contextContainer.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        contextContainer.scrollLeft += e.deltaY;
                    });
                }
            });

            // Listen for messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'showGitDiffDropdown':
                        showGitDiffDropdown(message.commits);
                        break;
                    case 'updateContext':
                        updateContextDisplay(message.context);
                        break;
                    case 'updateMessages':
                        updateMessagesDisplay(message.messages);
                        break;
                }
            });

            function showGitDiffDropdown(commits) {
                // Hide main context dropdown
                document.getElementById('contextDropdown').style.display = 'none';
                
                // Store commits globally for selection
                window.gitDiffCommits = commits;
                
                // Create git diff dropdown
                let gitDiffDropdown = document.getElementById('gitDiffDropdown');
                if (!gitDiffDropdown) {
                    gitDiffDropdown = document.createElement('div');
                    gitDiffDropdown.id = 'gitDiffDropdown';
                    gitDiffDropdown.className = 'git-diff-dropdown';
                    document.querySelector('.input-controls').appendChild(gitDiffDropdown);
                }
                
                // Build dropdown content using commit index
                gitDiffDropdown.innerHTML = commits.map((commit, index) => 
                    \`<div class="git-diff-item" onclick="selectCommitDiff(\${index})">
                        <div class="commit-hash">\${commit.id.substring(0, 7)}</div>
                        <div class="commit-message">\${commit.title.substring(8)}</div>
                        <div class="commit-author">\${commit.author}</div>
                    </div>\`
                ).join('');
                
                // Determine dropdown direction based on panel position
                const inputControls = document.querySelector('.input-controls');
                const panelHeight = document.body.clientHeight;
                const controlsRect = inputControls.getBoundingClientRect();
                const isInUpperHalf = controlsRect.top < panelHeight / 2;
                
                // Apply appropriate direction class
                gitDiffDropdown.className = 'git-diff-dropdown ' + (isInUpperHalf ? 'dropdown-down' : 'dropdown-up');
                
                gitDiffDropdown.style.display = 'block';
                
                // Close dropdown when clicking outside
                function closeGitDiffDropdown(e) {
                    if (!gitDiffDropdown.contains(e.target)) {
                        gitDiffDropdown.style.display = 'none';
                        document.removeEventListener('click', closeGitDiffDropdown);
                    }
                }
                setTimeout(() => document.addEventListener('click', closeGitDiffDropdown), 100);
            }

            function selectCommitDiff(commitIndex) {
                // Hide dropdown
                document.getElementById('gitDiffDropdown').style.display = 'none';
                
                // Get commit data from global storage
                const commit = window.gitDiffCommits[commitIndex];
                
                // Send selection to extension
                vscode.postMessage({
                    command: 'selectCommitDiff',
                    commitId: commit.id,
                    commitTitle: commit.title,
                    diff: commit.diff
                });
            }

            function insertPrompt(prompt) {
                const textarea = document.getElementById('messageInput');
                if (textarea) {
                    textarea.value = prompt;
                    textarea.focus();
                    // Trigger input event to update any listeners
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }

            // Scroll to bottom whenever content changes
            const observer = new MutationObserver(scrollToBottom);
            observer.observe(document.getElementById('messagesContainer'), { childList: true, subtree: true });
        `;
    }
}
