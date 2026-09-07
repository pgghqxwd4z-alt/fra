import React, { FormEvent, useEffect, useState } from 'react';

const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD?.trim() || '';
const ACCESS_STORAGE_KEY = 'quantsage_access_granted';

function hashPassword(password: string): string {
  let hash = 5381;

  for (let index = 0; index < password.length; index += 1) {
    hash = ((hash << 5) - hash) ^ password.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}

const PasswordGate: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(!APP_PASSWORD);

  useEffect(() => {
    if (APP_PASSWORD && localStorage.getItem(ACCESS_STORAGE_KEY) === hashPassword(APP_PASSWORD)) {
      setIsUnlocked(true);
    }
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.trim() === APP_PASSWORD) {
      localStorage.setItem(ACCESS_STORAGE_KEY, hashPassword(APP_PASSWORD));
      setError('');
      setIsUnlocked(true);
      return;
    }

    setError('Invalid access password');
  };

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050507] px-6 text-gray-200">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-8 shadow-2xl shadow-emerald-950/20 backdrop-blur-xl"
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <i className="fa-solid fa-lock"></i>
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-500">
              QuantSage
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.25em] text-white/40">
              Restricted Terminal
            </p>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-white">Access Required</h1>
        <p className="mt-2 text-sm leading-6 text-white/50">
          Enter the shared password to access the institutional intelligence terminal.
        </p>

        <label
          htmlFor="app-password"
          className="mt-8 block font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-500/70"
        >
          Shared Password
        </label>
        <input
          id="app-password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
          autoFocus
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm text-white outline-none transition-colors placeholder:text-white/20 focus:border-emerald-500/60"
          placeholder="••••••••"
        />

        {error && (
          <p className="mt-3 font-mono text-xs text-rose-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="mt-6 w-full rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-950 transition-colors hover:bg-emerald-400"
        >
          Enter Terminal
        </button>
      </form>
    </main>
  );
};

export default PasswordGate;
