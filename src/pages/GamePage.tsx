import { useEffect, useRef, useState } from 'react';
import { getGames, joinGame } from '@/auth/client';
import type { AccountType } from '@/auth/types';
import type { GameSummary } from '@/auth/types';
import { GameLogoutButton } from '@/components/GameLogoutButton';
import { FlagJoinForm } from '@/components/FlagJoinForm';
import { LoadingScreen } from '@/components/LoadingScreen';
import type { FlagDesign } from '@/flags/flagTypes';
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
  const [bootError, setBootError] = useState('');
  const [bootProgress, setBootProgress] = useState(0);
  const [bootDetail, setBootDetail] = useState('Preparing galaxy map');
  const [entryMode, setEntryMode] = useState<EntryMode>('checking');
  const [entryGame, setEntryGame] = useState<GameSummary | null>(null);
  const [entryError, setEntryError] = useState('');
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

    void getGames()
      .then((games) => {
        if (cancelled) return;
        const game = games.find((candidate) => candidate.id === gameId) ?? null;
        setEntryGame(game);
        if (!game) {
          setEntryMode('blocked');
          setEntryError('Game not found.');
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
        setEntryError('This game is full.');
      })
      .catch((error) => {
        if (cancelled) return;
        setEntryMode('blocked');
        setEntryError(error instanceof Error ? error.message : 'Could not check game access');
      });

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (entryMode !== 'ready' || bootedRef.current || !containerRef.current) return;

    let cancelled = false;
    let bootFailed = false;
    let cleanupBoot: (() => void) | null = null;
    clearBootHideTimer();
    bootStartedAtRef.current = window.performance.now();
    setIsBooting(true);
    setShowBootLoading(true);
    setBootError('');
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
            setBootError(error instanceof Error ? error.message : 'Failed to start game');
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
        setBootError(error instanceof Error ? error.message : 'Failed to load game boot module');
        hideBootLoading(0);
      });

    return () => {
      cancelled = true;
      clearBootHideTimer();
      cleanupBoot?.();
    };
  }, [accountType, entryMode, gameId, username]);

  const handleJoin = async (selectedCountryName: string, flagDesign: FlagDesign) => {
    if (!entryGame || joinBusy) return;
    try {
      setJoinBusy(true);
      setEntryError('');
      const result = await joinGame(entryGame.id, selectedCountryName, flagDesign);
      setEntryGame(result.game);
      setEntryMode('ready');
    } catch (error) {
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
        <div className="game-error-banner">{bootError}</div>
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
            <section className="game-entry-panel">
              <div className="game-entry-kicker">Game Access</div>
              <h1>Cannot Enter Game</h1>
              <p>{entryError}</p>
              <div className="game-entry-actions">
                <button type="button" onClick={() => window.location.assign('/home')}>Home</button>
              </div>
            </section>
          )}
        </div>
      )}
      <div className="game-username">{username}</div>
    </div>
  );
}
