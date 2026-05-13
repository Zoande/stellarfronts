import type { ReactNode } from 'react';
import loginBackdrop from '../../background login.png';
import stellarLogo from '../../logosteller.png';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  copy: string;
  highlights: string[];
  children: ReactNode;
}

export function AuthShell({ eyebrow, title, subtitle, copy, highlights, children }: AuthShellProps) {
  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-label="StellarFronts introduction">
        <div className="auth-hero-content">
          <p className="auth-hero-eyebrow">{eyebrow}</p>

          <div className="auth-hero-brand">
            <img
              src={stellarLogo}
              alt={title}
              className="auth-hero-logo"
              style={{
                width: 'min(460px, 100%)',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                filter: 'drop-shadow(0 0 26px rgba(124, 207, 255, 0.36))',
              }}
            />
          </div>

          <p className="auth-hero-subtitle">{subtitle}</p>
          <p className="auth-hero-copy">{copy}</p>

          <ul className="auth-hero-highlights" aria-label="Frontier highlights">
            {highlights.map((item) => (
              <li key={item} className="auth-hero-highlight">
                <span className="auth-hero-highlight-dot" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-hero-visual" aria-hidden="true">
          <img src={loginBackdrop} alt="" />
          <div className="auth-hero-visual-overlay" />
          <div className="auth-hero-visual-frame" />
        </div>
      </section>

      <section className="auth-panel auth-panel--landing">
        {children}
      </section>
    </div>
  );
}
