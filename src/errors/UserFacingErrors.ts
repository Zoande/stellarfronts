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

export interface UserErrorCopy {
  label: string;
  title: string;
  message: string;
}

const ERROR_COPY: Record<UserErrorKind, UserErrorCopy> = {
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

export function getUserErrorCopy(kind: UserErrorKind): UserErrorCopy {
  return ERROR_COPY[kind];
}

export function classifyRequestFailure(error: unknown): UserErrorKind | null {
  if (error instanceof TypeError) return 'serviceUnavailable';
  if (!error || typeof error !== 'object') return null;
  const status = Number((error as { status?: unknown }).status);
  if (status === 401) return 'sessionExpired';
  if (Number.isInteger(status) && status >= 500) return 'serviceUnavailable';
  return null;
}

export function classifyGameBootFailure(error: unknown): UserErrorKind {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('protocol') || message.includes('unsupported')
    ? 'updateRequired'
    : 'gameUnavailable';
}

