# CodeArch: Code Archaeology Assistant

**CodeArch** is a VS Code extension that transforms code investigation from a time-consuming manual process into a single, seamless action. By highlighting any block of code, developers can instantly receive a rich, AI-powered narrative history that explains the "why" behind the code using advanced evolution-based git analysis.

## Key Features

### **Evolution-Based Line Tracking**

- **Precision Analysis**: Uses `git blame` to track the exact evolution of selected lines across commits
- **Smart File Movement Detection**: Automatically handles file renames and moves to provide complete history
- **Targeted Diffs**: Shows only the git changes that actually affected your selected code, not generic commit diffs

### **Multi-Provider AI Assistant**

- **Multiple AI Providers**: Choose between Gemini, OpenAI (GPT-4), Claude (Anthropic), and Hugging Face models
- **Context-Aware Responses**: Automatically adapts responses based on detected libraries, patterns, and terminology
- **Flexible Configuration**: Switch between providers and models based on your preferences and requirements

### **Intelligent Chat Interface**

- **Contextual Conversations**: Chat with AI about your code with automatic context from CodeArch analysis
- **Multi-Context Support**: Add file contents, highlighted code, git diffs, and analysis results to chat conversations
- **GitHub Copilot-Style UI**: Clean, minimal interface with example prompts and capability discovery

### **Interactive Timeline & GitHub Integration**

- **Chronological History**: Browse through commits that actually modified your selected lines
- **GitHub PR Context**: Seamlessly integrates PR descriptions, comments, and linked issues
- **Expandable Details**: Click to see full commit diffs, PR discussions, and historical context
- **Direct GitHub Links**: Jump to GitHub for complete context

## How It Works

### Code Archaeology Workflow

1. **Select Code**: Highlight any block of code in a Git repository
2. **Right-Click**: Choose "CodeArch: Analyze Selection" from the context menu
3. **Evolution Tracking**: CodeArch uses `git blame` to identify which commits modified those exact lines
4. **Smart Diff Extraction**: For each commit, extracts only the diff hunks that intersected with your selection
5. **AI Analysis**: Feeds commit messages, surrounding code context, and PR information to your chosen AI provider
6. **Confident Results**: Get definitive explanations of why the code exists and how it evolved

## Prerequisites

### Required Dependencies

