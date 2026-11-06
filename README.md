# Mosuan (墨算)

Mosuan is a local-first Markdown reader for long mathematical conversations and study notes. Import an AI conversation, read LaTeX formulas, and jump back to a derivation without scrolling through the entire chat.

## Features

- Import Markdown and TXT files, with encoding selection for older text files.
- Render formulas with KaTeX or MathJax and search notes by keyword or LaTeX source.
- Back up and restore your notes, or export them to Markdown, PDF, and Word.
- Switch between Simplified Chinese, Traditional Chinese, and English under **Settings → Language**.
- Read, search, and back up notes offline. Connect your own DeepSeek account or API key for follow-up questions.

## Download and run

Find the following files in the repository’s **Releases** section.

### Windows

1. Download and extract `mosuan-0.6.1-project.zip`.
2. Install Node.js 22.12 or newer. Node.js 24 is recommended.
3. Open the extracted folder and double-click `start-packaged.cmd`.
4. Open `http://127.0.0.1:3001` in your browser. Keep the command window open while using Mosuan.

### Android

Download `mosuan-0.6.1-android.apk` on your phone and install it. Mosuan supports Android 7.0 and newer.

## Build from source

Run these commands from the project root.

```bash
npm ci
npm run build
npm start
```
