import React, { useCallback, useEffect, useState } from 'react';
import { aiService } from '../services/aiService';
import { ForecastRecord, ForecastStats } from '../types';

interface TrackRecordPayload {
  forecasts: ForecastRecord[];
  stats: ForecastStats;
}

const formatPercent = (value: number | null): string =>
  value === null ? '—' : `${(value * 100).toFixed(1)}%`;

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

const formatConsensus = (value: string | null): string => {
  if (!value) return '—';
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && 'verdict' in parsed && typeof parsed.verdict === 'string') {
      return parsed.verdict;
    }
  } catch {
    // Keep legacy values as-is.
  }
  return value;
};

const statusClass: Record<string, string> = {
  pending: 'text-amber-300',
  tp1: 'text-emerald-300',
  tp2: 'text-emerald-300',
  final: 'text-emerald-200',
  invalidated: 'text-rose-300',
  ambiguous: 'text-orange-300',
  expired: 'text-slate-300',
  unscorable: 'text-slate-400'
};

const TrackRecord: React.FC = () => {
  const [payload, setPayload] = useState<TrackRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPayload(await aiService.getTrackRecord());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load track record.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await aiService.rescoreForecasts();
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh track record.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading track record…</div>;
  }

  if (error && !payload) {
    return (
      <div className="m-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  if (!payload || payload.forecasts.length === 0) {
    return (
      <div className="m-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400">
        no forecasts logged yet — run an analysis on a recognised instrument
      </div>
    );
  }

  const { stats, forecasts } = payload;
  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/70">Measured outcomes</p>
          <h1 className="mt-1 text-xl font-semibold text-white">Track Record</h1>
          <p className="mt-1 text-sm text-slate-400">
            Hit rate {formatPercent(stats.hitRate)} · {stats.sample} resolved forecast{stats.sample === 1 ? '' : 's'}
          </p>
          {stats.sample < 20 && (
            <p className="mt-2 text-xs text-amber-300">The sample is too small to be meaningful.</p>
          )}
          {!stats.storage.durable && (
            <p className="mt-2 text-xs text-amber-300">Warning: forecast storage is ephemeral and will be lost on redeploy.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20 disabled:cursor-wait disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh scores'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-white">Calibration</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-2">Stated confidence</th>
                  <th className="px-2 py-2">Forecasts</th>
                  <th className="px-2 py-2">Realized hit rate</th>
                  <th className="px-2 py-2">Mean confidence</th>
                </tr>
              </thead>
              <tbody>
                {stats.calibration.length ? (
                  stats.calibration.map((bucket) => (
                    <tr key={bucket.bucket} className="border-t border-white/5 text-slate-300">
                      <td className="px-2 py-2">{bucket.bucket}</td>
                      <td className="px-2 py-2">{bucket.forecasts}</td>
                      <td className="px-2 py-2">{formatPercent(bucket.hitRate)}</td>
                      <td className="px-2 py-2">{bucket.meanConfidence.toFixed(1)}%</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-slate-500">no resolved forecasts yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">Totals</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              ['Logged', stats.totals.logged],
              ['Pending', stats.totals.pending],
              ['Wins', stats.totals.wins],
              ['Losses', stats.totals.losses],
              ['Ambiguous', stats.totals.ambiguous],
              ['Expired', stats.totals.expired]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-black/20 p-2">
                <div className="text-slate-500">{label}</div>
                <div className="mt-1 text-sm text-slate-200">{value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">By instrument</h2>
          <div className="space-y-2 text-xs">
            {stats.byInstrument.length ? stats.byInstrument.map((item) => (
              <div key={item.instrument} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                <span className="text-slate-300">{item.instrument}</span>
                <span className="text-slate-400">{item.wins}W / {item.losses}L · {formatPercent(item.hitRate)}</span>
              </div>
            )) : (
              <p className="py-2 text-slate-500">nothing resolved yet</p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">By bias</h2>
          <div className="space-y-2 text-xs">
            {stats.byBias.length ? stats.byBias.map((item) => (
              <div key={item.bias} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                <span className="text-slate-300">{item.bias}</span>
                <span className="text-slate-400">{item.wins}W / {item.losses}L · {formatPercent(item.hitRate)}</span>
              </div>
            )) : (
              <p className="py-2 text-slate-500">nothing resolved yet</p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">By model</h2>
          <div className="space-y-2 text-xs">
            {stats.byEngine.length ? stats.byEngine.map((item) => (
              <div key={item.engine} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                <span className="text-slate-300">{item.engine}</span>
                <span className="text-slate-400">{item.wins}W / {item.losses}L · {formatPercent(item.hitRate)}</span>
              </div>
            )) : (
              <p className="py-2 text-slate-500">nothing resolved yet</p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">By consensus</h2>
          <div className="space-y-2 text-xs">
            {stats.byConsensus.length ? stats.byConsensus.map((item) => (
              <div key={item.verdict} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                <span className="text-slate-300">{item.verdict}</span>
                <span className="text-slate-400">{item.wins}W / {item.losses}L · {formatPercent(item.hitRate)}</span>
              </div>
            )) : (
              <p className="py-2 text-slate-500">nothing resolved yet</p>
            )}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="mb-3 text-sm font-semibold text-white">Recent forecasts</h2>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2">Instrument</th>
                <th className="px-2 py-2">Bias</th>
                <th className="px-2 py-2">Confidence</th>
                <th className="px-2 py-2">Engine</th>
                <th className="px-2 py-2">Consensus</th>
                <th className="px-2 py-2">TP1</th>
                <th className="px-2 py-2">Invalidation</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((forecast) => (
                <tr key={forecast.id} className="border-t border-white/5 text-slate-300">
                  <td className="px-2 py-2">{formatDate(forecast.createdAt)}</td>
                  <td className="px-2 py-2">{forecast.instrument}</td>
                  <td className="px-2 py-2">{forecast.bias}</td>
                  <td className="px-2 py-2">{forecast.confidence}%</td>
                  <td className="px-2 py-2">{forecast.engine ?? '—'}</td>
                  <td className="px-2 py-2">{formatConsensus(forecast.consensus)}</td>
                  <td className="px-2 py-2">{forecast.tp1 ?? '—'}</td>
                  <td className="px-2 py-2">{forecast.invalidation ?? '—'}</td>
                  <td className={`px-2 py-2 font-medium ${statusClass[forecast.status] ?? 'text-slate-300'}`}>
                    <div>{forecast.status}</div>
                    {forecast.unscorableReason && (
                      <div className="text-[10px] font-normal text-slate-500">{forecast.unscorableReason}</div>
                    )}
                  </td>
                  <td className="px-2 py-2">{formatDate(forecast.resolvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default TrackRecord;
