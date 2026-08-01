import { useEffect, useMemo, useState } from 'react';
import { getDevStats, loginToDevPanel, logoutFromDevPanel } from '../auth/client';
import type { DevActivitySeriesPoint, DevStatsResponse } from '../auth/types';
import DevVersionPanel from './DevVersionPanel';
import '../styles/Dev.css';

const REFRESH_INTERVAL_MS = 10_000;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatGameYear(value: number | null): string {
  if (value === null) return 'Unknown';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StatTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'good' | 'warn' | 'accent';
}) {
  return (
    <section className={`dev-stat-tile dev-stat-${tone}`}>
      <div className="dev-stat-label">{label}</div>
      <div className="dev-stat-value">{value}</div>
      <div className="dev-stat-detail">{detail}</div>
    </section>
  );
}

function ActivityChart({ points }: { points: DevActivitySeriesPoint[] }) {
  const width = 720;
  const height = 250;
  const padding = { top: 24, right: 26, bottom: 42, left: 38 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...points.map((point) => point.logins + point.signups + point.gameEnters),
    ...points.map((point) => point.uniqueGameAccounts),
  );
  const barSlot = chartWidth / Math.max(1, points.length);
  const barWidth = Math.min(28, barSlot * 0.58);
  const linePoints = points.map((point, index) => {
    const x = padding.left + index * barSlot + barSlot / 2;
    const y = padding.top + chartHeight - (point.uniqueGameAccounts / maxValue) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="dev-chart-wrap">
      <svg className="dev-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Developer activity chart">
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={width - padding.right}
          y2={padding.top + chartHeight}
          className="dev-chart-axis"
        />
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            y1={padding.top + chartHeight - chartHeight * ratio}
            x2={width - padding.right}
            y2={padding.top + chartHeight - chartHeight * ratio}
            className="dev-chart-grid"
          />
        ))}

        {points.map((point, index) => {
          const x = padding.left + index * barSlot + (barSlot - barWidth) / 2;
          let y = padding.top + chartHeight;
          const gameHeight = (point.gameEnters / maxValue) * chartHeight;
          const loginHeight = (point.logins / maxValue) * chartHeight;
          const signupHeight = (point.signups / maxValue) * chartHeight;
          y -= gameHeight;
          const gameY = y;
          y -= loginHeight;
          const loginY = y;
          y -= signupHeight;
          const signupY = y;

          return (
            <g key={point.timestamp}>
              <rect x={x} y={gameY} width={barWidth} height={gameHeight} className="dev-bar-game" rx="3" />
              <rect x={x} y={loginY} width={barWidth} height={loginHeight} className="dev-bar-login" rx="3" />
              <rect x={x} y={signupY} width={barWidth} height={signupHeight} className="dev-bar-signup" rx="3" />
              {(index === 0 || index === points.length - 1 || index % 3 === 1) && (
                <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" className="dev-chart-label">
                  {point.label}
                </text>
              )}
            </g>
          );
        })}

        <polyline points={linePoints} className="dev-chart-line" />
      </svg>
    </div>
  );
}

