import { useEffect, useRef, useState } from 'react';
import { getGames, joinGame } from '@/auth/client';
import type { AccountType } from '@/auth/types';
import type { GameSummary } from '@/auth/types';
import { GameLogoutButton } from '@/components/GameLogoutButton';
import { FlagJoinForm } from '@/components/FlagJoinForm';
import { LoadingScreen } from '@/components/LoadingScreen';
import { UserErrorPage } from '@/components/UserErrorPage';
import type { UserErrorKind } from '@/components/UserErrorPage';
import { classifyGameBootFailure, classifyRequestFailure } from '@/errors/UserFacingErrors';
import type { FlagDesign } from '@/flags/flagTypes';
import type { SpeciesSetup } from '@/data/Species';
import '../styles/Game.css';

interface GamePageProps {
  gameId: string;
  username: string;
  accountType: AccountType;
  onLogout: () => void;
}

type EntryMode = 'checking' | 'ready' | 'join' | 'blocked';

export default function GamePage({ gameId, username, accountType, onLogout }: GamePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);
  const bootStartedAtRef = useRef(0);
  const bootHideTimerRef = useRef<number | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [showBootLoading, setShowBootLoading] = useState(false);
  const [bootError, setBootError] = useState<UserErrorKind | null>(null);
  const [bootProgress, setBootProgress] = useState(0);
  const [bootDetail, setBootDetail] = useState('Preparing galaxy map');
  const [entryMode, setEntryMode] = useState<EntryMode>('checking');
  const [entryGame, setEntryGame] = useState<GameSummary | null>(null);
  const [entryError, setEntryError] = useState('');
  const [entryProblem, setEntryProblem] = useState<UserErrorKind | null>(null);
  const [entryAttempt, setEntryAttempt] = useState(0);
  const [joinBusy, setJoinBusy] = useState(false);

  const clearBootHideTimer = () => {
    if (bootHideTimerRef.current !== null) {
      window.clearTimeout(bootHideTimerRef.current);
      bootHideTimerRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    setEntryMode('checking');
    setEntryError('');
    setEntryProblem(null);

    void getGames()
      .then((games) => {
        if (cancelled) return;
        const game = games.find((candidate) => candidate.id === gameId) ?? null;
        setEntryGame(game);
        if (!game) {
          setEntryMode('blocked');
          setEntryProblem('gameNotFound');
          return;
        }
        if (game.availability === 'starting') {
          setEntryMode('blocked');
          setEntryProblem('gameStarting');
          return;
        }
        if (game.availability === 'unavailable') {
          setEntryMode('blocked');
          setEntryProblem('gameUnavailable');
          return;
        }
        if (game.availability === 'stopped') {
          setEntryMode('blocked');
          setEntryProblem('gameStopped');
          return;
        }
        if (game.isJoined) {
          setEntryMode('ready');
          return;
        }
        if (game.joinable) {
          setEntryMode('join');
          return;
        }
        setEntryMode('blocked');
        setEntryProblem('gameFull');
      })
      .catch((error) => {
        if (cancelled) return;
        setEntryMode('blocked');
        setEntryProblem(classifyRequestFailure(error) ?? 'serviceUnavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [entryAttempt, gameId]);

  useEffect(() => {
    if (entryMode !== 'ready' || bootedRef.current || !containerRef.current) return;

    let cancelled = false;
    let bootFailed = false;
    let cleanupBoot: (() => void) | null = null;
    clearBootHideTimer();
    bootStartedAtRef.current = window.performance.now();
    setIsBooting(true);
    setShowBootLoading(true);
    setBootError(null);
    setBootProgress(0);
    setBootDetail('Preparing galaxy map');

    const hideBootLoading = (delayMs = 500) => {
      clearBootHideTimer();
      bootHideTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setIsBooting(false);
      }, delayMs);
    };

    import('../game/boot')
      .then(({ boot }) => {
        if (cancelled || !containerRef.current) return;
        bootedRef.current = true;
        void boot(containerRef.current, {
          adminCommandsEnabled: accountType === 'admin' && username.trim().toLowerCase() === 'admin',
          gameId,
          onProgress: (progress, detail) => {
            if (cancelled) return;
            setBootProgress(progress * 100);
            setBootDetail(detail);
          },
          onConnectionLost: () => {
            if (!cancelled) setBootError('connectionLost');
          },
        })
          .then((cleanup) => {
            cleanupBoot = cleanup;
            if (cancelled) {
              cleanupBoot?.();
              cleanupBoot = null;
            }
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            bootFailed = true;
            setBootError(classifyGameBootFailure(error));
            bootedRef.current = false;
            hideBootLoading(0);
          })
          .finally(() => {
            if (!cancelled && !bootFailed) hideBootLoading(500);
          });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        bootFailed = true;
        setBootError('unexpected');
        hideBootLoading(0);
      });

    return () => {
      cancelled = true;
      clearBootHideTimer();
      cleanupBoot?.();
    };
  }, [accountType, entryMode, gameId, username]);

  const handleJoin = async (selectedCountryName: string, flagDesign: FlagDesign, speciesSetup: SpeciesSetup) => {
    if (!entryGame || joinBusy) return;
    try {
      setJoinBusy(true);
      setEntryError('');
      const result = await joinGame(entryGame.id, selectedCountryName, flagDesign, speciesSetup);
      setEntryGame(result.game);
      setEntryMode('ready');
    } catch (error) {
      const failure = classifyRequestFailure(error);
      if (failure) {
        setEntryMode('blocked');
        setEntryProblem(failure);
        return;
      }
      setEntryError(error instanceof Error ? error.message : 'Could not join game');
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="game-container" ref={containerRef}>
      <canvas id="renderCanvas"></canvas>
      <GameLogoutButton onLogout={onLogout} />
      {showBootLoading && (
        <LoadingScreen
          theme="game"
          subtitle="Galaxy Command"
          title="Entering Command View"
          progress={bootProgress}
          detail={bootDetail}
          isVisible={isBooting}
          onHidden={() => setShowBootLoading(false)}
          zIndex={210}
        />
      )}
      {bootError && (
        <UserErrorPage
          kind={bootError}
          variant="overlay"
          onPrimary={() => window.location.reload()}
          secondaryLabel="Home"
          onSecondary={() => window.location.assign('/home')}
        />
      )}
      {entryMode === 'checking' && (
        <LoadingScreen
          theme="game"
          subtitle="Galaxy Command"
          title="Entering Command View"
          progress={22}
          detail="Checking game access"
          isVisible
          zIndex={205}
        />
      )}
      {entryMode !== 'ready' && entryMode !== 'checking' && (
        <div className="game-entry-backdrop">
          {entryMode === 'join' && entryGame ? (
            <FlagJoinForm
              className="game-entry-panel game-join-panel"
              gameName={entryGame.name}
              busy={joinBusy}
              error={entryError}
              cancelLabel="Home"
              submitLabel="Claim Country"
              onCancel={() => window.location.assign('/home')}
              onSubmit={handleJoin}
            />
          ) : (
            <UserErrorPage
              kind={entryProblem ?? 'unexpected'}
              variant="overlay"
              primaryLabel={entryProblem === 'sessionExpired' ? 'Sign In' : 'Try Again'}
              onPrimary={entryProblem === 'sessionExpired'
                ? () => window.location.assign('/')
                : () => setEntryAttempt((attempt) => attempt + 1)}
              secondaryLabel="Home"
              onSecondary={() => window.location.assign('/home')}
            />
          )}
        </div>
      )}
      <div className="game-username">{username}</div>
    </div>
  );
}
