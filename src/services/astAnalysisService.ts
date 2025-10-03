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

const Parser = require('tree-sitter');

// Type definitions for tree-sitter
interface SyntaxNode {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    childCount: number;
    child(index: number): SyntaxNode | null;
}

// Language parsers - we'll import them as needed
let TypeScriptParser: any;
let JavaScriptParser: any;
let PythonParser: any;
let JavaParser: any;
let CParser: any;
let CppParser: any;
let CSharpParser: any;
let GoParser: any;
let RustParser: any;

export interface ASTNode {
    type: string;
    name?: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    text: string;
    children: ASTNode[];
}

export interface CodeStructure {
    language: string;
    functions: ASTNode[];
    classes: ASTNode[];
    interfaces: ASTNode[];
    variables: ASTNode[];
    imports: ASTNode[];
    exports: ASTNode[];
    containingFunction?: ASTNode;
    containingClass?: ASTNode;
}

export class ASTAnalysisService {
    private parser: any;
    private parsersCache: Map<string, any> = new Map();

    constructor() {
        this.parser = new Parser();
    }

    async analyzeCode(
        code: string,
        language: string,
        startLine: number,
        endLine: number
    ): Promise<CodeStructure> {
        try {
            // Set up the parser for the specific language
            await this.setupParser(language);
            
            // Parse the entire file
            const tree = this.parser.parse(code);
            const rootNode = tree.rootNode;

            // Extract code structure
            const structure: CodeStructure = {
                language,
                functions: [],
                classes: [],
                interfaces: [],
                variables: [],
                imports: [],
                exports: []
            };

            // Traverse the AST and extract relevant nodes
            this.traverseNode(rootNode, structure, code);

            // Find the containing function/class for the selected code
            this.findContainingElements(structure, startLine, endLine);

            return structure;
        } catch (error) {
            console.error('AST Analysis failed:', error);
            return {
                language,
                functions: [],
                classes: [],
                interfaces: [],
                variables: [],
                imports: [],
                exports: []
            };
        }
    }

    private async setupParser(language: string): Promise<void> {
        if (this.parsersCache.has(language)) {
            this.parser.setLanguage(this.parsersCache.get(language));
            return;
        }

        let parserModule: any;
        
        try {
            switch (language.toLowerCase()) {
                case 'typescript':
                case 'ts':
                    if (!TypeScriptParser) {
                        TypeScriptParser = require('tree-sitter-typescript').typescript;
                    }
                    parserModule = TypeScriptParser;
                    break;
                case 'javascript':
                case 'js':
                    if (!JavaScriptParser) {
                        JavaScriptParser = require('tree-sitter-javascript');
                    }
                    parserModule = JavaScriptParser;
                    break;
                case 'python':
                case 'py':
                    if (!PythonParser) {
                        PythonParser = require('tree-sitter-python');
                    }
                    parserModule = PythonParser;
                    break;
                case 'java':
                    if (!JavaParser) {
                        JavaParser = require('tree-sitter-java');
                    }
                    parserModule = JavaParser;
                    break;
                case 'c':
                    if (!CParser) {
                        CParser = require('tree-sitter-c');
                    }
                    parserModule = CParser;
                    break;
                case 'cpp':
                case 'c++':
                    if (!CppParser) {
                        CppParser = require('tree-sitter-cpp');
                    }
                    parserModule = CppParser;
                    break;
                case 'csharp':
                case 'c#':
                    if (!CSharpParser) {
                        CSharpParser = require('tree-sitter-c-sharp');
                    }
                    parserModule = CSharpParser;
                    break;
                case 'go':
                    if (!GoParser) {
                        GoParser = require('tree-sitter-go');
                    }
                    parserModule = GoParser;
                    break;
                case 'rust':
                case 'rs':
                    if (!RustParser) {
                        RustParser = require('tree-sitter-rust');
                    }
                    parserModule = RustParser;
                    break;
                default:
                    throw new Error(`Unsupported language: ${language}`);
            }

            this.parsersCache.set(language, parserModule);
            this.parser.setLanguage(parserModule);
        } catch (error) {
            throw new Error(`Failed to setup parser for ${language}: ${error}`);
        }
    }

