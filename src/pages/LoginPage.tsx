
import { useMemo, useState } from 'react';
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

  const isFormValid = useMemo(() => {
    return username.trim().length > 0 && password.trim().length > 0;
  }, [username, password]);

  const [showGuestHint, setShowGuestHint] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError('Enter your Commander ID and Access Code.');
      return;
    }

    if (password.length < 1) {
      setError('Invalid Access Code.');
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
    <div className="auth-panel">
      <div className="auth-header">
        <h1 className="stellar-title">StellarFronts</h1>
        <p className="auth-subtitle">Command Your Destiny</p>
      </div>

      <form onSubmit={handleLogin} className="auth-form">
        <div className="form-group">
          <label htmlFor="username">Commander ID</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            className="form-input"
            disabled={isLoading}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Access Code</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your access code"
            className="form-input"
            disabled={isLoading}
            autoComplete="current-password"
          />
        </div>

        {error && <div className="form-error">⚠ {error}</div>}

        <button type="submit" className="btn btn-primary" disabled={isLoading || !isFormValid}>
          {isLoading ? 'Initializing Command Link...' : 'Access Station'}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSignupClick}
          disabled={isLoading}
          style={{ marginLeft: '12px' }}
        >
          New Commander? Enlist
        </button>

        {onGuestMode && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleGuest}
            disabled={isLoading}
            style={{ marginLeft: '12px' }}
          >
            Play as Guest
          </button>
        )}

        {showGuestHint && <div className="auth-hint">You are entering as a guest. Progress will not be saved.</div>}
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      <div className="oauth-buttons" style={{ gridTemplateColumns: '1fr', width: '100%' }}>
        <button
          type="button"
          className="btn btn-oauth btn-google"
          aria-label="Sign in with Google"
          disabled
          style={{ width: '100%' }}
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

