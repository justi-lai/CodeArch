import * as vscode from 'vscode';

export interface CallHierarchyInfo {
    incomingCalls: vscode.CallHierarchyIncomingCall[];
    outgoingCalls: vscode.CallHierarchyOutgoingCall[];
    item: vscode.CallHierarchyItem;
}

export interface ReferenceInfo {
    definition: vscode.Location | undefined;
    references: vscode.Location[];
    implementations: vscode.Location[];
}

export interface LSPContext {
    callHierarchy: CallHierarchyInfo | undefined;
    references: ReferenceInfo;
    symbols: vscode.DocumentSymbol[];
    workspaceSymbols: vscode.SymbolInformation[];
}

export class LSPCallGraphService {

    async analyzeSymbolContext(
        document: vscode.TextDocument,
        startLine: number,
        endLine: number
    ): Promise<LSPContext> {
        try {
            console.log(`[DEBUG] Analyzing symbol context for ${document.fileName} lines ${startLine}-${endLine}`);
            
            // Find the containing function/class symbol first
            const symbols = await this.getDocumentSymbols(document);
            let containingSymbol = this.findContainingSymbol(symbols, startLine, endLine);
            
            // If LSP symbols aren't available, try AST analysis as fallback
            if (!containingSymbol && symbols.length === 0) {
                console.log(`[DEBUG] No LSP symbols found, trying AST fallback`);
                containingSymbol = await this.findContainingSymbolWithAST(document, startLine, endLine);
            }

            if (containingSymbol) {
                const symbolSource = symbols.length === 0 ? '(from AST fallback)' : '(from LSP)';
                console.log(`[DEBUG] Found containing symbol: ${vscode.SymbolKind[containingSymbol.kind]} "${containingSymbol.name}" ${symbolSource}`);
                
                // Use the containing symbol's position for LSP queries
                let symbolPosition = containingSymbol.range.start;
                console.log(`[DEBUG] Initial symbol position: line ${symbolPosition.line + 1}, char ${symbolPosition.character}`);
                
                // Show what text is at this position
                const line = document.lineAt(symbolPosition.line);
                console.log(`[DEBUG] Text at position: "${line.text.trim()}"`);
                
                // Try to find the method name specifically
                const methodNameIndex = line.text.indexOf(containingSymbol.name);
                if (methodNameIndex !== -1) {
                    symbolPosition = new vscode.Position(symbolPosition.line, methodNameIndex);
                    console.log(`[DEBUG] Adjusted to method name position: line ${symbolPosition.line + 1}, char ${symbolPosition.character}`);
                }
                
                const wordRange = document.getWordRangeAtPosition(symbolPosition);
                const wordAtPosition = wordRange ? document.getText(wordRange) : '<no word>';
                console.log(`[DEBUG] Word at search position: "${wordAtPosition}"`);
                
                const [callHierarchy, references, workspaceSymbols] = await Promise.all([
                    this.getCallHierarchy(document, symbolPosition),
                    this.getReferenceInfo(document, symbolPosition),
                    this.getWorkspaceSymbolsByName(containingSymbol.name)
                ]);

                console.log(`[DEBUG] LSP Results for "${containingSymbol.name}":`);
                console.log(`[DEBUG] - References: ${references.references.length}`);
                console.log(`[DEBUG] - Call hierarchy: ${callHierarchy ? `${callHierarchy.incomingCalls.length} incoming, ${callHierarchy.outgoingCalls.length} outgoing` : 'none'}`);
                console.log(`[DEBUG] - Workspace symbols: ${workspaceSymbols.length}`);

                return {
                    callHierarchy,
                    references,
                    symbols,
                    workspaceSymbols
                };
            } else {
                console.log(`[DEBUG] No containing symbol found, using fallback position`);
                
                // Fallback: use middle of selection
                const middlePosition = new vscode.Position(Math.floor((startLine + endLine) / 2), 0);
                
                const [callHierarchy, references, workspaceSymbols] = await Promise.all([
                    this.getCallHierarchy(document, middlePosition),
                    this.getReferenceInfo(document, middlePosition),
                    this.getWorkspaceSymbols(document, middlePosition)
                ]);

                console.log(`[DEBUG] Fallback LSP Results:`);
                console.log(`[DEBUG] - References: ${references.references.length}`);
                console.log(`[DEBUG] - Call hierarchy: ${callHierarchy ? `${callHierarchy.incomingCalls.length} incoming, ${callHierarchy.outgoingCalls.length} outgoing` : 'none'}`);

                return {
                    callHierarchy,
                    references,
                    symbols,
                    workspaceSymbols
                };
            }
        } catch (error) {
            console.error('LSP Analysis failed:', error);
            return {
                callHierarchy: undefined,
                references: {
                    definition: undefined,
                    references: [],
                    implementations: []
                },
                symbols: [],
                workspaceSymbols: []
            };
        }
    }

