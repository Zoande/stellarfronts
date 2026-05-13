import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import '../styles/Auth.css';

interface LoginPageProps {
  onLoginSubmit: (username: string, password: string) => Promise<void>;
  onSignupClick: () => void;
  onGuestMode?: () => void;
}

export default function LoginPage({ onLoginSubmit, onSignupClick, onGuestMode }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showGuestHint, setShowGuestHint] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError('Enter your email or username and your password.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onLoginSubmit(username, password);
    } catch (submitError) {
      const errorMessage = submitError instanceof Error ? submitError.message : 'Login failed';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const handleGuest = () => {
    setShowGuestHint(true);
    onGuestMode?.();
  };

  return (
    <AuthShell
      eyebrow="Kepler Veil Relay"
      title="StellarFronts"
      subtitle="Dock with relay seven and rejoin the frontier lanes before the next jump window closes."
      copy="Rift beacons are flaring beyond Cygnus Prime, escorts are stacking in the dark, and command is clearing every verified pilot back to the deck."
      highlights={[
        'Convoy traffic is moving through the breach',
        'Observer clearance is available for temporary entry',
        'Faction channels unlock after identity sync',
      ]}
    >
      <div className="auth-header">
        <p className="auth-panel-kicker">Bridge Access</p>
        <h2 className="stellar-title">Return to Command</h2>
      </div>

      <form onSubmit={handleLogin} className="auth-form">
        <div className="form-group">
          <label htmlFor="username">Email or Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your email or username"
            className="form-input"
            disabled={isLoading}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        <div className="form-group">
          <div className="form-label-row">
            <label htmlFor="password">Password</label>
            <button
              type="button"
              className="auth-inline-link"
              onClick={() => setError('Password recovery is not connected yet.')}
              disabled={isLoading}
            >
              Forgot Password?
            </button>
          </div>
          <div className="form-input-wrap">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="form-input"
              disabled={isLoading}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="form-aux-button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? 'Linking command uplink...' : 'Enter Command Deck'}
        </button>

        <div className="auth-divider">
          <span>or</span>
        </div>

        {onGuestMode && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleGuest}
            disabled={isLoading}
          >
            Continue as Observer
          </button>
        )}

        {showGuestHint && (
          <div className="auth-hint">
            Observer passports grant temporary deck access, but fleet orders and long-term progress are not retained.
          </div>
        )}
      </form>

      <div className="auth-footer">
        <p>
          Need a command registry?{' '}
          <button
            type="button"
            className="link-button"
            onClick={onSignupClick}
            disabled={isLoading}
          >
            Create Command ID
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
