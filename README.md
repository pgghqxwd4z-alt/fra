# QuantSage

QuantSage is a React and Express trading analysis terminal.

## Prerequisites

- Node.js 20.18.1
- npm 10.8.2
- An OpenAI API key, or a Groq API key when using Groq

## Setup

```sh
cp .env.example .env
```

Set `AI_PROVIDER` to `openai` (the default) or `groq`, then provide the
corresponding API key in `.env`.

For OpenAI, `OPENAI_MODEL` is optional. For Groq, `GROQ_MODEL` and
`GROQ_VISION_MODEL` are optional and default to `groq/compound` and
`qwen/qwen3.6-27b`.

```sh
npm install
npm run dev
```

The development server runs on port 3000. To build and run the production server:

```sh
npm run build
npm start
```
