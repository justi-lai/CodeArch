import * as vscode from 'vscode';
import { CodexResults } from '../types';

export class CodexWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codex.resultsView';
    private _view?: vscode.WebviewView;
    private _selectedText: string = '';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getInitialHtml();
    }

    public async showResults(results: CodexResults) {
        if (this._view) {
            this._selectedText = results.selectedText;
            this._view.webview.html = this._getResultsHtml(results);
            
            // Set context to show the view
            await vscode.commands.executeCommand('setContext', 'codex.hasResults', true);
        }
    }

    private _getInitialHtml(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Codex Results</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    font-weight: var(--vscode-font-weight);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 12px;
                    margin: 0;
                }
                .welcome {
                    text-align: center;
                    padding: 20px 16px;
                    max-width: none;
                    margin: 0;
                }
                .welcome h2 {
                    color: var(--vscode-textPreformat-foreground);
                    margin-bottom: 8px;
                    font-size: 1.3em;
                    font-weight: 600;
                    line-height: 1.3;
                }
                .welcome .subtitle {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.85em;
                    margin-bottom: 16px;
                    font-style: italic;
                    line-height: 1.4;
                }
                .welcome p {
                    color: var(--vscode-descriptionForeground);
                    line-height: 1.4;
                    margin-bottom: 16px;
                    font-size: 0.9em;
                }
                .instruction {
                    background: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-charts-blue);
                    padding: 12px 16px;
                    margin: 16px 0;
                    border-radius: 6px;
                    text-align: left;
                }
                .instruction strong {
                    color: var(--vscode-charts-blue);
                    display: block;
                    margin-bottom: 6px;
                    font-size: 0.95em;
                }
                .step {
                    margin: 6px 0;
                    padding-left: 8px;
                    font-size: 0.85em;
                    line-height: 1.3;
                }
                .step::before {
                    content: "→";
                    color: var(--vscode-charts-blue);
                    font-weight: bold;
                    margin-right: 8px;
                }
            </style>
        </head>
        <body>
            <div class="welcome">
                <h2>Codex: Code Archaeology Assistant</h2>
                <div class="subtitle">Uncover the stories behind your code</div>
                <p>Discover why code exists, how it evolved, and what decisions shaped it using AI-powered git analysis.</p>
                <div class="instruction">
                    <strong>Quick Start</strong>
                    <div class="step">Select any block of code in your editor</div>
                    <div class="step">Right-click → "Codex: Analyze Selection"</div>
                    <div class="step">Get instant AI insights and commit timeline</div>
                </div>
            </div>
        </body>
        </html>`;
    }

    private _getResultsHtml(results: CodexResults): string {
        const timelineHtml = this._generateTimelineHtml(results.analysisResult.timeline);
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Codex Results</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    font-weight: var(--vscode-font-weight);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 16px;
                    margin: 0;
                    line-height: 1.5;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                }
                
                /* Responsive container */
                .content-container {
                    max-width: 100%;
                    min-width: 0;
                }
                
                @media (max-width: 400px) {
                    body {
                        padding: 12px;
                        font-size: 0.9em;
                    }
                }
                
                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 16px;
                    margin-bottom: 20px;
                    word-wrap: break-word;
                }
                
                .file-info {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                    word-break: break-all;
                }
                
                .summary {
                    background: var(--vscode-textBlockQuote-background);
                    border-left: 4px solid var(--vscode-charts-blue);
                    padding: 16px;
                    margin-bottom: 24px;
                    border-radius: 4px;
                    overflow: hidden;
                }
                
                .summary h3 {
                    margin: 0 0 12px 0;
                    color: var(--vscode-charts-blue);
                    font-size: 1.1em;
                }
                
                .summary-content {
                    line-height: 1.6;
                    word-wrap: break-word;
                }
                
                .summary-content h4 {
                    color: var(--vscode-textPreformat-foreground);
                    font-weight: 600;
                    margin: 16px 0 8px 0;
                    font-size: 1em;
                }
                
                .summary-content p {
                    margin: 8px 0;
                }
                
                .summary-content ul {
                    margin: 8px 0;
                    padding-left: 20px;
                }
                
                .summary-content li {
                    margin: 4px 0;
                }
                
                .assessment-section {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 12px;
                    margin: 12px 0;
                    overflow: hidden;
                }
                
                .necessity-line {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                
                .necessity-badge {
                    display: inline-block;
                    padding: 3px 8px;
                    border-radius: 12px;
                    font-size: 0.8em;
                    font-weight: 600;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                
                .necessity-essential {
                    background: var(--vscode-charts-green);
                    color: var(--vscode-editor-background);
                }
                
                .necessity-useful {
                    background: var(--vscode-charts-blue);
                    color: var(--vscode-editor-background);
                }
                
                .necessity-questionable {
                    background: var(--vscode-charts-orange);
                    color: var(--vscode-editor-background);
                }
                
                .suggestions-list {
                    margin: 8px 0 0 0;
                    padding-left: 16px;
                }
                
                .suggestions-list li {
                    margin: 4px 0;
                    color: var(--vscode-foreground);
                }
                
                .timeline {
                    margin-top: 20px;
                }
                
                .timeline h3 {
                    color: var(--vscode-textPreformat-foreground);
                    margin-bottom: 16px;
                    font-size: 1.1em;
                }
                
                .timeline-item {
                    border-left: 2px solid var(--vscode-panel-border);
                    padding-left: 16px;
                    margin-bottom: 12px;
                    position: relative;
                    word-wrap: break-word;
                    text-align: left;
                }
                
                .timeline-item::before {
                    content: '';
                    position: absolute;
                    left: -6px;
                    top: 6px;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: var(--vscode-charts-green);
                }
                
                .timeline-item.commit::before {
                    background: var(--vscode-charts-orange);
                }
                
                .item-header {
                    display: flex;
                    align-items: flex-start;
                    margin-bottom: 4px;
                    cursor: pointer;
                    padding: 4px 0px;
                    border-radius: 4px;
                    transition: background-color 0.2s;
                    min-height: 0;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                
                @media (max-width: 500px) {
                    .item-header {
                        flex-direction: column;
                        align-items: stretch;
                        gap: 4px;
                    }
                }
                
                .item-header:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .item-title {
                    font-weight: 600;
                    flex: 1;
                    min-width: 0;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                }
                
                .item-meta {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-shrink: 0;
                }
                
                @media (max-width: 500px) {
                    .item-meta {
                        font-size: 0.8em;
                    }
                }
                
                .item-content {
                    display: none;
                    padding: 4px 0px 4px 8px;
                    background: var(--vscode-editor-background);
                    border-radius: 4px;
                    margin-top: 0px;
                    border: 1px solid var(--vscode-panel-border);
                    text-align: left;
                    line-height: 1.4;
                }
                
                .item-content.expanded {
                    display: block;
                }
                
                .item-description {
                    margin-bottom: 4px;
                    white-space: pre-wrap;
                    font-size: 0.9em;
                }
                
                .comments {
                    margin-top: 8px;
                }
                
                .comment {
                    background: var(--vscode-textBlockQuote-background);
                    padding: 6px 10px;
                    margin: 6px 0;
                    border-radius: 4px;
                    border-left: 3px solid var(--vscode-charts-purple);
                    font-size: 0.9em;
                }
                
                .comment-author {
                    font-weight: 600;
                    color: var(--vscode-charts-purple);
                    font-size: 0.85em;
                }
                
                .linked-issues {
                    margin-top: 8px;
                }
                
                .issue-link {
                    display: inline-block;
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    padding: 4px 8px;
                    margin: 4px 4px 4px 0;
                    border-radius: 4px;
                    text-decoration: none;
                    font-size: 0.85em;
                }
                
                .issue-link:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                
                .external-link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                
                .external-link:hover {
                    text-decoration: underline;
                }
                
                .expand-icon {
                    margin-left: 8px;
                    font-size: 0.8em;
                    transition: transform 0.2s;
                }
                
                .expanded .expand-icon {
                    transform: rotate(90deg);
                }
                
                .no-data {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                    text-align: center;
                    padding: 20px;
                }
                
                .commit-diff {
                    margin-top: 4px;
                    border-top: 1px solid var(--vscode-panel-border);
                    padding-top: 4px;
                }
                
                .github-diff {
                    background: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 6px;
                    margin: 2px 0;
                    font-size: 0.85em;
                    line-height: 1.3;
                    max-height: 300px;
                    overflow-x: auto;
                    overflow-y: auto;
                    font-family: var(--vscode-editor-font-family);
                }
                
                .commit-diff pre {
                    background: transparent;
                    border: none;
                    border-radius: 0;
                    padding: 0;
                    margin: 0;
                    overflow: visible;
                }
                
                .diff-content {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    min-width: max-content;
                }
                
                .diff-header {
                    background: var(--vscode-editorGutter-background);
                    color: var(--vscode-editorGutter-foreground);
                    padding: 8px 12px;
                    font-weight: 600;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    font-size: 0.9em;
                }
                
                .diff-line {
                    display: flex;
                    line-height: 1.4;
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-editor-font-family);
                    white-space: nowrap;
                }
                
                .diff-line-number {
                    background: var(--vscode-editorGutter-background);
                    color: var(--vscode-editorGutter-foreground);
                    padding: 0 8px;
                    width: 50px;
                    text-align: right;
                    border-right: 1px solid var(--vscode-panel-border);
                    user-select: none;
                    font-size: 0.8em;
                    display: inline-block;
                    box-sizing: border-box;
                    flex-shrink: 0;
                    vertical-align: top;
                    min-height: 1.4em;
                }
                
                .diff-line-content {
                    padding: 0 8px;
                    flex: 1;
                    white-space: pre;
                    min-width: 0;
                }
                
                .diff-line.added {
                    background: rgba(46, 160, 67, 0.15);
                    border-left: 3px solid #2ea043;
                }
                
                .diff-line.removed {
                    background: rgba(248, 81, 73, 0.15);
                    border-left: 3px solid #f85149;
                }
                
                .diff-line.context {
                    background: var(--vscode-editor-background);
                }
                
                .diff-line.hunk {
                    background: var(--vscode-editorGutter-background);
                    color: var(--vscode-editorGutter-foreground);
                    font-weight: 600;
                }
                
                .diff-line.added .diff-line-content::before {
                    content: '+';
                    color: #2ea043;
                    font-weight: bold;
                    margin-right: 4px;
                }
                
                .diff-line.removed .diff-line-content::before {
                    content: '-';
                    color: #f85149;
                    font-weight: bold;
                    margin-right: 4px;
                }
                
                .diff-line.context .diff-line-content::before {
                    content: ' ';
                    margin-right: 4px;
                }
                
                .diff-line.debug {
                    background: rgba(255, 193, 7, 0.1);
                    border-left: 3px solid #ffc107;
                    color: var(--vscode-editor-foreground);
                    font-style: italic;
                }
                
                .diff-line.debug .diff-line-content::before {
                    content: '#';
                    color: #ffc107;
                    font-weight: bold;
                    margin-right: 4px;
                }
                
                .diff-line-content.highlighted {
                    background: rgba(255, 255, 0, 0.2);
                    border-radius: 2px;
                }
                
                .commit-diff code {
                    font-family: var(--vscode-editor-font-family);
                    color: var(--vscode-textPreformat-foreground);
                    background: transparent;
                    padding: 0;
                }
            </style>
        </head>
        <body>
            <div class="content-container">
                <div class="header">
                    <div class="file-info">
                        <strong>File:</strong> ${this._escapeHtml(results.filePath)}<br>
                        <strong>Lines:</strong> ${results.lineRange}
                    </div>
                </div>
                
                <div class="summary">
                    <h3>Code Analysis</h3>
                    <div class="summary-content">${this._formatSummary(results.summary)}</div>
                </div>
                
                <div class="timeline">
                    <h3>Timeline</h3>
                    ${timelineHtml}
                </div>
            </div>
            
            <script>
                function toggleItem(element) {
                    const content = element.nextElementSibling;
                    const icon = element.querySelector('.expand-icon');
                    
                    if (content.classList.contains('expanded')) {
                        content.classList.remove('expanded');
                        element.classList.remove('expanded');
                    } else {
                        content.classList.add('expanded');
                        element.classList.add('expanded');
                    }
                }
            </script>
        </body>
        </html>`;
    }

    private _generateTimelineHtml(timeline: any[]): string {
        if (timeline.length === 0) {
            return '<div class="no-data">No timeline data available</div>';
        }

        return timeline.map(item => {
            if (item.type === 'pullRequest') {
                const pr = item.data;
                const commentsHtml = pr.comments && pr.comments.length > 0 
                    ? `<div class="comments">
                        <strong>Comments:</strong>
                        ${pr.comments.map((comment: any) => `
                            <div class="comment">
                                <div class="comment-author">${this._escapeHtml(comment.author)}</div>
                                <div>${this._escapeHtml(comment.body)}</div>
                            </div>
                        `).join('')}
                    </div>`
                    : '';

                const issuesHtml = pr.linkedIssues && pr.linkedIssues.length > 0
                    ? `<div class="linked-issues">
                        <strong>Linked Issues:</strong><br>
                        ${pr.linkedIssues.map((issue: any) => 
                            `<a href="${issue.url}" class="issue-link external-link" title="${this._escapeHtml(issue.title)}">#${issue.number}</a>`
                        ).join('')}
                    </div>`
                    : '';

                return `
                    <div class="timeline-item pr">
                        <div class="item-header" onclick="toggleItem(this)">
                            <div class="item-title">PR #${pr.number}: ${this._escapeHtml(pr.title)}</div>
                            <div class="item-meta">
                                ${pr.author} • ${this._formatDate(pr.createdAt)}
                                <span class="expand-icon">▶</span>
                            </div>
                        </div>
                        <div class="item-content">
                            <div class="item-description">${this._escapeHtml(pr.body || 'No description')}</div>
                            <a href="${pr.url}" class="external-link">View on GitHub →</a>
                            ${commentsHtml}
                            ${issuesHtml}
                        </div>
                    </div>
                `;
            } else if (item.type === 'commit') {
                const commit = item.data;
                const diffHtml = commit.diff ? `
                    <div class="commit-diff">
                        <strong>Changes:</strong>
                        <div class="github-diff">${this._formatGitDiff(commit.diff, commit.filename || 'Modified file', this._selectedText)}</div>
                    </div>
                ` : '';
                
                // Debug logging
                console.log(`[Codex] Processing commit ${commit.hash}`);
                console.log(`[Codex] Diff length: ${commit.diff ? commit.diff.length : 0}`);
                console.log(`[Codex] Diff content preview:`, commit.diff ? commit.diff.substring(0, 200) + '...' : 'No diff');
                
                return `
                    <div class="timeline-item commit">
                        <div class="item-header" onclick="toggleItem(this)">
                            <div class="item-title">${this._escapeHtml(commit.message)}</div>
                            <div class="item-meta">
                                ${commit.author} • ${this._formatDate(commit.date)}
                                <span class="expand-icon">▶</span>
                            </div>
                        </div>
                        <div class="item-content">
                            <div class="item-description"><strong>Commit:</strong> ${commit.hash.substring(0, 8)}</div>
                            ${diffHtml}
                        </div>
                    </div>
                `;
            }
            return '';
        }).join('');
    }

    private _formatSummary(summary: string): string {
        let formatted = this._escapeHtml(summary);
        
        // Convert markdown-style bold to HTML
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Handle the structured sections
        // Convert markdown headers to HTML headers
        formatted = formatted.replace(/^### (.*$)/gm, '<h4>$1</h4>');
        formatted = formatted.replace(/^## (.*$)/gm, '<h4>$1</h4>');
        
        // Handle bullet points
        formatted = formatted.replace(/^- (.*$)/gm, '<li>$1</li>');
        
        // Wrap consecutive list items in ul tags
        formatted = formatted.replace(/(<li>.*<\/li>\s*)+/g, '<ul>$&</ul>');
        
        // Handle the assessment section specially
        const assessmentMatch = formatted.match(/<strong>CODE ASSESSMENT:<\/strong>(.*?)(?=<h4>|$)/s);
        if (assessmentMatch) {
            let assessmentContent = assessmentMatch[1];
            
            // Handle necessity line
            const necessityMatch = assessmentContent.match(/<li><strong>Necessity:<\/strong>\s*(Essential|Useful|Questionable)\s*-\s*(.*?)<\/li>/);
            if (necessityMatch) {
                const [, level, reason] = necessityMatch;
                const cssClass = `necessity-${level.toLowerCase()}`;
                const necessityHtml = `
                    <div class="necessity-line">
                        <strong>Necessity:</strong>
                        <span class="necessity-badge ${cssClass}">${level}</span>
                        <span>${reason}</span>
                    </div>`;
                assessmentContent = assessmentContent.replace(necessityMatch[0], necessityHtml);
            }
            
            // Handle suggestions
            const suggestionsMatch = assessmentContent.match(/<li><strong>Suggestions:<\/strong>\s*(.*?)<\/li>/s);
            if (suggestionsMatch) {
                const suggestions = suggestionsMatch[1];
                let suggestionsHtml = '';
                
                if (suggestions.toLowerCase().includes('code is well-designed') || 
                    suggestions.toLowerCase().includes('code appears well-designed') ||
                    suggestions.toLowerCase().includes('no major issues') ||
                    suggestions.toLowerCase().includes('looks good')) {
                    suggestionsHtml = `
                        <div>
                            <strong>Suggestions:</strong> 
                            <span style="color: var(--vscode-charts-green);">✓ ${suggestions}</span>
                        </div>`;
                } else {
                    // Parse multiple suggestions (split by periods or numbered items)
                    const suggestionItems = suggestions.split(/(?:\d+\.|\.\s*(?=[A-Z]))/).filter(s => s.trim());
                    if (suggestionItems.length > 1) {
                        suggestionsHtml = `
                            <div>
                                <strong>Suggestions:</strong>
                                <ul class="suggestions-list">
                                    ${suggestionItems.map(item => `<li>${item.trim()}</li>`).join('')}
                                </ul>
                            </div>`;
                    } else {
                        suggestionsHtml = `
                            <div>
                                <strong>Suggestions:</strong> ${suggestions}
                            </div>`;
                    }
                }
                assessmentContent = assessmentContent.replace(suggestionsMatch[0], suggestionsHtml);
            }
            
            // Replace the assessment section with formatted version
            const wrappedAssessment = `
                <div class="assessment-section">
                    <strong>CODE ASSESSMENT:</strong>
                    ${assessmentContent.replace(/<ul>|<\/ul>/g, '').replace(/<li>/g, '<div>').replace(/<\/li>/g, '</div>')}
                </div>`;
            
            formatted = formatted.replace(/<strong>CODE ASSESSMENT:<\/strong>.*?(?=<h4>|$)/s, wrappedAssessment);
        }
        
        // Convert line breaks to paragraphs for better spacing
        formatted = formatted.replace(/\n\s*\n/g, '</p><p>');
        formatted = '<p>' + formatted + '</p>';
        
        // Clean up empty paragraphs and fix structure
        formatted = formatted.replace(/<p>\s*<\/p>/g, '');
        formatted = formatted.replace(/<p>\s*(<h4>)/g, '$1');
        formatted = formatted.replace(/(<\/h4>)\s*<\/p>/g, '$1');
        formatted = formatted.replace(/<p>\s*(<div class="assessment-section">)/g, '$1');
        formatted = formatted.replace(/(<\/div>)\s*<\/p>/g, '$1');
        
        return formatted;
    }

    private _formatGitDiff(diff: string, filename: string, selectedText: string = ''): string {
        console.log(`[Codex] _formatGitDiff called with:`);
        console.log(`[Codex] - filename: ${filename}`);
        console.log(`[Codex] - diff length: ${diff ? diff.length : 0}`);
        console.log(`[Codex] - diff content:`, diff ? diff.substring(0, 500) + '...' : 'No diff');
        
        if (!diff || diff.trim().length === 0) {
            console.log(`[Codex] Returning 'No changes' - diff is empty`);
            return '<em>No changes</em>';
        }
        
        // Since we're now getting evolution-based diffs that are already filtered,
        // we can show them directly without additional filtering
        return this._renderFullDiff(diff.split('\n'), filename);
    }
    
    private _renderFullDiff(lines: string[], filename: string): string {
        console.log(`[Codex] _renderFullDiff called with ${lines.length} lines`);
        console.log(`[Codex] First 10 lines:`, lines.slice(0, 10));
        
        let html = '';
        let lineNum = 0;
        let inHunk = false;
        
        html += `<div class="diff-header">${this._escapeHtml(filename)}</div>`;
        html += '<div class="diff-content">';
        
        for (const line of lines) {
            if (line.startsWith('diff --git') || line.startsWith('index') || 
                line.startsWith('---') || line.startsWith('+++')) {
                continue; // Skip diff headers
            }
            
            if (line.startsWith('@@')) {
                // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
                const match = line.match(/@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
                if (match) {
                    lineNum = parseInt(match[2]); // Start with new line numbers
                    inHunk = true;
                }
                html += `<div class="diff-line hunk">`;
                html += `<span class="diff-line-number">...</span>`;
                html += `<span class="diff-line-content">${this._escapeHtml(line)}</span>`;
                html += `</div>`;
                continue;
            }
            
            if (!inHunk) continue;
            
            const firstChar = line.charAt(0);
            let lineClass = 'context';
            let displayNum = '';
            
            if (firstChar === '+') {
                lineClass = 'added';
                displayNum = lineNum.toString();
                lineNum++;
            } else if (firstChar === '-') {
                lineClass = 'removed';
                displayNum = ''; // Empty for removed lines to maintain alignment
                // Don't increment line number for deletions
            } else if (firstChar === ' ') {
                lineClass = 'context';
                displayNum = lineNum.toString();
                lineNum++;
            } else if (firstChar === '#') {
                // Handle debug lines
                lineClass = 'debug';
                displayNum = 'DEBUG';
            } else {
                // Handle lines without +/- prefix (shouldn't happen in normal diffs)
                continue;
            }
            
            const lineContent = line.substring(1);
            const isHighlighted = this._selectedText && lineContent.toLowerCase().includes(this._selectedText.toLowerCase());
            const contentClass = isHighlighted ? 'diff-line-content highlighted' : 'diff-line-content';
            
            html += `<div class="diff-line ${lineClass}">`;
            html += `<span class="diff-line-number">${displayNum}</span>`;
            html += `<span class="${contentClass}">${this._escapeHtml(lineContent)}</span>`;
            html += `</div>`;
        }
        
        html += '</div>';
        return html;
    }
    
    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}