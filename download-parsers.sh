#!/bin/bash
set -e

mkdir -p parsers
cd parsers

LANGS=(
    "javascript"
    "typescript"
    "tsx"
    "python"
    "go"
    "java"
    "cpp"
    "c"
    "rust"
    "ruby"
    "php"
    "c_sharp"
    "bash"
    "swift"
    "kotlin"
)

BASE_URL="https://unpkg.com/tree-sitter-wasms@0.1.11/out"

for lang in "${LANGS[@]}"; do
    echo "Downloading ${lang} parser..."
    curl -L -O "${BASE_URL}/tree-sitter-${lang}.wasm"
done

echo "All parsers downloaded successfully."
