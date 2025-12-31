import { CommitRecord } from "../services/gitAnalysis";
import { EnclosingScope } from "../services/treesitterAnalysis";
import { AIAnalysisResult } from "../services/aiAnalysis";

const STYLES = `
    :root {
        --nav-header-bg: var(--vscode-sideBarSectionHeader-background);
        --item-hover-bg: var(--vscode-list-hoverBackground);
        --border-color: var(--vscode-widget-border);
        --add-bg: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.15));
        --del-bg: var(--vscode-diffEditor-removedTextBackground, rgba(215, 58, 73, 0.15));
        --font-family-code: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
    }

    body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        padding: 0;
        margin: 0;
        line-height: 1.5;
    }

    .analysis-header {
        padding: 20px 24px;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--border-color);
        margin-bottom: 8px;
    }

    .analysis-title {
        font-size: 1.2rem;
        font-weight: 500;
        margin-bottom: 12px;
        color: var(--vscode-editor-foreground);
    }

    .scope-badges {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 20px;
    }

    .scope-badge {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .scope-type {
        opacity: 0.5;
        text-transform: uppercase;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.5px;
    }

    .scope-name {
        color: var(--vscode-textLink-foreground);
    }

    .usage-card {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-top: 4px;
        color: var(--vscode-descriptionForeground);
    }

    .usage-count {
        font-size: 1rem;
        font-weight: 600;
        color: var(--vscode-editor-foreground);
    }

    .usage-label {
        font-size: 0.85rem;
        opacity: 0.8;
    }

    .ai-insight-section {
        margin: 24px 24px 32px 24px;
        padding: 0;
        background: transparent;
        border: none;
    }

    .ai-header-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 20px;
        opacity: 0.8;
    }

    .ai-section-group {
        margin-bottom: 20px;
        border-left: 2px solid var(--vscode-textLink-activeForeground);
        padding-left: 16px;
    }

    .ai-section-title {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--vscode-foreground);
        margin-bottom: 6px;
        letter-spacing: 0.2px;
    }

    .ai-content {
        font-size: 0.9rem;
        line-height: 1.5;
        color: var(--vscode-editor-foreground);
    }

    .ai-verdict-box {
        margin-top: 24px;
        padding: 12px 16px;
        background-color: var(--vscode-info-background, rgba(0, 0, 0, 0.1));
        border: 1px solid var(--vscode-info-border, var(--border-color));
        border-radius: 4px;
    }

    .ai-verdict-text {
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--vscode-foreground);
    }

    .ai-verdict-text strong {
        color: var(--vscode-textLink-foreground);
    }

    .ai-setup-nudge {
        margin: 16px 24px;
        font-size: 0.85rem;
        color: var(--vscode-descriptionForeground);
        padding: 12px 16px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 4px;
        border: 1px dashed var(--border-color);
    }

    .ai-setup-nudge a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
    }
    
    .ai-setup-nudge a:hover {
        text-decoration: underline;
    }

    h2 {
        font-size: 1.1rem;
        margin: 24px 24px 12px 24px;
        color: var(--vscode-editor-foreground);
    }

    .commit-list {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    details {
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--border-color);
    }

    summary {
        background-color: transparent;
        padding: 8px 16px;
        cursor: pointer;
        display: flex;
        flex-direction: row;
        align-items: baseline;
        gap: 12px;
        font-size: 0.9rem;
        transition: background 0.2s;
        user-select: none;
    }

    summary:hover {
        background-color: var(--item-hover-bg);
    }

    .commit-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .hash {
        font-family: var(--font-family-code);
        color: var(--vscode-textLink-activeForeground);
        font-size: 0.85rem;
    }

    .date {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85rem;
        width: 140px;
    }

    .author {
        font-weight: 600;
        color: var(--vscode-editor-foreground);
        white-space: nowrap;
    }

    .message {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--vscode-descriptionForeground);
        flex-grow: 1;
    }

    details[open] .message {
        white-space: normal;
        overflow: visible;
    }

    .diff-container {
        padding: 0;
        margin: 0;
        background-color: var(--vscode-editor-background);
        font-family: var(--font-family-code);
        font-size: 0.85rem;
        line-height: 1.4;
    }

    .diff-raw-info {
        background-color: var(--nav-header-bg);
        color: var(--vscode-disabledForeground);
        font-family: var(--font-family-code);
        font-size: 0.75rem;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border-color);
        white-space: pre-wrap;
    }

    .diff-stats-bar {
        background-color: var(--vscode-editor-background);
        padding: 4px 16px;
        font-size: 0.8rem;
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--border-color);
        display: flex;
        gap: 16px;
    }

    .diff-stat-item {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .stat-add { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .stat-del { color: var(--vscode-gitDecoration-deletedResourceForeground); }

    .diff-content {
        font-family: var(--font-family-code);
        font-size: 0.85rem;
        line-height: 1.4;
        overflow: auto;
        max-height: 500px;
    }

    .diff-inner {
        min-width: 100%;
        width: fit-content;
    }

    .diff-line {
        display: grid;
        grid-template-columns: 35px 1fr;
        width: 100%;
        box-sizing: border-box;
    }
    
    .diff-line:hover {
        background-color: var(--item-hover-bg);
    }

    .line-number {
        text-align: right;
        padding-right: 12px;
        color: var(--vscode-editorLineNumber-foreground);
        font-size: 0.8em;
        user-select: none;
        opacity: 0.7;
    }

    .code-text {
        padding-left: 4px;
        white-space: pre;
    }

    .diff-add { background-color: var(--add-bg); }
    .diff-remove { background-color: var(--del-bg); }

    /* Reset Prism default styles that cause 'bubbles' and misalignment */
    code[class*="language-"],
    pre[class*="language-"] {
        background: none !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        text-shadow: none !important;
        font-family: inherit !important;
        font-size: inherit !important;
        white-space: pre !important; /* Critical for horizontal scroll */
        color: inherit !important; /* Use our defined token colors or parent color */
    }

    /* Prism Token Colors - Fine-tuned for VS Code Dark Look */
    .token.comment { color: #6a9955; }
    .token.punctuation { color: #d4d4d4; }
    .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: #b5cea8; }
    .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin { color: #ce9178; }
    .token.operator, .token.entity, .token.url { color: #d4d4d4; }
    .token.atrule, .token.attr-value, .token.keyword { color: #569cd6; }
    .token.function { color: #dcdcaa; }
    .token.class-name { color: #4ec9b0; }
    .token.regex, .token.important, .token.variable { color: #9cdcfe; }
`;

