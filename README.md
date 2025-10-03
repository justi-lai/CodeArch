# CodeArch: Code Archaeology Assistant

## How It Works

### Code Archaeology Workflow

1. **Select Code**: Highlight any block of code in a Git repository
2. **Right-Click**: Choose "CodeArch: Analyze Selection" from the context menu
3. **Evolution Tracking**: CodeArch uses `git blame` to identify which commits modified those exact lines
4. **Smart Diff Extraction**: For each commit, extracts only the diff hunks that intersected with your selection
5. **AI Analysis**: Feeds commit messages, surrounding code context, and PR information to your chosen AI provider
6. **Confident Results**: Get definitive explanations of why the code exists and how it evolved

**CodeArch** is a VS Code extension that transforms code investigation from a time-consuming manual process into a single, seamless action. By highlighting any block of code, developers can instantly receive a rich, AI-powered narrative history that explains the "why" behind the code using advanced evolution-based git analysis with support for multiple AI providers including Gemini, OpenAI, Claude, and Hugging Face.

## Key Features

### **Evolution-Based Line Tracking**

- **Precision Analysis**: Uses `git blame` to track the exact evolution of selected lines across commits
- **Smart File Movement Detection**: Automatically handles file renames and moves to provide complete history
- **Targeted Diffs**: Shows only the git changes that actually affected your selected code, not generic commit diffs

### **Multi-Provider AI Assistant**

- **Multiple AI Providers**: Choose between Gemini, OpenAI (GPT-4), Claude (Anthropic), and Hugging Face models
- **Code Mode**: Provides definitive insights for general software development using commit messages, code comments, and surrounding context
- **Context-Aware Responses**: Automatically adapts responses based on detected libraries, patterns, and terminology
- **Flexible Configuration**: Switch between providers and models based on your preferences and requirements

### **Intelligent Chat Interface**

- **Contextual Conversations**: Chat with AI about your code with automatic context from CodeArch analysis
- **Multi-Context Support**: Add file contents, highlighted code, git diffs, and analysis results to chat conversations
- **Adaptive AI Responses**: Automatically adapts conversation style based on your selected provider and code context
- **GitHub Copilot-Style UI**: Clean, minimal interface with example prompts and capability discovery

### **Interactive Timeline & GitHub Integration**

- **Chronological History**: Browse through commits that actually modified your selected lines
- **GitHub PR Context**: Seamlessly integrates PR descriptions, comments, and linked issues
- **Expandable Details**: Click to see full commit diffs, PR discussions, and historical context
- **Direct GitHub Links**: Jump to GitHub for complete context

### **Polished User Experience**

- **Professional UI**: Clean, VS Code-native design optimized for sidebar viewing
- **Responsive Layout**: Efficiently uses available space with smart text wrapping and spacing
- **Secure Storage**: Uses VS Code's secure credential storage for API keys

## How It Works

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

4. **Google AI Studio API Key**:
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key (starts with "AIza...")

## Installation

### From VS Code Marketplace (Coming Soon)

1. Search for "CodeArch" in VS Code Extensions
2. Click Install

### From VSIX File

1. Download the latest `.vsix` file from releases
2. Open VS Code → Command Palette (`Ctrl+Shift+P`)
3. Run "Extensions: Install from VSIX"
4. Select the downloaded file

## Setup

1. **Configure Your AI Provider**

   - Open VS Code Settings (Ctrl+Comma > Extensions > CodeArch)
   - Set your AI provider (Gemini/OpenAI/Claude/Hugging Face)
   - The extension will prompt you to enter your API key when first used

2. **Select Your Model**

   - Use Ctrl+Shift+P and run "CodeArch: Select Model"
   - Choose from available models for your provider
   - Models are automatically filtered based on your selected AI provider

3. **Start Analyzing**

   - Right-click any file and select "Analyze with CodeArch"
   - Use Ctrl+Shift+P and run "CodeArch: Analyze Current File"
   - Open the chat panel for interactive analysis

