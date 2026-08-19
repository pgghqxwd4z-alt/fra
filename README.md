# QuantSage

QuantSage is a React and Express trading analysis terminal.

## Prerequisites

- Node.js 20.18.1
- npm 10.8.2
- An OpenAI API key

## Setup

```sh
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. `OPENAI_MODEL` is optional.

```sh
npm install
npm run dev
```

The development server runs on port 3000. To build and run the production server:

```sh
npm run build
npm start
```