function formatDiff(diff: string, language: string): string {
    if (!diff) {
        return `
            <div class="diff-stats-bar">
                <span>No content changes</span>
            </div>`;
    }

    const lines = diff.split('\n');
    const headerLines: string[] = [];
    const contentLines: string[] = [];
    let processingHeader = true;

    for (const line of lines) {
        if (processingHeader) {
            if (line.startsWith('diff --git') ||
                line.startsWith('index') ||
                line.startsWith('---') ||
                line.startsWith('+++') ||
                line.startsWith('@@') ||
                line.startsWith('old mode') ||
                line.startsWith('new mode') ||
                line.startsWith('deleted file') ||
                line.startsWith('new file')) {
                headerLines.push(line);
                if (line.startsWith('@@')) {
                    processingHeader = false;
                }
            } else {
                processingHeader = false;
                contentLines.push(line);
            }
        } else {
            contentLines.push(line);
        }
    }

    let added = 0;
    let removed = 0;
    contentLines.forEach(line => {
        if (line.startsWith('+')) {
            added++;
        } else if (line.startsWith('-')) {
            removed++;
        }
    });

    const linesHtml = contentLines.map((line) => {
        let className = "diff-line";
        let marker = " ";
        let code = line;

        if (line.startsWith('+')) {
            className += " diff-add";
            marker = "+";
            code = line.substring(1);
        } else if (line.startsWith('-')) {
            className += " diff-remove";
            marker = "-";
            code = line.substring(1);
        } else if (line.startsWith(' ')) {
            code = line.substring(1);
        }

        const safeCode = code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        return `
            <div class="${className}">
                <div class="line-number">${marker}</div>
                <div class="code-text"><code class="language-${language}">${safeCode}</code></div> 
            </div>`;
    }).join('');

    const headerHtml = headerLines.length > 0
        ? `<div class="diff-raw-info">${headerLines.join('\n')}</div>`
        : '';

    return `
        ${headerHtml}
        <div class="diff-stats-bar">
            <span class="diff-stat-item"><span class="stat-add"><strong>+${added}</strong></span> additions</span>
            <span class="diff-stat-item"><span class="stat-del"><strong>-${removed}</strong></span> deletions</span>
        </div>
        <div class="diff-content">
            <div class="diff-inner">
                ${linesHtml}
            </div>
        </div>
    `;
}