4. **Verify Setup**: CodeArch automatically checks dependencies on first use

## Usage Examples

### Understanding Complex Trading Logic

```python
def calculate_portfolio_var(positions, correlation_matrix, confidence_level=0.95):
    # Complex VaR calculation - why this specific approach?
    portfolio_variance = np.dot(positions.T, np.dot(correlation_matrix, positions))
    portfolio_std = np.sqrt(portfolio_variance)
    z_score = norm.ppf(confidence_level)
    return portfolio_std * z_score
```

**CodeArch Analysis Result (Finance Mode):**

> **WHY THIS CODE EXISTS:**
> This Value-at-Risk implementation uses the parametric approach to meet regulatory risk reporting requirements. The correlation matrix method was chosen over Monte Carlo simulation for daily risk calculations due to performance requirements specified in issue #89.

> **FINANCIAL CONTEXT:**
> This VaR calculation follows Basel III guidelines for market risk assessment. The 95% confidence level is mandated by internal risk policies, and the correlation matrix approach ensures sub-second calculation times for the real-time risk dashboard.

### Investigating Performance Optimizations

```javascript
// You see this confusing function and wonder why it's so complex
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

**CodeArch Analysis Result (Code Mode):**

> **WHY THIS CODE EXISTS:**
> This debounce implementation handles both trailing and leading edge execution patterns to solve performance issues with rapid user input events. The immediate flag was added after issue #156 revealed that search autocomplete needed instant feedback on the first keystroke.

> **EVOLUTION & DECISIONS:**
> Originally implemented as simple trailing debounce, but PR #234 added immediate execution support when users complained about delayed search results. The complex timeout logic ensures both patterns work correctly without interference.

### Financial Chat Interface Example

```
User: "How can I optimize this backtesting strategy?"
[Code context automatically added from current selection]

CodeArch (Finance Mode): "Based on your Zipline strategy code, I can see several optimization opportunities:

1. **Vectorization**: Your current position sizing logic uses loops. Consider using pandas vectorized operations for the moving average calculations.

2. **Commission Model**: You're using the default commission model. For more accurate backtesting, implement a tiered commission structure based on your actual broker fees.

3. **Slippage Modeling**: Consider adding realistic slippage models, especially for the momentum-based entries you're using.

