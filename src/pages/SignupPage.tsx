import { useState } from 'react';
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
  const [passwordStrength, setPasswordStrength] = useState<'weak' | 'fair' | 'good' | ''>('');

  const calculatePasswordStrength = (pwd: string) => {
    if (pwd.length < 6) return 'weak';
    if (pwd.length < 10) return 'fair';
    return 'good';
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pwd = e.target.value;
    setPassword(pwd);
    setPasswordStrength(calculatePasswordStrength(pwd));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
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

  const isFormValid = 
    username.trim().length >= 3 && 
    password.length >= 6 && 
    confirmPassword.length > 0 && 
    password === confirmPassword;

  return (
    <div className="auth-panel">
      <div className="auth-header">
        <h1 className="stellar-title">StellarFronts</h1>
        <p className="auth-subtitle">Join the Frontier</p>
      </div>

      <form onSubmit={handleSignup} className="auth-form">
        <div className="form-group">
          <label htmlFor="signup-username">Commander ID</label>
          <input
            id="signup-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose your commander ID"
            className="form-input"
            disabled={isLoading}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            minLength={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="signup-password">
            Access Code 
            {password && (
              <span style={{ 
                marginLeft: '8px', 
                fontSize: '11px', 
                color: passwordStrength === 'good' ? 'var(--stellar-accent)' : 
                       passwordStrength === 'fair' ? '#f0ad4e' : 'var(--stellar-danger)'
              }}>
                ({passwordStrength})
              </span>
            )}
          </label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={handlePasswordChange}
            placeholder="Create a secure access code"
            className="form-input"
            disabled={isLoading}
            autoComplete="new-password"
            minLength={6}
          />
        </div>

        <div className="form-group">
          <label htmlFor="signup-confirm-password">Confirm Access Code</label>
          <input
            id="signup-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your access code"
            className="form-input"
            disabled={isLoading}
            autoComplete="new-password"
          />
        </div>

        {error && <div className="form-error">⚠ {error}</div>}

        <button 
          type="submit" 
          className="btn btn-primary"
          disabled={isLoading || !isFormValid}
        >
          {isLoading ? 'Registering Command...' : 'Create Account'}
        </button>
      </form>

      <div className="divider">
        <span>already have access?</span>
      </div>

      <div className="auth-footer">
        <p>
          <button
            type="button"
            className="link-button"
            onClick={onBackToLogin}
            disabled={isLoading}
          >
            Return to Login Station
          </button>
        </p>
      </div>
    </div>
  );
}

        <button type="submit" className="btn btn-primary">
          Create Account
        </button>
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      <div className="oauth-buttons">
        <button type="button" className="btn btn-oauth btn-google" aria-label="Sign up with Google" disabled>
          <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="oauth-svg">
            <path fill="#EA4335" d="M24 12.24c3.54 0 6.36 1.22 8.26 2.22l6.02-5.86C35.6 5.02 30.08 3.2 24 3.2 14.7 3.2 6.99 8.86 3.5 16.9l6.98 5.42C12.9 15.6 17.95 12.24 24 12.24z"/>
            <path fill="#34A853" d="M46.5 24c0-1.6-.15-2.8-.46-4.02H24v8.02h12.98c-.57 3.08-2.3 5.5-4.9 7.22l7.45 5.78C43.86 37.36 46.5 31.12 46.5 24z"/>
            <path fill="#4A90E2" d="M10.48 29.32A14.9 14.9 0 0 1 9.6 24c0-1.6.27-3.14.76-4.56L3.5 13.99A23.97 23.97 0 0 0 .5 24c0 3.84.92 7.48 2.98 10.7l7  -5.38z"/>
            <path fill="#FBBC05" d="M24 44.8c6.08 0 11.6-1.82 15.78-4.94l-7.45-5.78C30.36 34.96 27.66 36 24 36c-6.05 0-11.1-3.36-13.52-8.42l-6.98 5.42C6.99 39.94 14.7 44.8 24 44.8z"/>
          </svg>
          <span className="oauth-label">Google</span>
        </button>

        <button type="button" className="btn btn-oauth btn-microsoft" aria-label="Sign up with Microsoft" disabled>
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
          Already have an account?{' '}
          <button
            type="button"
            onClick={onBackToLogin}
            className="link-button"
          >
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}
