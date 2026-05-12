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