1. **Git**: Version control system

   - Windows: Download from [git-scm.com](https://git-scm.com/download/win)
   - macOS: `brew install git` or download from [git-scm.com](https://git-scm.com/download/mac)
   - Linux: `sudo apt install git` (Ubuntu/Debian) or `sudo yum install git` (RHEL/CentOS)

2. **GitHub CLI**: For GitHub integration

   - Windows: `winget install GitHub.cli` or download from [cli.github.com](https://cli.github.com/)
   - macOS: `brew install gh`
   - Linux: Follow [GitHub CLI installation guide](https://github.com/cli/cli/blob/trunk/docs/install_linux.md)

3. **GitHub Authentication**: After installing GitHub CLI:

   ```bash
   gh auth login
   ```

4. **AI Provider API Key**: Choose one:
   - **Google AI Studio**: [makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey) (Free tier available)
   - **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (Paid API)
   - **Anthropic Claude**: [console.anthropic.com](https://console.anthropic.com) (Paid API)
   - **Hugging Face**: [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (Free with rate limits)

## Installation

### From VS Code Marketplace

1. Search for "CodeArch" in VS Code Extensions
2. Click Install

### From VSIX File

1. Download the latest `.vsix` file from releases
2. Open VS Code → Command Palette (`Ctrl+Shift+P`)
3. Run "Extensions: Install from VSIX"
4. Select the downloaded file

## Setup

1. **Configure Your AI Provider**

   - Open VS Code Settings (`Ctrl+,` → Extensions → CodeArch)
   - Set your AI provider (Gemini/OpenAI/Claude/Hugging Face)
   - The extension will prompt you to enter your API key when first used

2. **Select Your Model**

   - Use `Ctrl+Shift+P` and run "CodeArch: Select Model"
   - Choose from available models for your provider

3. **Start Analyzing**

   - Right-click on selected code and choose "CodeArch: Analyze Selection"
   - Open the CodeArch sidebar panel for results and chat

4. **Verify Setup**: CodeArch automatically checks dependencies on first use

## Usage Example

### Understanding Complex Code

```javascript
function debounceWithImmediate(func, wait, immediate) {
  var timeout;
  return function executedFunction() {
    var context = this;
    var args = arguments;
    var later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    var callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}
```

**CodeArch Analysis Result:**

> **WHY THIS CODE EXISTS:**
> This debounce implementation handles both trailing and leading edge execution patterns to solve performance issues with rapid user input events. The immediate flag was added after issue #156 revealed that search autocomplete needed instant feedback on the first keystroke.

> **EVOLUTION & DECISIONS:**
> Originally implemented as simple trailing debounce, but PR #234 added immediate execution support when users complained about delayed search results. The complex timeout logic ensures both patterns work correctly without interference.

## What Makes CodeArch Different

### Traditional Approach

- Manually dig through `git log` and `git blame`
- Search for related PRs and issues
- Piece together context from multiple sources
- Spend 15-30 minutes per investigation

### CodeArch Approach

- Select code → right-click → instant analysis
- Evolution-based tracking finds exact relevant commits
- AI explains purpose based on rich context
- Get definitive answers in seconds
- Integrated chat interface for follow-up questions

## Configuration

### AI Provider Setup

1. **Configure API Key**: Run `CodeArch: Configure API Key` from Command Palette
2. **Choose Provider**: Open Settings (`Ctrl+,`) → Search "CodeArch" → Select AI Provider
3. **Select Model**: Use `Ctrl+Shift+P` → "CodeArch: Select Model"

### Available Models by Provider

**Gemini Models**:

- **Gemini 2.0 Flash** (default) - Fast and efficient
- **Gemini 2.5 Flash** - Advanced flash model
- **Gemini 2.5 Pro** - Most capable Gemini model

**OpenAI Models**:

- **GPT-4o Mini** (default) - Fast, cost-effective
- **GPT-4o** - More capable
- **GPT-4** - Latest stable model

**Claude Models**:

- **Claude Sonnet 3.5** (default) - Best balance of performance and cost
- **Claude Haiku** - Fastest Claude model
- **Claude Opus** - Most capable Claude model

**Hugging Face**:

- **Custom Model ID** - Enter any Hugging Face model ID

## Troubleshooting

### Common Issues

**"Git command not found"**

- Install Git and ensure it's in your PATH
- Restart VS Code after installation

**"GitHub CLI not found"**

- Install GitHub CLI and authenticate with `gh auth login`
- Verify installation with `gh --version`

**"Not a git repository"**

- Open a Git-tracked project
- Initialize with `git init` if needed

**"API key invalid"**

- Reconfigure API key: Command Palette → "CodeArch: Configure API Key"
- Check API quota and billing status

**"No evolution data found"**

- File might be newly created
- Ensure repository is up-to-date with `git pull`
- Selected code might not have substantial git history

### Debug Information

- Open VS Code Developer Console (F12) for detailed logs
- Look for `[CodeArch]` prefixed messages
- Error dialogs include "View Details" for comprehensive debugging

## Contributing

Created for **HackRice 2025**. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

### Development Setup

```bash
git clone https://github.com/justi-lai/HackRice2025.git
cd HackRice2025
npm install
npm run compile
# Open in VS Code and press F5 to debug
```

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

Copyright 2025 Justin Lai

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Acknowledgments

- **HackRice 2025** - Where this project was born
- **VS Code Extension API** - Excellent development platform
- **AI Providers** - Gemini, OpenAI, Claude, and Hugging Face for powering intelligent code analysis
- **GitHub CLI** - Seamless GitHub integration
- **Git** - The foundation that makes code archaeology possible
