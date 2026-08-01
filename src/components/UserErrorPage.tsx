import '../styles/UserErrorPage.css';

export type UserErrorKind =
  | 'serviceUnavailable'
  | 'sessionExpired'
  | 'pageNotFound'
  | 'gameStarting'
  | 'gameUnavailable'
  | 'gameStopped'
  | 'gameNotFound'
  | 'gameFull'
  | 'connectionLost'
  | 'updateRequired'
  | 'unexpected';

const ERROR_COPY: Record<UserErrorKind, { label: string; title: string; message: string }> = {
  serviceUnavailable: {
    label: 'Connection unavailable',
    title: 'Cannot reach StellarFronts',
    message: 'The service is temporarily unavailable. Please come back in a few minutes.',
  },
  sessionExpired: {
    label: 'Session ended',
    title: 'Please sign in again',
    message: 'Your session is no longer active. Sign in again to continue.',
  },
  pageNotFound: {
    label: 'Unknown destination',
    title: 'Page not found',
    message: 'This page does not exist or may have moved.',
  },
  gameStarting: {
    label: 'Game preparing',
    title: 'This game is getting ready',
    message: 'The game is still starting. Please come back in a moment.',
  },
  gameUnavailable: {
    label: 'Game unavailable',
    title: 'This game cannot be reached',
    message: 'The game is temporarily unavailable. Please come back later.',
  },
  gameStopped: {
    label: 'Game offline',
    title: 'This game is not running',
    message: 'The game is currently offline. Please come back later.',
  },
  gameNotFound: {
    label: 'Game unavailable',
    title: 'Game not found',
    message: 'This game no longer exists or is not available to your account.',
  },
  gameFull: {
    label: 'No space available',
    title: 'This game is full',
    message: 'There are no countries available to claim in this game.',
  },
  connectionLost: {
    label: 'Connection interrupted',
    title: 'Connection to the game was lost',
    message: 'The game may be restarting. Please wait a moment and try again.',
  },
  updateRequired: {
    label: 'Version unavailable',
    title: 'This game cannot open yet',
    message: 'This game is temporarily incompatible with the current client. Please come back later.',
  },
  unexpected: {
    label: 'Something went wrong',
    title: 'StellarFronts hit an error',
    message: 'The request could not be completed. Please try again later.',
  },
};

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
  const copy = ERROR_COPY[kind];
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

