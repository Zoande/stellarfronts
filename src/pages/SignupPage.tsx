import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import '../styles/Auth.css';

interface SignupPageProps {
  onSignupSubmit: (username: string, password: string) => Promise<void>;
  onBackToLogin: () => void;
}

export default function SignupPage({ onSignupSubmit, onBackToLogin }: SignupPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Fill in every field before creating your account.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onSignupSubmit(username, password);
    } catch (submitError) {
      const errorMessage = submitError instanceof Error ? submitError.message : 'Account creation failed';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="NEW COMMANDER"
      title="StellarFronts"
      subtitle="Create your commander profile from the same launcher-style surface used for login."
      copy="The signup view shares the same silhouette as the reference login screen so the auth flow feels like one premium game launcher rather than two different forms."
      highlights={[
        'Shared launcher treatment with the login screen',
        'Fast account creation for playtesting and seeded factions',
        'Direct handoff into the rebuilt lobby once registered',
      ]}
    >
      <div className="auth-header">
        <p className="auth-panel-kicker">Recruitment Terminal</p>
        <h2 className="stellar-title">Create Command Profile</h2>
      </div>

      <form onSubmit={handleSignup} className="auth-form">
        <div className="form-group">
          <label htmlFor="signup-username">Username</label>
          <input
            id="signup-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose your commander username"
            className="form-input"
            disabled={isLoading}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            minLength={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a secure password"
            className="form-input"
            disabled={isLoading}
            autoComplete="new-password"
            minLength={6}
          />
        </div>

        <div className="form-group">
          <label htmlFor="signup-confirm-password">Confirm Password</label>
          <input
            id="signup-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            className="form-input"
            disabled={isLoading}
            autoComplete="new-password"
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={isLoading}
        >
          {isLoading ? 'Creating command profile...' : 'Create Account'}
        </button>
      </form>

      <div className="auth-footer">
        <p>
          Already enlisted?{' '}
          <button
            type="button"
            className="link-button"
            onClick={onBackToLogin}
            disabled={isLoading}
          >
            Return to Login
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
