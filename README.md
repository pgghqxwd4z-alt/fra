# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Environment

QuantSage uses OpenAI as the primary provider through the FastAPI proxy. Create
a local `.env.local` file before running the app:

```bash
cp .env.example .env.local
```

```env
VITE_GROQ_PROXY_URL=https://your-proxy.example.com
VITE_PROXY_ACCESS_KEY=your_proxy_access_key
```

Never commit `.env.local` or real API keys.

For public deployments, deploy the FastAPI proxy in `proxy/` to Render using
the Dockerfile there. Set `AI_PRIMARY_PROVIDER=openai` and configure
`OPENAI_API_KEY`, `PROXY_ACCESS_KEY`, and `ALLOWED_ORIGINS` in the Render
dashboard or API. Build the frontend with these Vite variables:

```env
VITE_GROQ_PROXY_URL=https://your-proxy.example.com
VITE_PROXY_ACCESS_KEY=your_proxy_access_key
```

`VITE_GROQ_PROXY_URL` and `VITE_PROXY_ACCESS_KEY` are build-time frontend
variables.

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
