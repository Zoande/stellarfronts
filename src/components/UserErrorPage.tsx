import '../styles/UserErrorPage.css';
import { getUserErrorCopy } from '../errors/UserFacingErrors';
import type { UserErrorKind } from '../errors/UserFacingErrors';

export type { UserErrorKind } from '../errors/UserFacingErrors';

interface UserErrorPageProps {
  kind?: UserErrorKind;
  variant?: 'fullscreen' | 'overlay' | 'compact';
  title?: string;
  message?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function UserErrorPage({
  kind = 'unexpected',
  variant = 'fullscreen',
  title,
  message,
  primaryLabel = 'Try Again',
  onPrimary,
  secondaryLabel,
  onSecondary,
}: UserErrorPageProps) {
  const copy = getUserErrorCopy(kind);
  return (
    <div className={`user-error user-error--${variant}`} role="alert">
      <div className="user-error__stars" aria-hidden="true" />
      <section className="user-error__panel">
        <div className="user-error__mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="user-error__label">{copy.label}</p>
        <h1>{title ?? copy.title}</h1>
        <p className="user-error__message">{message ?? copy.message}</p>
        {(onPrimary || onSecondary) && (
          <div className="user-error__actions">
            {onSecondary && secondaryLabel && (
              <button type="button" className="user-error__button user-error__button--quiet" onClick={onSecondary}>
                {secondaryLabel}
              </button>
            )}
            {onPrimary && (
              <button type="button" className="user-error__button" onClick={onPrimary}>
                {primaryLabel}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
