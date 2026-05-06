# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Environment

QuantSage uses Groq for AI chat and chart analysis. Create a local `.env.local`
file before running the app:

```bash
cp .env.example .env.local
```

Then replace `your_groq_api_key_here` with a Groq API key:

```env
VITE_GROQ_API_KEY=your_groq_api_key
```

Never commit `.env.local` or real API keys.

For public deployments, do not set `VITE_GROQ_API_KEY` in the frontend build
because Vite embeds `VITE_` variables into browser JavaScript. Deploy the
FastAPI proxy in `proxy/` with server-side `GROQ_API_KEY`, and optionally
`OPENAI_API_KEY` for GPT-4o vision fallback when Groq vision is rate-limited or
temporarily unavailable. Then build the frontend with:

```env
VITE_GROQ_PROXY_URL=https://your-proxy.example.com
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default tseslint.config({
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

- Replace `tseslint.configs.recommended` to `tseslint.configs.recommendedTypeChecked` or `tseslint.configs.strictTypeChecked`
- Optionally add `...tseslint.configs.stylisticTypeChecked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and update the config:

```js
// eslint.config.js
import react from 'eslint-plugin-react'

export default tseslint.config({
  // Set the react version
  settings: { react: { version: '18.3' } },
  plugins: {
    // Add the react plugin
    react,
  },
  rules: {
    // other rules...
    // Enable its recommended rules
    ...react.configs.recommended.rules,
    ...react.configs['jsx-runtime'].rules,
  },
})
```
