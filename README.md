# CodeArch
**AI-Powered Code History & Intent Synthesis for VS Code**

CodeArch is a sophisticated code auditing extension that bridges the gap between the current state of your code, its historical intent, and its project-wide impact. It uses a combination of **Tree-sitter**, **Git**, and **LLMs** (Gemini, OpenAI, Claude) to provide deep insights into *why* a piece of code exists and how risky it is to change.

## Key Features

- **Audit Synthesis**: Generates a structured "Audit Report" that synthesizes Git history, logical scope (classes/methods), and project-wide usage statistics.
- **Historical Intent Discovery**: Leverages `git log -L` mapping to trace the specific evolution of the selected lines across every commit.
- **Structural Awareness**: Uses WASM-powered Tree-sitter grammars to identify the exact logical container (Function, Class, Method) of your selection.
- **Blast Radius Analysis**: Automatically calculates how many other places in your workspace reference the code you're auditing.
- **Multi-Provider AI**: Supports the latest 2025/2026 models from **Google Gemini**, **OpenAI**, and **Anthropic Claude**.
- **Privacy-First (Air-Gapped)**: Support for local LLM engines (Ollama, vLLM, LM Studio) via custom OpenAI-compatible endpoints.
- **Secure by Design**: API keys are stored safely in your OS keychain using VS Code's native Secrets Storage.

## Installation & Setup

1. **Install from Marketplace**: Search for **CodeArch** in the VS Code Extensions view (`Ctrl+Shift+X`) and click **Install**.
2. **Configure AI**:
   - Open the Command Palette (`Cmd/Ctrl+Shift+P`).
   - Run **CodeArch: Configure AI Provider**.
   - Select your preferred model (Gemini, OpenAI, or Claude) and enter your API key when prompted.

> **Note**: Tier 1 language parsers (JS, TS, Python, Go, etc.) are pre-bundled. If you are building from source, run `npm run fetch-parsers` to initialize the grammar binaries.

## How to Use

1. **Highlight** any block of code in your editor.
2. **Right-click** and select **CodeArch: Analyze Selected Code** (or use the Command Palette).
3. A side-by-side **Audit Report** will open, showing:
   - **Intent & History**: Why this code exists based on Git metadata.
   - **Code Logic & Oversights**: Detection of hacks, dead code, or temporary fixes.
   - **Risk Assessment**: The potential impact of modifying this logic.
   - **Final Verdict**: A clear recommendation for the code's health.
   - **Full History**: Interactive diffs of every relevant commit.

## Supported Languages

CodeArch currently provides Tier 1 support for:
- TypeScript / TSX
- JavaScript / JSX
- Python
- Go
- Java
- C / C++ / C#
- Rust
- Ruby
- PHP
- Swift / Kotlin
- Shell (Bash)

## Origin & Recognition

CodeArch was originally conceived at **HackRice 2025**, where it was awarded **First Place** in the **Warp Dev Track** for the "Best Developer Tool." This version of CodeArch represents a complete, lightweight overhaul of that initial proof-of-concept, focused on refined performance and deep logic synthesis.

## License

This project is licensed under the MIT License. See the [LICENSE.txt](LICENSE.txt) file for details.

---
**Happy Auditing!**
