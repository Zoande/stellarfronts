import { useCallback, useEffect, useState } from 'react';
import {
  createOrchestratorGame,
  getCompatReport,
  listOrchestratorGames,
  listOrchestratorVersions,
  listRemoteVersions,
  registerOrchestratorVersion,
  runGameLifecycle,
  unregisterOrchestratorVersion,
} from '../auth/client';
import type { CompatRow, OrchestratorGame, OrchestratorVersion, RemoteRef } from '../auth/client';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Full version + game-lifecycle control, driven entirely through the auth server's
 * admin-gated proxy to the orchestrator. Lets you register code versions (any git
 * ref from GitHub), create games on a chosen version, and reset/update/stop/start/
 * archive/rollback — no SSH into the Pi needed.
 */
export default function DevVersionPanel() {
  const [versions, setVersions] = useState<OrchestratorVersion[]>([]);
  const [games, setGames] = useState<OrchestratorGame[]>([]);
  const [remoteRefs, setRemoteRefs] = useState<RemoteRef[]>([]);
  const [selectedRef, setSelectedRef] = useState('');
  const [versionId, setVersionId] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newGameVersion, setNewGameVersion] = useState('dev');
  const [updateTarget, setUpdateTarget] = useState<Record<string, string>>({});
  const [compat, setCompat] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // The orchestrator now leads its version list with the built-in "dev" working
  // tree, so derive options from it (deduped, with dev as a safe fallback).
  const versionOptions = Array.from(new Set(['dev', ...versions.map((version) => version.id)]));

  const reload = useCallback(async () => {
    try {
      const [nextVersions, nextGames] = await Promise.all([listOrchestratorVersions(), listOrchestratorGames()]);
      setVersions(nextVersions);
      setGames(nextGames);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not reach the orchestrator. Is it running?'));
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 8000);
    return () => window.clearInterval(id);
  }, [reload]);

  const run = async (label: string, action: () => Promise<void>) => {
    try {
      setBusy(true);
      setError('');
      setNotice('');
      await action();
      setNotice(label);
      await reload();
    } catch (actionError) {
      setError(errorMessage(actionError, `${label} failed`));
    } finally {
      setBusy(false);
    }
  };

  const loadRemote = () => run('Fetched remote refs', async () => {
    const refs = await listRemoteVersions();
    setRemoteRefs(refs);
    if (refs[0]) setSelectedRef(refs[0].ref);
  });

  const register = () => run(`Registered ${selectedRef}`, () => registerOrchestratorVersion(selectedRef, versionId || undefined));

  const unregister = (id: string) => run(`Unregistered ${id}`, () => unregisterOrchestratorVersion(id));

  const shortCommit = (commit: string) => (commit ? commit.slice(0, 7) : '—');

  const createGame = () => run(`Created ${newGameName}`, async () => {
    await createOrchestratorGame(newGameName, newGameVersion);
    setNewGameName('');
  });

  const checkCompat = (toVersion: string) => run(`Checked compatibility with ${toVersion}`, async () => {
    const rows: CompatRow[] = await getCompatReport(toVersion);
    setCompat(Object.fromEntries(rows.map((row) => [row.id, row.canUpdate])));
  });

  return (
    <section className="dev-section" style={{ marginTop: 24 }}>
      <h2>Versions & Lifecycle</h2>
      {error && <p style={{ color: '#ff8a7a' }}>{error}</p>}
      {notice && <p style={{ color: '#7ce0a0' }}>{notice}</p>}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        <div className="dev-card">
          <h3>Register a version (from GitHub)</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="dev-secondary-button" disabled={busy} onClick={loadRemote}>Fetch refs</button>
            <select value={selectedRef} onChange={(event) => setSelectedRef(event.target.value)}>
              <option value="">{remoteRefs.length ? 'Select a ref…' : '(fetch refs first)'}</option>
              {remoteRefs.map((ref) => (
                <option key={`${ref.type}:${ref.ref}`} value={ref.ref}>{ref.type}: {ref.ref}</option>
              ))}
            </select>
            <input placeholder="version id (optional)" value={versionId} onChange={(event) => setVersionId(event.target.value)} />
            <button type="button" className="dev-primary-button" disabled={busy || !selectedRef} onClick={register}>Register</button>
          </div>
          <ul style={{ marginTop: 12 }}>
            {versions.map((version) => (
              <li key={version.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  <strong>{version.id}</strong>
                  {version.id === 'dev' && <span style={{ opacity: 0.6 }}> (working tree)</span>}
                  {' — '}
                  {version.refType} <code>{version.gitRef}</code> @ <code title={version.commit}>{shortCommit(version.commit)}</code>
                  {' · '}protocol v{version.protocolVersion} · schema {version.schemaVersion} · port {version.port}
                </span>
                {version.id !== 'dev' && (
                  <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => unregister(version.id)}>
                    Unregister
                  </button>
                )}
              </li>
            ))}
            {versions.length === 0 && <li>Orchestrator unreachable — no versions to show.</li>}
          </ul>
        </div>

        <div className="dev-card">
          <h3>Create a game</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Game name" value={newGameName} onChange={(event) => setNewGameName(event.target.value)} />
            <select value={newGameVersion} onChange={(event) => setNewGameVersion(event.target.value)}>
              {versionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <button type="button" className="dev-primary-button" disabled={busy || !newGameName.trim()} onClick={createGame}>Create on {newGameVersion}</button>
          </div>
        </div>
      </div>

      <div className="dev-card" style={{ marginTop: 16 }}>
        <h3>Games</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th>Name</th><th>Version</th><th>Status</th><th>Schema</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <td>{game.name}</td>
                <td>{game.versionId}</td>
                <td>{game.status}</td>
                <td>{game.schemaVersion ?? '—'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 0' }}>
                  <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => run('Reset', () => runGameLifecycle(game.id, 'reset'))}>Reset</button>
                  {game.status === 'active'
                    ? <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => run('Stopped', () => runGameLifecycle(game.id, 'stop'))}>Stop</button>
                    : <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => run('Started', () => runGameLifecycle(game.id, 'start'))}>Start</button>}
                  <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => run('Archived', () => runGameLifecycle(game.id, 'archive'))}>Archive</button>
                  <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => run('Rolled back', () => runGameLifecycle(game.id, 'rollback'))}>Rollback</button>
                  <select
                    value={updateTarget[game.id] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setUpdateTarget((prev) => ({ ...prev, [game.id]: value }));
                      if (value) void checkCompat(value);
                    }}
                  >
                    <option value="">update to…</option>
                    {versionOptions.filter((option) => option !== game.versionId).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="dev-primary-button"
                    disabled={busy || !updateTarget[game.id]}
                    title={updateTarget[game.id] && compat[game.id] === false ? 'Incompatible: this version cannot migrate this game' : undefined}
                    onClick={() => run('Updated', () => runGameLifecycle(game.id, 'update', { toVersion: updateTarget[game.id] }))}
                  >
                    Update{updateTarget[game.id] && compat[game.id] === false ? ' ⚠' : ''}
                  </button>
                </td>
              </tr>
            ))}
            {games.length === 0 && <tr><td colSpan={5}>No games yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
