import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createOrchestratorGame,
  deleteOrchestratorGame,
  getCompatReport,
  getOrchestratorHealth,
  listGameBackups,
  listRemoteVersions,
  registerOrchestratorVersion,
  runGameLifecycle,
  unregisterOrchestratorVersion,
} from '../auth/client';
import type {
  CompatRow,
  GameBackupManifest,
  OrchestratorGame,
  OrchestratorHealth,
  OrchestratorVersion,
  RemoteRef,
} from '../auth/client';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: number | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function healthTone(game: OrchestratorGame): string {
  if (game.runtime?.health === 'failed') return 'dev-health-bad';
  if (game.status !== 'active') return 'dev-health-muted';
  if (game.runtime?.online) return 'dev-health-good';
  return 'dev-health-warn';
}

export default function DevVersionPanel() {
  const [health, setHealth] = useState<OrchestratorHealth | null>(null);
  const [remoteRefs, setRemoteRefs] = useState<RemoteRef[]>([]);
  const [selectedRef, setSelectedRef] = useState('');
  const [versionId, setVersionId] = useState('');
  const [newGameName, setNewGameName] = useState('');
  const [newGameVersion, setNewGameVersion] = useState('dev');
  const [updateTarget, setUpdateTarget] = useState<Record<string, string>>({});
  const [compat, setCompat] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<Record<string, GameBackupManifest[]>>({});
  const [rollbackTarget, setRollbackTarget] = useState<Record<string, string>>({});
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const versions = health?.versions ?? [];
  const games = health?.games ?? [];
  const busy = !!busyLabel;
  const versionOptions = useMemo(
    () => Array.from(new Set(['dev', ...versions.map((version) => version.id)])),
    [versions],
  );

  const reload = useCallback(async (showError = true) => {
    try {
      const next = await getOrchestratorHealth();
      setHealth(next);
      if (showError) setError('');
    } catch (loadError) {
      if (showError) setError(errorMessage(loadError, 'Could not reach the orchestrator.'));
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(false), 5_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const run = async (label: string, action: () => Promise<void>) => {
    try {
      setBusyLabel(label);
      setError('');
      setNotice('');
      await action();
      setNotice(label);
      await reload(false);
    } catch (actionError) {
      setError(errorMessage(actionError, `${label} failed`));
    } finally {
      setBusyLabel('');
    }
  };

  const loadRemote = () => run('Remote refs refreshed', async () => {
    const refs = await listRemoteVersions();
    setRemoteRefs(refs);
    if (!selectedRef && refs[0]) setSelectedRef(refs[0].ref);
  });

  const loadBackups = async (gameId: string) => {
    try {
      const rows = await listGameBackups(gameId);
      setBackups((current) => ({ ...current, [gameId]: rows }));
      if (rows[0]) setRollbackTarget((current) => ({ ...current, [gameId]: current[gameId] || rows[0].id }));
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not load backups.'));
    }
  };

  const checkCompat = async (toVersion: string) => {
    try {
      const rows: CompatRow[] = await getCompatReport(toVersion);
      setCompat((current) => ({ ...current, ...Object.fromEntries(rows.map((row) => [row.id, row.canUpdate])) }));
    } catch (compatError) {
      setError(errorMessage(compatError, 'Compatibility check failed.'));
    }
  };

  const destructive = (message: string, action: () => Promise<void>) => {
    if (window.confirm(message)) void action();
  };

  return (
    <section className="dev-panel dev-operations-panel">
      <div className="dev-panel-heading">
        <div>
          <h2>Operations Control</h2>
          <p>Version artifacts, gateway health, saves, backups, and lifecycle. No Pi access required.</p>
        </div>
        <div className="dev-header-actions">
          <span className={`dev-status-pill ${health?.ok ? 'dev-online' : 'dev-offline'}`}>
            {health?.ok ? 'Orchestrator healthy' : 'Orchestrator unavailable'}
          </span>
          <button className="dev-secondary-button" type="button" disabled={busy} onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </div>

      {busy && <div className="dev-operation-progress">Working: {busyLabel}</div>}
      {error && <div className="dev-error">{error}</div>}
      {notice && <div className="dev-notice">{notice}</div>}

      {health && (
        <div className="dev-ops-summary">
          <div><span>Gateway clients</span><strong>{health.gateway.activeConnections}</strong></div>
          <div><span>Starting</span><strong>{health.gateway.connectingConnections}</strong></div>
          <div><span>Upstream retries</span><strong>{health.gateway.upstreamRetries}</strong></div>
          <div><span>Queued bytes</span><strong>{formatBytes(health.gateway.queuedBytes)}</strong></div>
          <div><span>Rejected</span><strong>{health.gateway.rejectedConnections}</strong></div>
        </div>
      )}

      <div className="dev-ops-grid">
        <section className="dev-ops-card">
          <h3>Register immutable backend</h3>
          <p>Fetches the commit, reads its static manifest, and installs its pinned dependency artifact.</p>
          <div className="dev-control-row">
            <button type="button" className="dev-secondary-button" disabled={busy} onClick={loadRemote}>Fetch refs</button>
            <select value={selectedRef} onChange={(event) => setSelectedRef(event.target.value)}>
              <option value="">{remoteRefs.length ? 'Select ref…' : 'Fetch refs first'}</option>
              {remoteRefs.map((ref) => (
                <option key={`${ref.type}:${ref.ref}`} value={ref.ref}>{ref.type}: {ref.ref}</option>
              ))}
            </select>
            <input
              placeholder="optional version id"
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
            />
            <button
              type="button"
              className="dev-primary-button"
              disabled={busy || !selectedRef}
              onClick={() => void run(`Registering ${selectedRef}`, async () => {
                await registerOrchestratorVersion(selectedRef, versionId || undefined);
                setVersionId('');
              })}
            >
              Register
            </button>
          </div>
        </section>

        <section className="dev-ops-card">
          <h3>Create game</h3>
          <p>The selected backend starts automatically and remains supervised after creation.</p>
          <div className="dev-control-row">
            <input
              placeholder="Game name"
              value={newGameName}
              onChange={(event) => setNewGameName(event.target.value)}
            />
            <select value={newGameVersion} onChange={(event) => setNewGameVersion(event.target.value)}>
              {versionOptions.map((version) => <option key={version} value={version}>{version}</option>)}
            </select>
            <button
              type="button"
              className="dev-primary-button"
              disabled={busy || !newGameName.trim()}
              onClick={() => void run(`Creating ${newGameName}`, async () => {
                await createOrchestratorGame(newGameName, newGameVersion);
                setNewGameName('');
              })}
            >
              Create
            </button>
          </div>
        </section>
      </div>

      <section className="dev-ops-section">
        <h3>Backend versions</h3>
        <div className="dev-version-grid">
          {versions.map((version: OrchestratorVersion) => (
            <article className="dev-version-card" key={version.id}>
              <div className="dev-version-title">
                <strong>{version.id}</strong>
                <span className={version.process?.running ? 'dev-health-good' : 'dev-health-muted'}>
                  {version.process?.running ? `running · pid ${version.process.pid}` : 'idle'}
                </span>
              </div>
              <code title={version.commit}>{version.gitRef} @ {version.commit?.slice(0, 10) || 'working tree'}</code>
              <dl>
                <div><dt>Protocol</dt><dd>v{version.protocolVersion}</dd></div>
                <div><dt>Schema</dt><dd>{version.schemaVersion}</dd></div>
                <div><dt>Runtime API</dt><dd>{version.runtimeApiVersion ?? 0}</dd></div>
                <div><dt>Artifact</dt><dd>{version.artifactReady ? 'ready' : 'missing'}</dd></div>
                <div><dt>Crashes</dt><dd>{version.process?.crashes ?? 0}</dd></div>
                <div><dt>Started</dt><dd>{formatDate(version.process?.startedAt)}</dd></div>
              </dl>
              {(version.runtimeApiVersion ?? 0) < 1 && (
                <div className="dev-inline-warning">Legacy runtime contract; protected by the control-plane catalog guard.</div>
              )}
              {version.process?.lastError && <div className="dev-inline-error">{version.process.lastError}</div>}
              {version.id !== 'dev' && (
                <button
                  type="button"
                  className="dev-secondary-button dev-delete-button"
                  disabled={busy}
                  onClick={() => destructive(
                    `Unregister ${version.id}? This is allowed only when no game uses it.`,
                    () => run(`Unregistering ${version.id}`, () => unregisterOrchestratorVersion(version.id)),
                  )}
                >
                  Unregister
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="dev-ops-section">
        <h3>Games and saves</h3>
        <div className="dev-table-wrap">
          <table className="dev-table dev-ops-games">
            <thead>
              <tr>
                <th>Game</th>
                <th>Runtime</th>
                <th>Save</th>
                <th>Owner</th>
                <th>Backups</th>
                <th>Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => {
                const gameBackups = backups[game.id] ?? [];
                const selectedBackup = rollbackTarget[game.id] ?? '';
                const failed = game.runtime?.health === 'failed';
                return (
                  <tr key={game.id}>
                    <td>
                      <strong>{game.name}</strong>
                      <small>{game.id}</small>
                    </td>
                    <td>
                      <span className={`dev-health-label ${healthTone(game)}`}>
                        {game.runtime?.health ?? game.status}
                      </span>
                      <small>{game.versionId} · protocol {game.protocolVersion ?? '—'}</small>
                      {game.runtime?.error && <span className="dev-cell-error">{game.runtime.error}</span>}
                      {typeof game.runtime?.lastTickDurationMs === 'number' && (
                        <small>tick {game.runtime.lastTickDurationMs.toFixed(1)} ms · max {(game.runtime.maxTickDurationMs ?? 0).toFixed(1)} ms</small>
                      )}
                    </td>
                    <td>
                      <span>schema {game.schemaVersion ?? 'new'}</span>
                      <small>last save {formatDate(game.runtime?.lastSaveAt)}</small>
                    </td>
                    <td>{game.owner ? <><span>pid {game.owner.pid}</span><small>{game.owner.versionId}</small></> : 'released'}</td>
                    <td>
                      <span>{game.backupCount ?? 0} retained</span>
                      <small>{game.latestBackup ? `${game.latestBackup.reason} · ${formatDate(game.latestBackup.createdAt)}` : 'none'}</small>
                      <div className="dev-cell-actions">
                        <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => void loadBackups(game.id)}>
                          List
                        </button>
                        <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => void run('Creating verified backup', () => runGameLifecycle(game.id, 'backup'))}>
                          Backup
                        </button>
                      </div>
                      {gameBackups.length > 0 && (
                        <select value={selectedBackup} onChange={(event) => setRollbackTarget((current) => ({ ...current, [game.id]: event.target.value }))}>
                          {gameBackups.map((backup) => (
                            <option key={backup.id} value={backup.id}>
                              {formatDate(backup.createdAt)} · {backup.reason} · {backup.sourceVersionId}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <div className="dev-cell-actions">
                        {game.status === 'active' && !failed ? (
                          <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => void run('Stopping game safely', () => runGameLifecycle(game.id, 'stop'))}>Stop</button>
                        ) : (
                          <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => void run(failed ? 'Retrying quarantined game' : 'Starting game', () => runGameLifecycle(game.id, failed ? 'retry' : 'start'))}>
                            {failed ? 'Retry' : 'Start'}
                          </button>
                        )}
                        <button type="button" className="dev-secondary-button" disabled={busy} onClick={() => void run('Archiving game', () => runGameLifecycle(game.id, 'archive'))}>Archive</button>
                        <button
                          type="button"
                          className="dev-secondary-button"
                          disabled={busy || !selectedBackup}
                          onClick={() => destructive(
                            `Restore the selected verified backup for ${game.name}? A backup of the current state will be created first.`,
                            () => run('Rolling back game', () => runGameLifecycle(game.id, 'rollback', { backupId: selectedBackup })),
                          )}
                        >
                          Rollback
                        </button>
                        <button
                          type="button"
                          className="dev-secondary-button dev-delete-button"
                          disabled={busy}
                          onClick={() => destructive(
                            `Reset ${game.name} to a fresh galaxy? The current save will be backed up.`,
                            () => run('Resetting game', () => runGameLifecycle(game.id, 'reset')),
                          )}
                        >
                          Reset
                        </button>
                      </div>
                      <div className="dev-update-row">
                        <select
                          value={updateTarget[game.id] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setUpdateTarget((current) => ({ ...current, [game.id]: value }));
                            if (value) void checkCompat(value);
                          }}
                        >
                          <option value="">Update to…</option>
                          {versionOptions.filter((version) => version !== game.versionId).map((version) => (
                            <option key={version} value={version}>{version}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="dev-primary-button"
                          disabled={busy || !updateTarget[game.id] || compat[game.id] === false}
                          onClick={() => void run('Updating game backend', () => runGameLifecycle(game.id, 'update', { toVersion: updateTarget[game.id] }))}
                        >
                          Update
                        </button>
                      </div>
                      {updateTarget[game.id] && compat[game.id] === false && <small className="dev-cell-error">Schema incompatible</small>}
                      <button
                        type="button"
                        className="dev-text-danger"
                        disabled={busy}
                        onClick={() => destructive(
                          `Delete ${game.name}? A final backup is retained, but memberships and catalog records will be removed.`,
                          () => run('Deleting game', () => deleteOrchestratorGame(game.id)),
                        )}
                      >
                        Delete game
                      </button>
                    </td>
                  </tr>
                );
              })}
              {games.length === 0 && <tr><td colSpan={6}>No games created.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
