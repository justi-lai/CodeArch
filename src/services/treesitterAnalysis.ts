import * as vscode from 'vscode';
import * as path from 'path';
import Parser from 'web-tree-sitter';

export interface EnclosingScope {
    type: string;
    name: string;
    range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    nameRange?: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
}

export interface ScopeAnalysisResult {
    enclosingScopes: EnclosingScope[];
}

export class TreeSitterAnalysis {
    private parser: Parser | undefined;
    private languages: Map<string, Parser.Language> = new Map();

    constructor(private context: vscode.ExtensionContext) { }

    public async initialize(): Promise<void> {
        if (this.parser) {
            return;
        }

        try {
            await Parser.init({
                locateFile: (scriptName: string) => {
                    return path.join(this.context.extensionPath, 'node_modules', 'web-tree-sitter', scriptName);
                }
            });
            this.parser = new Parser();
            console.log('Tree-sitter initialized successfully.');
        } catch (error) {
            console.error('Failed to initialize Tree-sitter:', error);
            throw new Error('Tree-sitter initialization failed.');
        }
    }

    public async getScopeInfo(document: vscode.TextDocument, range: vscode.Range): Promise<ScopeAnalysisResult> {
        const tree = await this.parse(document);
        if (!tree) {
            return { enclosingScopes: [] };
        }

        const startIndex = document.offsetAt(range.start);
        const endIndex = document.offsetAt(range.end);

        let node: Parser.SyntaxNode | null = tree.rootNode.descendantForIndex(startIndex, endIndex);
        const enclosingScopes: EnclosingScope[] = [];

        while (node) {
            if (this.isInterestingScope(node)) {
                const details = this.getScopeDetails(node);
                enclosingScopes.push({
                    type: node.type,
                    name: details.name,
                    range: {
                        startLine: node.startPosition.row + 1,
                        startColumn: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        endColumn: node.endPosition.column
                    },
                    nameRange: details.range
                });
            }
            node = node.parent;
        }

        return { enclosingScopes };
    }

    private isInterestingScope(node: Parser.SyntaxNode): boolean {
        const interestingTypes = [
            'function_declaration',
            'method_definition',
            'class_declaration',
            'arrow_function',
            'function_expression',
            'interface_declaration',
            'enum_declaration',
            'module_declaration',
            'namespace_definition'
        ];

        return interestingTypes.includes(node.type) || node.type.includes('declaration') || node.type.includes('definition');
    }

    private getScopeDetails(node: Parser.SyntaxNode): { name: string, range?: EnclosingScope['range'] } {
        const nameNode = node.childForFieldName('name') ||
            node.children.find((c: Parser.SyntaxNode) => c.type === 'identifier' || c.type === 'property_identifier');

        if (nameNode) {
            return {
                name: nameNode.text,
                range: {
                    startLine: nameNode.startPosition.row + 1,
                    startColumn: nameNode.startPosition.column,
                    endLine: nameNode.endPosition.row + 1,
                    endColumn: nameNode.endPosition.column
                }
            };
        }

        if (node.type === 'arrow_function' || node.type === 'function_expression') {
            return { name: '(anonymous)' };
        }

        return { name: node.type };
    }

    private async getLanguage(languageId: string): Promise<Parser.Language | undefined> {
        if (this.languages.has(languageId)) {
            return this.languages.get(languageId);
        }

        const wasmName = this.getWasmName(languageId);
        if (!wasmName) {
            return undefined;
        }

        const wasmPath = path.join(this.context.extensionPath, 'parsers', wasmName);

        try {
            const lang = await Parser.Language.load(wasmPath);
            this.languages.set(languageId, lang);
            return lang;
        } catch (error) {
            console.error(`Failed to load WASM for language ${languageId} from ${wasmPath}:`, error);
            return undefined;
        }
    }

    private getWasmName(languageId: string): string | undefined {
        const map: Record<string, string> = {
            'typescript': 'tree-sitter-typescript.wasm',
            'javascript': 'tree-sitter-javascript.wasm',
            'typescriptreact': 'tree-sitter-tsx.wasm',
            'javascriptreact': 'tree-sitter-javascript.wasm',
            'python': 'tree-sitter-python.wasm',
            'go': 'tree-sitter-go.wasm',
            'java': 'tree-sitter-java.wasm',
            'cpp': 'tree-sitter-cpp.wasm',
            'c': 'tree-sitter-c.wasm',
            'rust': 'tree-sitter-rust.wasm',
            'ruby': 'tree-sitter-ruby.wasm',
            'php': 'tree-sitter-php.wasm',
            'csharp': 'tree-sitter-c_sharp.wasm',
            'shellscript': 'tree-sitter-bash.wasm',
            'swift': 'tree-sitter-swift.wasm',
            'kotlin': 'tree-sitter-kotlin.wasm'
        };
        return map[languageId];
    }

    public async parse(document: vscode.TextDocument): Promise<Parser.Tree | undefined> {
        if (!this.parser) {
            await this.initialize();
        }

        const lang = await this.getLanguage(document.languageId);
        if (!lang || !this.parser) {
            return undefined;
        }

        this.parser.setLanguage(lang);
        return this.parser.parse(document.getText());
    }
}
