import { useEffect, useRef, useState } from 'react';
import { getGames, joinGame } from '@/auth/client';
import type { AccountType } from '@/auth/types';
import type { GameSummary } from '@/auth/types';
import { GameLogoutButton } from '@/components/GameLogoutButton';
import { LoadingScreen } from '@/components/LoadingScreen';
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
  const [countryName, setCountryName] = useState('');
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

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!entryGame || joinBusy) return;
    try {
      setJoinBusy(true);
      setEntryError('');
      const result = await joinGame(entryGame.id, countryName);
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
      {entryMode !== 'ready' && (
        <div className="game-entry-backdrop">
          {entryMode === 'checking' ? (
            <section className="game-entry-panel">
              <div className="game-entry-kicker">Galaxy Command</div>
              <h1>Checking Game Access</h1>
            </section>
          ) : entryMode === 'join' && entryGame ? (
            <form className="game-entry-panel game-join-panel" onSubmit={handleJoin}>
              <div className="game-entry-kicker">Join Game</div>
              <h1>{entryGame.name}</h1>
              <label htmlFor="game-country-name">Country name</label>
              <input
                id="game-country-name"
                value={countryName}
                maxLength={48}
                autoFocus
                onChange={(event) => setCountryName(event.target.value)}
              />
              {entryError && <div className="game-entry-error">{entryError}</div>}
              <div className="game-entry-actions">
                <button type="button" onClick={() => window.location.assign('/home')}>Home</button>
                <button type="submit" disabled={joinBusy}>{joinBusy ? 'Joining' : 'Claim Country'}</button>
              </div>
            </form>
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