    private traverseNode(node: SyntaxNode, structure: CodeStructure, sourceCode: string): void {
        const astNode: ASTNode = {
            type: node.type,
            name: this.extractNodeName(node),
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            text: node.text,
            children: []
        };

        // Categorize nodes based on type
        switch (node.type) {
            case 'function_declaration':
            case 'function_definition':
            case 'method_definition':
            case 'function_expression':
            case 'arrow_function':
                structure.functions.push(astNode);
                break;
            case 'class_declaration':
            case 'class_definition':
                structure.classes.push(astNode);
                break;
            case 'interface_declaration':
                structure.interfaces.push(astNode);
                break;
            case 'variable_declaration':
            case 'variable_declarator':
            case 'let_declaration':
            case 'const_declaration':
                structure.variables.push(astNode);
                break;
            case 'import_statement':
            case 'import_declaration':
            case 'from_import':
                structure.imports.push(astNode);
                break;
            case 'export_statement':
            case 'export_declaration':
                structure.exports.push(astNode);
                break;
        }

        // Recursively traverse children
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                this.traverseNode(child, structure, sourceCode);
            }
        }
    }

    private extractNodeName(node: SyntaxNode): string | undefined {
        // Try to find identifier nodes that represent the name
        const identifierTypes = ['identifier', 'property_identifier', 'type_identifier'];
        
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && identifierTypes.includes(child.type)) {
                return child.text;
            }
        }

        // For some node types, extract name from specific patterns
        switch (node.type) {
            case 'function_declaration':
            case 'class_declaration':
                // Look for the first identifier after the keyword
                const nameNode = this.findChildByType(node, 'identifier');
                return nameNode?.text;
        }

        return undefined;
    }

    private findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === type) {
                return child;
            }
        }
        return null;
    }

    private findContainingElements(structure: CodeStructure, startLine: number, endLine: number): void {
        // Convert to 0-based indexing for comparison with AST positions
        const targetStart = startLine - 1;
        const targetEnd = endLine - 1;

        // Find containing function
        structure.containingFunction = this.findContainingNode(structure.functions, targetStart, targetEnd);
        
        // Find containing class
        structure.containingClass = this.findContainingNode(structure.classes, targetStart, targetEnd);
    }

    private findContainingNode(nodes: ASTNode[], targetStart: number, targetEnd: number): ASTNode | undefined {
        return nodes.find(node => 
            node.startPosition.row <= targetStart && 
            node.endPosition.row >= targetEnd
        );
    }

    async getLanguageFromFile(filePath: string): Promise<string> {
        const extension = filePath.split('.').pop()?.toLowerCase();
        
        switch (extension) {
            case 'ts': return 'typescript';
            case 'js': return 'javascript';
            case 'py': return 'python';
            case 'java': return 'java';
            case 'c': return 'c';
            case 'cpp': case 'cc': case 'cxx': return 'cpp';
            case 'cs': return 'csharp';
            case 'go': return 'go';
            case 'rs': return 'rust';
            default: return 'unknown';
        }
    }

    formatStructureForContext(structure: CodeStructure): string {
        let context = `# Code Structure Analysis (${structure.language})\n\n`;

        if (structure.containingClass) {
            context += `## Containing Class: ${structure.containingClass.name || 'Anonymous'}\n`;
            context += `- Location: Line ${structure.containingClass.startPosition.row + 1}-${structure.containingClass.endPosition.row + 1}\n\n`;
        }

        if (structure.containingFunction) {
            context += `## Containing Function: ${structure.containingFunction.name || 'Anonymous'}\n`;
            context += `- Location: Line ${structure.containingFunction.startPosition.row + 1}-${structure.containingFunction.endPosition.row + 1}\n\n`;
        }

        if (structure.classes.length > 0) {
            context += `## Classes in File:\n`;
            structure.classes.forEach(cls => {
                context += `- ${cls.name || 'Anonymous'} (Line ${cls.startPosition.row + 1})\n`;
            });
            context += '\n';
        }

        if (structure.functions.length > 0) {
            context += `## Functions in File:\n`;
            structure.functions.forEach(func => {
                context += `- ${func.name || 'Anonymous'} (Line ${func.startPosition.row + 1})\n`;
            });
            context += '\n';
        }

        if (structure.imports.length > 0) {
            context += `## Dependencies/Imports:\n`;
            structure.imports.forEach(imp => {
                context += `- ${imp.text.trim()}\n`;
            });
            context += '\n';
        }

        return context;
    }
}