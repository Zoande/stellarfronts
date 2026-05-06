import { useState } from 'react';
import '../styles/Auth.css';

interface SignupPageProps {
  onSignupSubmit: (email: string, username: string) => void;
  onBackToLogin: () => void;
}

export default function SignupPage({ onSignupSubmit, onBackToLogin }: SignupPageProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim() || !username.trim() || !password.trim()) {
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

    setError('');
    onSignupSubmit(email, username);
  };

  const handleOAuthClick = (provider: string) => {
    console.log(`OAuth Signup: ${provider}`);
    onSignupSubmit(`${provider}@stellarfronts.com`, `user_${provider}`);
  };

  return (
    <div className="auth-container">
      <div className="stars-bg"></div>
      
      <div className="auth-panel">
        <div className="auth-header">
          <h1 className="stellar-title">StellarFronts</h1>
          <p className="auth-subtitle">Join the Frontier</p>
        </div>

        <form onSubmit={handleSignup} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="signup-username">Username</label>
            <input
              id="signup-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              className="form-input"
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary">
            Create Account
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <div className="oauth-buttons">
          <button
            type="button"
            onClick={() => handleOAuthClick('google')}
            className="btn btn-oauth btn-google"
          >
            <span className="oauth-icon">🔵</span> Google
          </button>
          <button
            type="button"
            onClick={() => handleOAuthClick('outlook')}
            className="btn btn-oauth btn-outlook"
          >
            <span className="oauth-icon">📧</span> Outlook
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
    </div>
  );
}