export function getWebviewContent(result: CommitRecord[], scopeInfo: EnclosingScope[], referenceCount: number, aiInsight: AIAnalysisResult | string): string {
    const sortedResults = [...result].sort((a, b) => {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const scopeBadgesHtml = scopeInfo.map(scope => `
        <div class="scope-badge">
            <span class="scope-type">${scope.type.replace('_', ' ')}</span>
            <span class="scope-name">${scope.name}</span>
        </div>
    `).join('');

    const mainScope = scopeInfo.find(s => s.name !== '(anonymous)') || scopeInfo[0];
    const analysisTitle = mainScope ? `Analysis for ${mainScope.name}` : 'Code History Analysis';

    let aiSectionHtml = '';
    let setupNudgeHtml = '';

    if (typeof aiInsight === 'string') {
        if (aiInsight.includes('command:')) {
            setupNudgeHtml = aiInsight;
        } else if (aiInsight) {
            aiSectionHtml = `
                <div class="ai-insight-section">
                    <div class="ai-header-bar">AI Analysis</div>
                    <div class="ai-body">
                        <div class="ai-content" data-markdown>${aiInsight}</div>
                    </div>
                </div>
            `;
        }
    } else if (aiInsight) {
        aiSectionHtml = `
            <div class="ai-insight-section">
                <div class="ai-header-bar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    Audit Synthesis
                </div>
                
                <div class="ai-section-group">
                    <div class="ai-section-title">Intent & History</div>
                    <div class="ai-content" data-markdown>${aiInsight.intent}</div>
                </div>

                <div class="ai-section-group">
                    <div class="ai-section-title">Code Logic & Oversights</div>
                    <div class="ai-content" data-markdown>${aiInsight.analysis}</div>
                </div>
                
                <div class="ai-section-group">
                    <div class="ai-section-title">Risk Assessment</div>
                    <div class="ai-content" data-markdown>${aiInsight.risk}</div>
                </div>

                <div class="ai-verdict-box">
                    <div class="ai-verdict-text"><strong>Verdict:</strong> ${aiInsight.verdict}</div>
                </div>
            </div>
        `;
    }

    const commitsHtml = sortedResults.map(commit => {
        const shortHash = commit.hash.substring(0, 7);
        let lang = commit.language;
        if (lang === 'typescriptreact') {
            lang = 'tsx';
        }
        if (lang === 'javascriptreact') {
            lang = 'jsx';
        }

        const formattedDiff = formatDiff(commit.lineRangeDiff, lang);

        return `
        <details>
            <summary>
                <div class="commit-meta">
                    <span class="hash">${shortHash}</span>
                    <span class="date">${commit.date}</span>
                </div>
                <div class="author">${commit.author}</div>
                <div class="message">${commit.message}</div>
            </summary>
            <div class="diff-container">
                ${formattedDiff}
            </div>
        </details>
        `;
    }).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CodeArch Analysis</title>
        <!-- Load Prism.js and Marked.js from CDN -->
        <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet" />
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <style>
            ${STYLES}
        </style>
    </head>
    <body class="vscode-dark">
        <div class="analysis-header">
            <div class="analysis-title">${analysisTitle}</div>
            
            <div class="scope-badges">
                ${scopeBadgesHtml}
            </div>

            <div class="usage-card">
                <div class="usage-count">${referenceCount}</div>
                <div class="usage-label">
                    project-wide references
                </div>
            </div>

            ${setupNudgeHtml}
        </div>

        ${aiSectionHtml}

        <h2>History Analysis (${result.length} Commits)</h2>
        
        <div class="commit-list">
            ${commitsHtml}
        </div>
        
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
        <script>
            // Render MD for all AI content blocks
            document.querySelectorAll('[data-markdown]').forEach(el => {
                if (window.marked) {
                    el.innerHTML = marked.parse(el.innerHTML);
                }
            });

            if (window.Prism) {
                Prism.plugins.autoloader.languages_path = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
                
                document.addEventListener('click', (e) => {
                    if (e.target.tagName === 'SUMMARY' || e.target.closest('summary')) {
                        setTimeout(() => {
                            Prism.highlightAll();
                        }, 50);
                    }
                });

                Prism.highlightAll();
            }
        </script>
    </body>
    </html>
    `;
}