import { useEffect, useMemo, useState } from 'react';
import { getGames, joinGame } from '@/auth/client';
import type { AuthAccount, GameSummary } from '@/auth/types';
import { FlagJoinForm } from '@/components/FlagJoinForm';
import type { FlagDesign } from '@/flags/flagTypes';
import '../styles/Home.css';

interface HomePageProps {
  account: AuthAccount;
  onContinuePlaying: (gameId: string) => void;
}

interface ProgressStat {
  label: string;
  value: string;
  meta: string;
  progress: number;
  variant: 'rank' | 'contract';
}

const navigationItems = ['Home', 'Games', 'Ranking', 'Alliance', 'Shop'];
const tabItems = ['Overview', 'News', 'Messages'];
const CONTINUE_PAGE_SIZE = 3;

const progressStats: ProgressStat[] = [
  {
    label: 'Navigator Rank',
    value: 'Stellar Vanguard',
    meta: '4,820 / 10,000 XP',
    progress: 48,
    variant: 'rank',
  },
  {
    label: 'Survey Contracts',
    value: '12 Complete',
    meta: '66 / 100 sectors',
    progress: 66,
    variant: 'contract',
  },
];

const eventCards = [
  {
    header: 'Current Event',
    name: 'Nebula Frontline',
    meta: 'Sign-up ends in 02:13:34:58',
    image: '/textures/planets/Methane/Methane_04-1024x512.webp',
  },
  {
    header: 'Scenario Rotation',
    name: 'Outer Rim Siege',
    meta: 'Available until 02:13:34:58',
    image: '/textures/planets/Martian/Martian_03-1024x512.webp',
  },
];

function CommanderSigil({ initial }: { initial: string }) {
  return (
    <div className="home-sigil" aria-hidden="true">
      <span className="home-sigil-ring" />
      <span className="home-sigil-core">{initial}</span>
      <span className="home-sigil-spark one" />
      <span className="home-sigil-spark two" />
    </div>
  );
}

function MedalIcon({ variant }: { variant: ProgressStat['variant'] }) {
  return (
    <div className={`home-medal is-${variant}`} aria-hidden="true">
      <span className="home-medal-star" />
    </div>
  );
}

function formatLastEntered(timestamp: number | null): string {
  if (!timestamp) return 'Not entered yet';
  return `Last entered ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))}`;
}

function gameStatus(game: GameSummary): string {
  if (game.membership) return game.membership.countryName;
  if (game.isJoined) return 'Privileged command access';
  if (game.isFull) return 'Game full';
  return 'Open country available';
}