Would you like me to show specific code improvements for any of these areas?"
```

## What Makes CodeArch Different

### Traditional Approach

- Manually dig through `git log` and `git blame`
- Search for related PRs and issues
- Piece together context from multiple sources
- Guess at the reasoning behind changes
- Spend 15-30 minutes per investigation
- No specialized financial domain knowledge
- Separate tools for code analysis and development chat

### CodeArch Approach

- Select code → right-click → instant analysis
- Evolution-based tracking finds exact relevant commits
- AI confidently explains purpose based on rich context
- Complete timeline with GitHub integration
- Get definitive answers in seconds
- **Dual-mode intelligence**: General development + financial expertise
- **Integrated chat interface**: Discuss code with context-aware AI
- **Automatic context addition**: Seamlessly add analysis, code, and git data to conversations

## Advanced Features

### Evolution-Based Tracking

Unlike tools that rely on text matching, CodeArch uses git's internal line tracking to:

- Handle file renames and moves seamlessly
- Track lines through refactoring and reformatting
- Find relevant changes even when code has been heavily modified

### Smart Context Analysis

The AI analyzes:

- **Selected code** and surrounding lines for context
- **Commit messages** explaining the intent behind changes
- **PR descriptions** detailing problems and solutions
- **Code comments** providing developer insights
- **Related issues** linked to PRs for full background

### Financial Domain Intelligence

CodeArch recognizes and provides specialized analysis for:

- **Trading Libraries**: Zipline, Backtrader, QuantLib, pandas-ta
- **Market Data Patterns**: OHLCV structures, time series analysis, technical indicators
- **Risk Management**: VaR calculations, portfolio optimization, correlation analysis
- **Financial Compliance**: Regulatory requirements, audit trails, risk reporting

### Intelligent Chat System

- **Multi-Context Support**: Add files, code selections, git diffs, and analysis results
- **Mode-Aware Responses**: Automatically adapts based on finance vs. general development context
- **GitHub Copilot-Style Interface**: Clean, minimal design with capability discovery
- **Context Management**: Easy addition and removal of conversation context

### Intelligent Diff Filtering

Instead of showing entire commit diffs, CodeArch:

- Extracts only hunks that intersected with your selected lines
- Uses mathematical line range analysis for precision
- Handles complex git history with multiple file paths
- Provides focused, relevant change information

## Configuration

### Setting Up AI Provider

1. **Configure API Key**: Run `CodeArch: Configure API Key` from Command Palette
2. **Choose Provider**: Select your preferred AI provider:
   - **Gemini** (Google AI Studio) - Free tier available, excellent for code analysis
   - **OpenAI** - GPT-4 and other OpenAI models (requires paid API)
   - **Claude** - Anthropic Claude models (requires paid API)
   - **Hugging Face** - Open source models (free with rate limits)

### Changing Providers/Models (Without Re-entering API Key)

**Easy Method**: Use VS Code Settings

1. Open `File > Preferences > Settings` (or `Ctrl+,`)
2. Search for "CodeArch"
3. Change the `CodeArch: AI Provider` dropdown
4. Optionally change the model for your selected provider
5. Your API keys remain saved - no need to re-enter!

### Configuration

**Settings (Ctrl+Comma > Extensions > CodeArch)**:

- **`CodeArch.aiProvider`**: Choose between `gemini`, `openai`, `claude`, `huggingface`

**Model Selection (Ctrl+Shift+P > "CodeArch: Select Model")**:

- Models are dynamically shown based on your selected AI provider
- Easy switching between available models without cluttering settings
- Smart defaults: GPT-4o-mini (OpenAI), Gemini 2.0 Flash (Google), Claude Sonnet 4 (Anthropic)

### Available Models by Provider

**Gemini Models**:

- **Gemini 2.0 Flash** (default) - Fast and efficient - best for speed
- **Gemini 2.5 Flash** - Advanced flash model
- **Gemini 2.5 Pro** - Most capable Gemini model

**OpenAI Models**:

- **GPT-4o Mini** (default) - Fast, cost-effective, perfect for code analysis
- **GPT-4o** - More capable but slower than mini
- **GPT-5 Mini** - Latest tech but slower
- **GPT-5** - Maximum capabilities but slowest

**Claude Models**:

- **Claude Sonnet 4** (default) - Best balance of performance and cost
- **Claude Sonnet 4.5** - Latest and most capable Sonnet model
- **Claude Sonnet 3.7** - Previous generation Sonnet model

**Hugging Face**:

- **Custom Model ID** - Enter any Hugging Face model (e.g., `microsoft/DialoGPT-large`)

> **Note**: GPT-5 models use different API parameters and are slower than GPT-4 models. The extension automatically handles these differences.

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
- Verify key starts with "AIza" (Google AI Studio key)
- Check API quota and billing status

**"No evolution data found"**

- File might be newly created
- Ensure local repository is up-to-date with `git pull`
- Selected code might not have substantial git history

**"Chat context not working"**

- Ensure you're in the correct mode (Code/Finance) for your content
- Try manually adding context using the + button in the chat interface
- Check that analysis results are available before adding them to chat

**"Finance mode not recognizing financial code"**

- Ensure your code uses recognizable financial libraries (pandas, numpy, zipline, etc.)
- Try manually switching to Finance mode using the toggle buttons
- Financial detection works best with trading algorithms and market data processing code

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
git clone <repository>
cd CodeArch
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
- **Google Gemini AI** - Powering intelligent code and financial analysis
- **GitHub CLI** - Seamless GitHub integration
- **Git** - The foundation that makes code archaeology possible
- **Financial Development Community** - For inspiring the dual-mode capabilities