function AccountMixChart({ stats }: { stats: DevStatsResponse['accounts'] }) {
  const rows = [
    { label: 'Users', value: stats.users, className: 'dev-mix-users' },
    { label: 'Seeded factions', value: stats.seededFactions, className: 'dev-mix-seeded' },
    { label: 'Observers', value: stats.observers, className: 'dev-mix-observers' },
    { label: 'Admins', value: stats.admins, className: 'dev-mix-admins' },
  ];
  const max = Math.max(1, stats.total);

  return (
    <div className="dev-mix">
      {rows.map((row) => (
        <div className="dev-mix-row" key={row.label}>
          <div className="dev-mix-label">
            <span>{row.label}</span>
            <strong>{formatNumber(row.value)}</strong>
          </div>
          <div className="dev-mix-track">
            <div className={`dev-mix-fill ${row.className}`} style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DevPage() {
  const [password, setPassword] = useState('');
  const [stats, setStats] = useState<DevStatsResponse | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadStats = async (showError: boolean) => {
    try {
      const nextStats = await getDevStats();
      setStats(nextStats);
      setIsUnlocked(true);
      setError('');
    } catch (loadError) {
      setStats(null);
      setIsUnlocked(false);
      if (showError) {
        setError(getErrorMessage(loadError, 'Could not load developer stats'));
      }
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    void loadStats(false);
  }, []);

  useEffect(() => {
    if (!isUnlocked) return undefined;
    const id = window.setInterval(() => {
      void loadStats(false);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [isUnlocked]);

  const peakActivity = useMemo(() => {
    if (!stats) return 0;
    return Math.max(0, ...stats.activity.series.map((point) => point.logins + point.signups + point.gameEnters));
  }, [stats]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setError('Enter the developer password');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      await loginToDevPanel(password);
      setPassword('');
      await loadStats(true);
    } catch (submitError) {
      setError(getErrorMessage(submitError, 'Developer login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutFromDevPanel().catch(() => undefined);
    setStats(null);
    setIsUnlocked(false);
    setPassword('');
  };

  if (isChecking) {
    return (
      <main className="dev-page dev-page-centered">
        <section className="dev-login-panel">
          <div className="dev-kicker">Developer Access</div>
          <h1>Checking Session</h1>
          <div className="dev-loading-bar" />
        </section>
      </main>
    );
  }

  if (!isUnlocked || !stats) {
    return (
      <main className="dev-page dev-page-centered">
        <section className="dev-login-panel">
          <div className="dev-kicker">Developer Access</div>
          <h1>StellarFronts Dev</h1>
          <form className="dev-login-form" onSubmit={handleSubmit}>
            <label htmlFor="dev-password">Password</label>
            <input
              id="dev-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="dev-password-input"
            />
            {error && <div className="dev-error">{error}</div>}
            <button type="submit" className="dev-primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Unlocking' : 'Unlock Panel'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dev-page">
      <header className="dev-header">
        <div>
          <div className="dev-kicker">Developer Panel</div>
          <h1>StellarFronts Operations</h1>
          <p>Server-side account, auth, and game-entry telemetry from the Raspberry Pi services.</p>
        </div>
        <div className="dev-header-actions">
          <span className={`dev-status-pill ${stats.game.online ? 'dev-online' : 'dev-offline'}`}>
            {stats.game.online ? 'Game server online' : 'Game server offline'}
          </span>
          <button type="button" className="dev-secondary-button" onClick={() => void loadStats(true)}>
            Refresh
          </button>
          <button type="button" className="dev-secondary-button" onClick={() => void handleLogout()}>
            Lock
          </button>
        </div>
      </header>

      <section className="dev-stat-grid">
        <StatTile label="Accounts" value={formatNumber(stats.accounts.total)} detail={`${stats.accounts.users} player accounts`} tone="accent" />
        <StatTile label="Logins" value={formatNumber(stats.activity.loginsTotal)} detail={`${stats.activity.logins24h} in the last 24h`} tone="good" />
        <StatTile label="Game Enters" value={formatNumber(stats.activity.gameEntersTotal)} detail={`${stats.activity.gameEnters24h} in the last 24h`} tone="neutral" />
        <StatTile label="Games" value={formatNumber(stats.game.gameCount)} detail={`${stats.game.activeConnections} active game connections`} tone={stats.game.online ? 'good' : 'warn'} />
      </section>

      <section className="dev-layout">
        <div className="dev-panel dev-panel-wide">
          <div className="dev-panel-heading">
            <div>
              <h2>Activity</h2>
              <p>Logins, signups, game enters, and unique game accounts over the last 14 days.</p>
            </div>
            <div className="dev-legend">
              <span className="dev-legend-game">Game enters</span>
              <span className="dev-legend-login">Logins</span>
              <span className="dev-legend-signup">Signups</span>
              <span className="dev-legend-line">Unique accounts</span>
            </div>
          </div>
          <ActivityChart points={stats.activity.series} />
          <div className="dev-chart-note">Peak daily activity: {formatNumber(peakActivity)} events</div>
        </div>

        <div className="dev-panel">
          <div className="dev-panel-heading">
            <div>
              <h2>Account Mix</h2>
              <p>Current records in the auth database.</p>
            </div>
          </div>
          <AccountMixChart stats={stats.accounts} />
        </div>
      </section>

      <section className="dev-layout">
        <div className="dev-panel">
          <div className="dev-panel-heading">
            <div>
              <h2>Game Runtime</h2>
              <p>Heartbeat published by the WebSocket server.</p>
            </div>
          </div>
          <dl className="dev-runtime-grid">
            <div><dt>Game year</dt><dd>{formatGameYear(stats.game.gameYear)}</dd></div>
            <div><dt>Speed</dt><dd>{stats.game.paused ? 'Paused' : `${stats.game.speedMultiplier.toFixed(2)}x`}</dd></div>
            <div><dt>Fleets</dt><dd>{formatNumber(stats.game.fleetCount)}</dd></div>
            <div><dt>Ships</dt><dd>{formatNumber(stats.game.shipCount)}</dd></div>
            <div><dt>Starbases</dt><dd>{formatNumber(stats.game.starbaseCount)}</dd></div>
            <div><dt>Habited worlds</dt><dd>{formatNumber(stats.game.habitedPlanetCount)}</dd></div>
            <div><dt>Stars</dt><dd>{formatNumber(stats.game.starCount)}</dd></div>
            <div><dt>Last heartbeat</dt><dd>{formatDate(stats.game.lastHeartbeatAt)}</dd></div>
          </dl>
          <div className="dev-active-list">
            <span>Active accounts</span>
            <div>
              {stats.game.activeAccounts.length > 0
                ? stats.game.activeAccounts.map((username) => <b key={username}>{username}</b>)
                : <em>None connected</em>}
            </div>
          </div>
        </div>

        <div className="dev-panel dev-panel-wide">
          <div className="dev-panel-heading">
            <div>
              <h2>Latest Accounts</h2>
              <p>Newest auth database entries with server-recorded activity.</p>
            </div>
          </div>
          <div className="dev-table-wrap">
            <table className="dev-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Type</th>
                  <th>Created</th>
                  <th>Last Login</th>
                  <th>Logins</th>
                  <th>Game Enters</th>
                </tr>
              </thead>
              <tbody>
                {stats.accounts.latest.map((account) => (
                  <tr key={account.id}>
                    <td>{account.username}</td>
                    <td>{account.accountType}</td>
                    <td>{formatDate(account.createdAt)}</td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>{formatNumber(account.loginCount)}</td>
                    <td>{formatNumber(account.gameEnterCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <DevVersionPanel />

      <footer className="dev-footer">
        Last refreshed {formatDate(stats.generatedAt)}
      </footer>
    </main>
  );
}
