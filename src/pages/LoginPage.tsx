import { useState } from 'react';
import '../styles/Auth.css';

interface LoginPageProps {
  onLoginSubmit: (username: string, password: string, rememberMe: boolean) => Promise<void>;
  onSignupClick: () => void;
}

const frontierCards = [
  {
    image: '/textures/sidebar-icons/side_bar_fleet_icon.webp',
    title: 'Fleet Command',
    text: 'Coordinate patrol wings, escorts, and rapid response forces across active lanes.',
  },
  {
    image: '/textures/sidebar-icons/sidebar_diplomacy_icon.webp',
    title: 'Alliance Pressure',
    text: 'Treaties, border claims, and rival pacts shift the political shape of every sector.',
  },
  {
    image: '/textures/sidebar-icons/side_bar_tech_icon.webp',
    title: 'Living Research',
    text: 'Unlock command tools, weapons platforms, and infrastructure upgrades as your reach expands.',
  },
];

const commandSignals = [
  ['Live Servers Online', 'All command relays nominal'],
  ['Season 3 Active', 'Voidfront Reckoning'],
  ['New Player Grants', 'Starter cache available'],
];

const operations = [
  {
    image: '/textures/planet-banners/Grassland_banner_city.webp',
    label: 'Planetary Development',
    title: 'Build worlds that can survive the front',
    text: 'Balance districts, orbital logistics, civilian output, and defensive needs while the frontier pushes back.',
  },
  {
    image: '/textures/planet-banners/Star_A_banner.webp',
    label: 'Sector Control',
    title: 'Read the map before the map reads you',
    text: 'Route intelligence, starbase coverage, and contested jump lanes turn quiet systems into strategic anchors.',
  },
  {
    image: '/textures/starbase/Starbase_banner.webp',
    label: 'Station Command',
    title: 'Hold the relay, hold the war',
    text: 'Starbases project supply, repair fleets, and define where your forces can safely return to command.',
  },
];

function isTrustedStellarfrontsHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'stellarfronts.com' || normalized.endsWith('.stellarfronts.com');
}

