# Change Log

All notable changes to the "codearch" extension will be documented in this file.

## [1.1.1] - 2026-01-02

### Added
- **Custom LLM Provider**: Support for local/on-premise engines (Ollama, vLLM) and aggregators (OpenRouter) via OpenAI-compatible endpoints.

## [1.1.0] - 2026-01-02

### Added
- **AI Synthesis Engine**: Complete integration with Gemini, OpenAI, and Claude models.
- **Deep Git Integration**: Implementation of `git log -L` to track line-level intent across history.
- **Tree-sitter Scope Analysis**: Robust detection of logical code containers (methods, classes, functions) across 15+ languages.
- **Audit Dashboard**: A native-styled VS Code webview providing a synthesized "Senior Auditor" report.
- **Secure Secret Storage**: Safe management of AI API keys using VS Code's native `SecretStorage`.
- **Project-wide Impact Stats**: Integration with VS Code reference providers to identify "Blast Radius".
- **Language Expansion**: Support for 15 major languages via on-demand WASM parser loading.
- **Native JSON Mode**: Guaranteed structured responses from AI models.