export default function HomePage({ account, onContinuePlaying }: HomePageProps) {
  const [section, setSection] = useState<'Home' | 'Games'>('Home');
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState('');
  const [continuePage, setContinuePage] = useState(0);
  const [joinTarget, setJoinTarget] = useState<GameSummary | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);

  const loadGames = async () => {
    try {
      setGamesLoading(true);
      setGamesError('');
      setGames(await getGames());
    } catch (error) {
      setGamesError(error instanceof Error ? error.message : 'Could not load games');
    } finally {
      setGamesLoading(false);
    }
  };

  useEffect(() => {
    void loadGames();
  }, []);

  const privileged = account.accountType === 'observer' || account.accountType === 'admin';
  const continueGames = useMemo(
    () => (privileged ? games : games.filter((game) => game.isJoined)),
    [games, privileged],
  );
  const continuePageCount = Math.max(1, Math.ceil(continueGames.length / CONTINUE_PAGE_SIZE));
  const visibleContinueGames = continueGames.slice(
    continuePage * CONTINUE_PAGE_SIZE,
    (continuePage + 1) * CONTINUE_PAGE_SIZE,
  );
  const leadGame = continueGames[0] ?? null;

  useEffect(() => {
    if (continuePage < continuePageCount) return;
    setContinuePage(Math.max(0, continuePageCount - 1));
  }, [continuePage, continuePageCount]);

  const commanderName = account.username.trim() || 'Commander';
  const commanderInitial = commanderName.charAt(0).toUpperCase();
  const commanderRole = account.accountType === 'admin'
    ? 'Administrator'
    : account.accountType === 'observer'
      ? 'Observer'
      : 'Commander';
  const commanderNote = privileged
    ? 'Command access is synced across active games.'
    : leadGame
      ? `${leadGame.name} is ready to resume.`
      : 'Join a game to claim a country.';

  const openGameAction = (game: GameSummary) => {
    if (game.isJoined) {
      onContinuePlaying(game.id);
      return;
    }
    setJoinError('');
    setJoinTarget(game);
  };

  const handleJoin = async (selectedCountryName: string, flagDesign: FlagDesign) => {
    if (!joinTarget || joinBusy) return;
    try {
      setJoinBusy(true);
      setJoinError('');
      const result = await joinGame(joinTarget.id, selectedCountryName, flagDesign);
      setJoinTarget(null);
      setGames((current) => current.map((game) => (game.id === result.game.id ? result.game : game)));
      onContinuePlaying(result.game.id);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Could not join game');
    } finally {
      setJoinBusy(false);
    }
  };

  const renderGameRow = (game: GameSummary) => (
    <article className="home-game-row" key={game.id}>
      <div className="home-game-art" aria-hidden="true">
        <img src="/textures/planets/Gaseous/Gaseous_12-1024x512.webp" alt="" />
      </div>
      <div className="home-game-copy">
        <div className="home-server-name">{game.name}</div>
        <div className="home-server-meta">{gameStatus(game)}</div>
        <div className="home-game-capacity">
          {game.controlledCountries} / {game.countryCapacity} countries controlled
          <span>{formatLastEntered(game.lastEnteredAt)}</span>
        </div>
      </div>
      <button
        type="button"
        className="home-secondary-btn"
        onClick={() => openGameAction(game)}
        disabled={!game.isJoined && !game.joinable}
      >
        {game.isJoined ? 'Continue' : game.isFull ? 'Full' : 'Join'}
      </button>
    </article>
  );

  return (
    <div className="home-page">
      <div className="home-space-decor" aria-hidden="true">
        <span className="home-star-dust dust-left" />
        <span className="home-star-dust dust-right" />
        <span className="home-orbital-planet planet-left-large" />
        <span className="home-orbital-planet planet-left-small" />
        <span className="home-orbital-planet planet-right-large" />
        <span className="home-orbital-planet planet-right-small" />
        <span className="home-deep-star star-left" />
        <span className="home-deep-star star-right" />
      </div>
      <div className="home-shell">
        <header className="home-top-nav" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <button
              key={item}
              type="button"
              className={`home-top-link ${item === section ? 'is-active' : ''}`}
              onClick={() => {
                if (item === 'Home' || item === 'Games') setSection(item);
              }}
            >
              <span className="home-link-mark" />
              {item}
            </button>
          ))}
        </header>

        <section className="home-tabs" aria-label="Home sections">
          {tabItems.map((item) => (
            <button
              key={item}
              type="button"
              className={`home-tab ${item === 'Overview' ? 'is-active' : ''}`}
            >
              {item}
            </button>
          ))}
        </section>

        {section === 'Games' ? (
          <main className="home-games-shell">
            <section className="home-card home-games-catalog">
              <div className="home-card-heading">
                <h2 className="home-card-title">Games</h2>
                <span className="home-card-kicker">{games.length} active</span>
              </div>
              <div className="home-game-list is-catalog">
                {gamesLoading && <div className="home-list-message">Loading games</div>}
                {gamesError && <div className="home-list-message is-error">{gamesError}</div>}
                {!gamesLoading && !gamesError && games.length === 0 && (
                  <div className="home-list-message">No games have been created yet.</div>
                )}
                {games.map(renderGameRow)}
              </div>
            </section>
          </main>
        ) : (
          <main className="home-grid">
            <section className="home-card home-profile">
              <div className="home-card-heading">
                <h2 className="home-card-title">Command Overview</h2>
                <span className="home-card-kicker">Welcome back, {commanderName}</span>
              </div>
              <div className="home-profile-row">
                <div className="home-avatar">
                  <CommanderSigil initial={commanderInitial} />
                  <div>
                    <div className="home-avatar-name">{commanderName}</div>
                    <div className="home-avatar-role">{commanderRole}</div>
                  </div>
                  <div className="home-avatar-progress">
                    <span>Lvl. 35</span>
                    <div className="home-progress"><span style={{ width: '37%' }} /></div>
                    <span>10,746 / 11,500</span>
                  </div>
                </div>
                {progressStats.map((stat) => (
                  <div className="home-stat" key={stat.label}>
                    <MedalIcon variant={stat.variant} />
                    <div className="home-stat-label">{stat.label}</div>
                    <div className="home-stat-value">{stat.value}</div>
                    <div className="home-progress"><span style={{ width: `${stat.progress}%` }} /></div>
                    <div className="home-progress-meta">{stat.meta}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="home-card home-action">
              <div className="home-action-frame">
                <div className="home-ship-holo" aria-hidden="true"><span /></div>
                <h2 className="home-action-title">Ready For A New Operation?</h2>
                <p className="home-action-subtitle">{commanderNote}</p>
                <button
                  type="button"
                  className="home-launch-btn"
                  onClick={() => leadGame ? onContinuePlaying(leadGame.id) : setSection('Games')}
                >
                  {leadGame ? 'Continue Playing' : 'Browse Games'}
                </button>
              </div>
            </section>

            <section className="home-card home-continue">
              <div className="home-card-heading">
                <h2 className="home-card-title">Continue Playing</h2>
                <div className="home-page-buttons">
                  <button
                    type="button"
                    className="home-page-btn"
                    disabled={continuePage === 0}
                    onClick={() => setContinuePage((page) => Math.max(0, page - 1))}
                  >
                    Prev
                  </button>
                  <span>{continuePage + 1} / {continuePageCount}</span>
                  <button
                    type="button"
                    className="home-page-btn"
                    disabled={continuePage + 1 >= continuePageCount}
                    onClick={() => setContinuePage((page) => Math.min(continuePageCount - 1, page + 1))}
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="home-game-list">
                {gamesLoading && <div className="home-list-message">Loading games</div>}
                {gamesError && <div className="home-list-message is-error">{gamesError}</div>}
                {!gamesLoading && !gamesError && visibleContinueGames.length === 0 && (
                  <div className="home-list-message">No games ready to continue.</div>
                )}
                {visibleContinueGames.map(renderGameRow)}
              </div>
            </section>

            <section className="home-card home-events">
              <h2 className="home-card-title">Events</h2>
              <div className="home-event-grid">
                {eventCards.map((event) => (
                  <article className="home-event" key={event.name}>
                    <div className="home-event-image"><img src={event.image} alt="" /></div>
                    <div className="home-event-header">{event.header}</div>
                    <div className="home-event-name">{event.name}</div>
                    <div className="home-event-meta">{event.meta}</div>
                  </article>
                ))}
              </div>
            </section>
          </main>
        )}
      </div>

      {joinTarget && (
        <div className="home-overlay-backdrop">
          <FlagJoinForm
            className="home-overlay"
            gameName={joinTarget.name}
            busy={joinBusy}
            error={joinError}
            submitLabel="Claim Country"
            onCancel={() => setJoinTarget(null)}
            onSubmit={handleJoin}
          />
        </div>
      )}
    </div>
  );
}