    private async getCallHierarchy(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<CallHierarchyInfo | undefined> {
        try {
            // Get call hierarchy items at position
            const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
                'vscode.prepareCallHierarchy',
                document.uri,
                position
            );

            if (!items || items.length === 0) {
                return undefined;
            }

            const item = items[0];

            // Get incoming and outgoing calls
            const [incomingCalls, outgoingCalls] = await Promise.all([
                vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
                    'vscode.provideIncomingCalls',
                    item
                ) || [],
                vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
                    'vscode.provideOutgoingCalls',
                    item
                ) || []
            ]);

            return {
                item,
                incomingCalls: incomingCalls || [],
                outgoingCalls: outgoingCalls || []
            };
        } catch (error) {
            console.error('Call hierarchy analysis failed:', error);
            return undefined;
        }
    }

    private async getReferenceInfo(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<ReferenceInfo> {
        try {
            const [definition, references, implementations] = await Promise.all([
                this.getDefinition(document, position),
                this.getReferences(document, position),
                this.getImplementations(document, position)
            ]);

            return {
                definition,
                references: references || [],
                implementations: implementations || []
            };
        } catch (error) {
            console.error('Reference analysis failed:', error);
            return {
                definition: undefined,
                references: [],
                implementations: []
            };
        }
    }

    private async getDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location | undefined> {
        try {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeDefinitionProvider',
                document.uri,
                position
            );
            return locations && locations.length > 0 ? locations[0] : undefined;
        } catch (error) {
            console.error('Definition lookup failed:', error);
            return undefined;
        }
    }

    private async getReferences(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        try {
            console.log(`[DEBUG] Searching for references at position: line ${position.line + 1}, char ${position.character}`);
            
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                document.uri,
                position
            ) || [];
            
            console.log(`[DEBUG] Found ${references.length} references:`);
            references.forEach((ref, index) => {
                const line = ref.range.start.line + 1;
                const char = ref.range.start.character;
                const fileName = ref.uri.fsPath.split('\\').pop() || ref.uri.fsPath;
                console.log(`[DEBUG] ${index + 1}. ${fileName}:${line}:${char}`);
            });
            
            return references;
        } catch (error) {
            console.error('References lookup failed:', error);
            return [];
        }
    }

    private async getImplementations(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        try {
            return await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeImplementationProvider',
                document.uri,
                position
            ) || [];
        } catch (error) {
            console.error('Implementations lookup failed:', error);
            return [];
        }
    }

    private async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        console.log(`[DEBUG] Getting document symbols for: ${document.uri.toString()}`);
        console.log(`[DEBUG] Document language: ${document.languageId}`);
        console.log(`[DEBUG] Document has ${document.lineCount} lines`);
        console.log(`[DEBUG] Document file scheme: ${document.uri.scheme}`);
        
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            
            console.log(`[DEBUG] Document symbols command returned: ${symbols ? symbols.length : 'null'} symbols`);
            
            if (!symbols || symbols.length === 0) {
                console.log('[DEBUG] No symbols found - checking language server status');
                
                // Check if any extensions are providing language support
                const languageExtensions = vscode.extensions.all.filter(ext => {
                    const contributes = ext.packageJSON?.contributes;
                    if (!contributes) return false;
                    
                    // Check if extension contributes language support
                    const languages = contributes.languages || [];
                    const grammars = contributes.grammars || [];
                    
                    return languages.some((lang: any) => lang.id === document.languageId) ||
                           grammars.some((grammar: any) => grammar.language === document.languageId);
                });
                
                console.log(`[DEBUG] Found ${languageExtensions.length} extensions for language '${document.languageId}':`);
                
                for (const ext of languageExtensions) {
                    console.log(`[DEBUG] - ${ext.id} (active: ${ext.isActive})`);
                    
                    // Try to activate the extension if it's not active
                    if (!ext.isActive) {
                        console.log(`[DEBUG] Attempting to activate extension ${ext.id}`);
                        try {
                            await ext.activate();
                            console.log(`[DEBUG] Successfully activated ${ext.id}`);
                            
                            // Wait a moment for the language server to start
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // Retry symbol lookup after activation
                            const retrySymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                                'vscode.executeDocumentSymbolProvider',
                                document.uri
                            );
                            
                            if (retrySymbols && retrySymbols.length > 0) {
                                console.log(`[DEBUG] Symbol lookup successful after activating ${ext.id}!`);
                                return retrySymbols;
                            }
                        } catch (activationError) {
                            console.log(`[DEBUG] Failed to activate ${ext.id}:`, activationError);
                        }
                    }
                }
                
                // Try alternative approach - check if document is saved
                if (document.isDirty) {
                    console.log('[DEBUG] Document has unsaved changes - this might affect symbol detection');
                }
                
                // Check if file exists
                try {
                    await vscode.workspace.fs.stat(document.uri);
                    console.log('[DEBUG] File exists on filesystem');
                } catch {
                    console.log('[DEBUG] File may not exist on filesystem');
                }
                
                return [];
            }
            
            // Log found symbols for debugging
            console.log(`[DEBUG] Found ${symbols.length} top-level symbols:`);
            symbols.forEach((symbol, index) => {
                const kind = vscode.SymbolKind[symbol.kind];
                console.log(`[DEBUG] ${index + 1}. ${kind} "${symbol.name}" at lines ${symbol.range.start.line + 1}-${symbol.range.end.line + 1}`);
            });
            
            return symbols || [];
        } catch (error) {
            console.error('[DEBUG] Document symbols lookup failed:', error);
            return [];
        }
    }

    private async getWorkspaceSymbols(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.SymbolInformation[]> {
        try {
            // Get the word at position to search for related symbols
            const wordRange = document.getWordRangeAtPosition(position);
            if (!wordRange) {
                return [];
            }

            const word = document.getText(wordRange);
            return await this.getWorkspaceSymbolsByName(word);
        } catch (error) {
            console.error('Workspace symbols lookup failed:', error);
            return [];
        }
    }

    private async getWorkspaceSymbolsByName(symbolName: string): Promise<vscode.SymbolInformation[]> {
        try {
            return await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                symbolName
            ) || [];
        } catch (error) {
            console.error('Workspace symbols by name lookup failed:', error);
            return [];
        }
    }

    private async findContainingSymbolWithAST(
        document: vscode.TextDocument,
        startLine: number,
        endLine: number
    ): Promise<vscode.DocumentSymbol | undefined> {
        try {
            console.log(`[DEBUG] Using AST fallback to find containing symbol`);
            
            // Import AST service dynamically to avoid circular dependencies
            const { ASTAnalysisService } = await import('./astAnalysisService');
            const astService = new ASTAnalysisService();
            
            const content = document.getText();
            const structure = await astService.analyzeCode(
                content, 
                document.languageId, 
                document.fileName, 
                startLine, 
                endLine
            );
            
            if (!structure.functions || structure.functions.length === 0) {
                console.log(`[DEBUG] AST found no functions in document`);
                return undefined;
            }
            
            // Find function that contains the target lines
            const targetStart = startLine - 1; // Convert to 0-based
            const targetEnd = endLine - 1;
            
            for (const func of structure.functions) {
                const funcStartLine = func.startPosition.row;
                const funcEndLine = func.endPosition.row;
                
                if (funcStartLine <= targetStart && funcEndLine >= targetEnd) {
                    const functionName = func.name || 'anonymous';
                    console.log(`[DEBUG] AST found containing function: "${functionName}" at lines ${funcStartLine + 1}-${funcEndLine + 1}`);
                    
                    // Create a mock DocumentSymbol for compatibility
                    const mockSymbol: vscode.DocumentSymbol = {
                        name: functionName,
                        detail: func.text.split('\n')[0] || '', // First line as detail
                        kind: vscode.SymbolKind.Function,
                        range: new vscode.Range(funcStartLine, 0, funcEndLine, 0),
                        selectionRange: new vscode.Range(funcStartLine, 0, funcStartLine, functionName.length),
                        children: []
                    };
                    
                    return mockSymbol;
                }
            }
            
            console.log(`[DEBUG] AST could not find containing function for lines ${startLine}-${endLine}`);
            return undefined;
        } catch (error) {
            console.error(`[DEBUG] AST fallback failed:`, error);
            return undefined;
        }
    }

    private findContainingSymbol(
        symbols: vscode.DocumentSymbol[],
        startLine: number,
        endLine: number
    ): vscode.DocumentSymbol | undefined {
        // Convert to 0-based indexing
        const targetStart = startLine - 1;
        const targetEnd = endLine - 1;

        console.log(`[DEBUG] Looking for symbol containing lines ${startLine}-${endLine} (0-based: ${targetStart}-${targetEnd})`);
        console.log(`[DEBUG] Found ${symbols.length} top-level symbols`);

        // Recursively search through symbols and their children
        const findInSymbols = (symbolList: vscode.DocumentSymbol[], depth = 0): vscode.DocumentSymbol | undefined => {
            const indent = '  '.repeat(depth);
            
            for (const symbol of symbolList) {
                const symbolStart = symbol.range.start.line;
                const symbolEnd = symbol.range.end.line;
                const symbolKind = vscode.SymbolKind[symbol.kind];
                
                console.log(`${indent}[DEBUG] Checking ${symbolKind} "${symbol.name}" at lines ${symbolStart}-${symbolEnd}`);
                
                // Check if the selection is within this symbol's range
                if (symbolStart <= targetStart && symbolEnd >= targetEnd) {
                    console.log(`${indent}[DEBUG] Selection is within ${symbolKind} "${symbol.name}"`);
                    
                    // If this symbol has children, check if any child contains the selection more precisely
                    if (symbol.children && symbol.children.length > 0) {
                        console.log(`${indent}[DEBUG] Checking ${symbol.children.length} children of ${symbol.name}`);
                        const childResult = findInSymbols(symbol.children, depth + 1);
                        if (childResult) {
                            return childResult;
                        }
                    }
                    
                    // Only return function, method, or class symbols
                    if (this.isContainingSymbolType(symbol.kind)) {
                        console.log(`${indent}[DEBUG] Found containing symbol: ${symbolKind} "${symbol.name}"`);
                        return symbol;
                    } else {
                        console.log(`${indent}[DEBUG] Symbol type ${symbolKind} is not a containing type, continuing search`);
                    }
                } else {
                    console.log(`${indent}[DEBUG] Selection not within ${symbolKind} "${symbol.name}" (${symbolStart}-${symbolEnd})`);
                }
            }
            return undefined;
        };

        const result = findInSymbols(symbols);
        console.log(`[DEBUG] Final result: ${result ? `${vscode.SymbolKind[result.kind]} "${result.name}"` : 'No containing symbol found'}`);
        return result;
    }

    private isContainingSymbolType(kind: vscode.SymbolKind): boolean {
        const isContaining = kind === vscode.SymbolKind.Function ||
                            kind === vscode.SymbolKind.Method ||
                            kind === vscode.SymbolKind.Class ||
                            kind === vscode.SymbolKind.Interface ||
                            kind === vscode.SymbolKind.Constructor ||
                            kind === vscode.SymbolKind.Module ||
                            kind === vscode.SymbolKind.Namespace ||
                            kind === vscode.SymbolKind.Property || // Sometimes methods show up as properties
                            kind === vscode.SymbolKind.Field;     // Sometimes class methods show as fields
        
        console.log(`[DEBUG] Symbol kind ${vscode.SymbolKind[kind]} is ${isContaining ? '' : 'NOT '}a containing type`);
        return isContaining;
    }

    formatLSPContextForPrompt(context: LSPContext): string {
        let formatted = `# LSP Analysis\n\n`;

        // Call hierarchy information
        if (context.callHierarchy) {
            const { item, incomingCalls, outgoingCalls } = context.callHierarchy;
            
            formatted += `## Current Symbol: ${item.name}\n`;
            formatted += `- Kind: ${vscode.SymbolKind[item.kind]}\n`;
            formatted += `- Location: ${this.formatLocation(item.uri, item.range)}\n\n`;

            if (incomingCalls.length > 0) {
                formatted += `## Called By (${incomingCalls.length} callers):\n`;
                incomingCalls.slice(0, 10).forEach(call => { // Limit to 10 for context size
                    formatted += `- ${call.from.name} (${vscode.SymbolKind[call.from.kind]}) at ${this.formatLocation(call.from.uri, call.from.range)}\n`;
                });
                if (incomingCalls.length > 10) {
                    formatted += `- ... and ${incomingCalls.length - 10} more callers\n`;
                }
                formatted += '\n';
            }

            if (outgoingCalls.length > 0) {
                formatted += `## Calls To (${outgoingCalls.length} callees):\n`;
                outgoingCalls.slice(0, 10).forEach(call => { // Limit to 10 for context size
                    formatted += `- ${call.to.name} (${vscode.SymbolKind[call.to.kind]}) at ${this.formatLocation(call.to.uri, call.to.range)}\n`;
                });
                if (outgoingCalls.length > 10) {
                    formatted += `- ... and ${outgoingCalls.length - 10} more callees\n`;
                }
                formatted += '\n';
            }
        }

        // Reference information
        const { references, implementations, definition } = context.references;
        
        if (definition) {
            formatted += `## Definition:\n`;
            formatted += `- ${this.formatLocation(definition.uri, definition.range)}\n\n`;
        }

        if (references.length > 0) {
            formatted += `## References (${references.length} total):\n`;
            references.slice(0, 15).forEach(ref => { // Limit to 15 for context size
                formatted += `- ${this.formatLocation(ref.uri, ref.range)}\n`;
            });
            if (references.length > 15) {
                formatted += `- ... and ${references.length - 15} more references\n`;
            }
            formatted += '\n';
        }

        if (implementations.length > 0) {
            formatted += `## Implementations:\n`;
            implementations.forEach(impl => {
                formatted += `- ${this.formatLocation(impl.uri, impl.range)}\n`;
            });
            formatted += '\n';
        }

        // Document symbols (high-level structure)
        if (context.symbols.length > 0) {
            formatted += `## File Structure:\n`;
            this.formatDocumentSymbols(context.symbols, formatted, 0);
            formatted += '\n';
        }

        return formatted;
    }

    private formatDocumentSymbols(symbols: vscode.DocumentSymbol[], output: string, indent: number): string {
        const prefix = '  '.repeat(indent);
        symbols.forEach(symbol => {
            output += `${prefix}- ${symbol.name} (${vscode.SymbolKind[symbol.kind]}) Line ${symbol.range.start.line + 1}\n`;
            if (symbol.children && symbol.children.length > 0) {
                output = this.formatDocumentSymbols(symbol.children, output, indent + 1);
            }
        });
        return output;
    }

    private formatLocation(uri: vscode.Uri, range: vscode.Range): string {
        const fileName = uri.fsPath.split(/[/\\]/).pop() || uri.fsPath;
        return `${fileName}:${range.start.line + 1}:${range.start.character + 1}`;
    }

    calculateCriticality(context: LSPContext): 'high' | 'medium' | 'low' {
        const { callHierarchy, references } = context;
        
        let score = 0;
        
        // High usage of containing symbol indicates high criticality
        if (references.references.length > 15) {
            score += 3;
        } else if (references.references.length > 5) {
            score += 2;
        } else if (references.references.length > 1) {
            score += 1;
        }

        // Many incoming calls to containing symbol indicates high criticality
        if (callHierarchy) {
            if (callHierarchy.incomingCalls.length > 8) {
                score += 3;
            } else if (callHierarchy.incomingCalls.length > 3) {
                score += 2;
            } else if (callHierarchy.incomingCalls.length > 0) {
                score += 1;
            }

            // Functions/methods that are public APIs or widely used are more critical
            const symbolKind = callHierarchy.item.kind;
            if (symbolKind === vscode.SymbolKind.Class || 
                symbolKind === vscode.SymbolKind.Interface ||
                symbolKind === vscode.SymbolKind.Constructor) {
                score += 1; // Classes and interfaces tend to be more critical
            }
        }

        // Cross-file references increase criticality
        const crossFileRefs = references.references.filter(ref => 
            ref.uri.fsPath !== (references.definition?.uri.fsPath || '')
        );
        if (crossFileRefs.length > 3) {
            score += 2;
        } else if (crossFileRefs.length > 0) {
            score += 1;
        }

        if (score >= 6) return 'high';
        if (score >= 3) return 'medium';
        return 'low';
    }
}