export default function LoginPage({ onLoginSubmit, onSignupClick }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const isTrustedOrigin = typeof window === 'undefined'
    ? true
    : isTrustedStellarfrontsHost(window.location.hostname);
  const secureBadgeClassName = `secure-badge${isTrustedOrigin ? '' : ' secure-badge--warning'}`;
  const secureBadgeLabel = isTrustedOrigin ? 'Secure connection' : 'Unrecognized host';
  const secureBadgeTitle = isTrustedOrigin
    ? undefined
    : 'This login is not running on an official StellarFronts domain.';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }
    try {
      setError('');
      await onLoginSubmit(username, password, rememberMe);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    }
  };

  return (
    <main className="auth-experience">
      <div className="auth-scanlines" aria-hidden="true" />
      <div className="auth-route auth-route--one" aria-hidden="true" />
      <div className="auth-route auth-route--two" aria-hidden="true" />

      <section className="auth-hero" aria-label="StellarFronts command login">
        <div className="auth-hero__copy">
          <div className="auth-relay-tag">Kepler Veil Relay / Secure Bridge Access</div>
          <img
            className="auth-brand-logo"
            src="/branding/stellarfrontslogo.webp"
            alt="StellarFronts"
            width="640"
            height="166"
          />
          <div className="auth-frontier-line" aria-hidden="true">
            <span />
            <i />
            <span />
          </div>
          <h1 className="auth-hero-title">The Frontier Is Yours</h1>
          <p className="auth-hero-copy">
            Dock with relay seven and rejoin the active command net before the
            next jump window closes. Your fleets, stations, colonies, and
            faction orders are waiting for identity sync.
          </p>

          <div className="auth-signal-strip" aria-label="Current command signals">
            {commandSignals.map(([title, text]) => (
              <div className="auth-signal" key={title}>
                <span className="auth-signal__pulse" aria-hidden="true" />
                <strong>{title}</strong>
                <small>{text}</small>
              </div>
            ))}
          </div>

          <div className="frontier-card-grid">
            {frontierCards.map((card) => (
              <article className="frontier-card" key={card.title}>
                <img src={card.image} alt="" width="48" height="48" loading="eager" />
                <div>
                  <h2>{card.title}</h2>
                  <p>{card.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="auth-sticky-rail" aria-label="Login form">
          <div className="auth-panel auth-panel--login">
            <div className="auth-panel__glow" aria-hidden="true" />
            <div className="auth-header auth-header--login">
              <img
                className="auth-panel-logo"
                src="/branding/stellarfrontslogonotext-transparent.png"
                alt=""
                width="160"
                height="160"
              />
              <div>
                <p className="auth-eyebrow">Bridge Access</p>
                <h2 className="stellar-title">Return to Command</h2>
                <p className="auth-subtitle">Identity sync required</p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="form-group">
                <div className="form-row-label">
                  <label htmlFor="username">Email or Username</label>
                  <span className="form-status">Registry online</span>
                </div>
                <div className="input-shell">
                  <svg className="input-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 12.4c2.3 0 4.2-1.9 4.2-4.2S14.3 4 12 4 7.8 5.9 7.8 8.2s1.9 4.2 4.2 4.2Zm0 1.8c-3.4 0-6.4 1.7-8.2 4.4-.4.6 0 1.4.8 1.4h14.8c.7 0 1.2-.8.8-1.4-1.8-2.7-4.8-4.4-8.2-4.4Z" />
                  </svg>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your email or username"
                    className="form-input"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="form-group">
                <div className="form-row-label">
                  <label htmlFor="password">Password</label>
                  <button type="button" className="field-link" disabled>
                    Forgot password?
                  </button>
                </div>
                <div className="input-shell">
                  <svg className="input-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.5 10.2h-.8V8.1a4.7 4.7 0 0 0-9.4 0v2.1h-.8c-.8 0-1.5.7-1.5 1.5v6.8c0 .8.7 1.5 1.5 1.5h11c.8 0 1.5-.7 1.5-1.5v-6.8c0-.8-.7-1.5-1.5-1.5Zm-8.2 0V8.1a2.7 2.7 0 0 1 5.4 0v2.1H9.3Z" />
                  </svg>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="form-input"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="auth-options-row">
                <label className="remember-toggle">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span aria-hidden="true" />
                  Remember me
                </label>
                <span className={secureBadgeClassName} title={secureBadgeTitle}>
                  <i aria-hidden="true" />
                  {secureBadgeLabel}
                </span>
              </div>

              {error && <div className="form-error">{error}</div>}

              <button type="submit" className="btn btn-primary">
                Enter Command Deck
                <svg className="btn-arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5.5 15.5 12 9 18.5" />
                </svg>
              </button>
            </form>

            <div className="divider">
              <span>Sign in with</span>
            </div>

            <div className="oauth-buttons">
              <button
                type="button"
                className="btn btn-oauth btn-google"
                aria-label="Sign in with Google"
                disabled
              >
                <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="oauth-svg">
                  <path fill="#EA4335" d="M24 12.24c3.54 0 6.36 1.22 8.26 2.22l6.02-5.86C35.6 5.02 30.08 3.2 24 3.2 14.7 3.2 6.99 8.86 3.5 16.9l6.98 5.42C12.9 15.6 17.95 12.24 24 12.24z" />
                  <path fill="#34A853" d="M46.5 24c0-1.6-.15-2.8-.46-4.02H24v8.02h12.98c-.57 3.08-2.3 5.5-4.9 7.22l7.45 5.78C43.86 37.36 46.5 31.12 46.5 24z" />
                  <path fill="#4A90E2" d="M10.48 29.32A14.9 14.9 0 0 1 9.6 24c0-1.6.27-3.14.76-4.56L3.5 13.99A23.97 23.97 0 0 0 .5 24c0 3.84.92 7.48 2.98 10.7l7  -5.38z" />
                  <path fill="#FBBC05" d="M24 44.8c6.08 0 11.6-1.82 15.78-4.94l-7.45-5.78C30.36 34.96 27.66 36 24 36c-6.05 0-11.1-3.36-13.52-8.42l-6.98 5.42C6.99 39.94 14.7 44.8 24 44.8z" />
                </svg>
                <span className="oauth-label">Google</span>
              </button>

              <button
                type="button"
                className="btn btn-oauth btn-microsoft"
                aria-label="Sign in with Microsoft"
                disabled
              >
                <svg width="18" height="18" viewBox="0 0 24 24" className="oauth-svg" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="10" height="10" fill="#F1511B" />
                  <rect x="13" y="1" width="10" height="10" fill="#FFB900" />
                  <rect x="1" y="13" width="10" height="10" fill="#7BD03B" />
                  <rect x="13" y="13" width="10" height="10" fill="#00A4EF" />
                </svg>
                <span className="oauth-label">Microsoft</span>
              </button>
            </div>

            <div className="auth-footer">
              <p>
                Need a command registry?{' '}
                <button
                  type="button"
                  onClick={onSignupClick}
                  className="link-button"
                >
                  Create command ID
                </button>
              </p>
            </div>
          </div>
        </aside>
      </section>

      <section className="auth-info-band" aria-label="Frontier overview">
        <div className="auth-section-heading">
          <span>Command Briefing</span>
          <h2>Everything below the login stays alive while you scroll.</h2>
          <p>
            The bridge access card remains pinned for fast entry while the
            surrounding panels preview the kind of command information players
            return to after login.
          </p>
        </div>

        <div className="operation-grid">
          {operations.map((item) => (
            <article className="operation-card" key={item.title}>
              <img src={item.image} alt="" loading="lazy" width="520" height="240" />
              <div className="operation-card__body">
                <span>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="auth-info-band auth-info-band--systems" aria-label="Active systems">
        <div className="auth-section-heading">
          <span>Active Systems</span>
          <h2>Frontier channels ready for command sync.</h2>
        </div>

        <div className="system-preview-grid">
          <article className="system-preview">
            <img src="/flag-previews/aurora-vanguard.webp" alt="" loading="lazy" width="96" height="96" />
            <strong>Aurora Vanguard</strong>
            <span>Border patrols forming near Cygnus Prime</span>
          </article>
          <article className="system-preview">
            <img src="/flag-previews/onyx-beacon.webp" alt="" loading="lazy" width="96" height="96" />
            <strong>Onyx Beacon</strong>
            <span>Starbase crews requesting fresh assignments</span>
          </article>
          <article className="system-preview">
            <img src="/flag-previews/golden-trace.webp" alt="" loading="lazy" width="96" height="96" />
            <strong>Golden Trace</strong>
            <span>Trade convoys awaiting clearance</span>
          </article>
          <article className="system-preview">
            <img src="/textures/own_ship_icon.webp" alt="" loading="lazy" width="96" height="96" />
            <strong>Fleet Uplink</strong>
            <span>Command ship telemetry available after login</span>
          </article>
        </div>
      </section>
    </main>
  );
}
