import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGames, getPlayerProfile, joinGame, claimQuestReward } from '@/auth/client';
import type { AuthAccount, GameSummary, PlayerProfile, QuestInfo, AchievementInfo } from '@/auth/types';
import { MessagesPanel } from '@/components/MessagesPanel';
import { FlagJoinForm } from '@/components/FlagJoinForm';
import type { FlagDesign } from '@/flags/flagTypes';
import type { SpeciesSetup } from '@/data/Species';
import '../styles/Home.css';

interface HomePageProps {
  account: AuthAccount;
  onContinuePlaying: (gameId: string) => void;
}

const navigationItems = ['Home', 'Games', 'Ranking', 'Alliance', 'Shop'];
const tabItems = ['Overview', 'News', 'Messages'];
const CONTINUE_PAGE_SIZE = 3;

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

function CommanderSigil({ initial, color }: { initial: string; color?: string }) {
  return (
    <div className="home-sigil" aria-hidden="true" style={color ? { '--sigil-color': color } as React.CSSProperties : undefined}>
      <span className="home-sigil-ring" />
      <span className="home-sigil-core">{initial}</span>
      <span className="home-sigil-spark one" />
      <span className="home-sigil-spark two" />
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

function formatTimeLeft(resetsAt: number): string {
  const ms = resetsAt - Date.now();
  if (ms <= 0) return 'Resetting…';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

// ─── Achievement Panel ────────────────────────────────────────────────────────

function AchievementPanel({ achievements, onClose }: { achievements: AchievementInfo[]; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const unlocked = achievements.filter((a) => a.unlockedAt !== null).length;

  return (
    <div className="home-overlay-backdrop" ref={backdropRef} onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="home-overlay home-achievements-panel">
        <div className="home-panel-header">
          <h2 className="home-panel-title">Achievements</h2>
          <span className="home-panel-count">{unlocked} / {achievements.length} Unlocked</span>
          <button type="button" className="home-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="home-achievements-grid">
          {achievements.map((ach) => (
            <div key={ach.id} className={`home-ach-card ${ach.unlockedAt ? 'is-unlocked' : 'is-locked'}`}>
              <div className="home-ach-icon" aria-hidden="true">
                {ach.unlockedAt ? '★' : '☆'}
              </div>
              <div className="home-ach-body">
                <div className="home-ach-title">{ach.title}</div>
                <div className="home-ach-desc">{ach.description}</div>
                {ach.xpReward > 0 && (
                  <div className="home-ach-reward">+{ach.xpReward} XP</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Quest Panel ─────────────────────────────────────────────────────────────

function QuestPanel({
  quests,
  onClose,
  onClaim,
}: {
  quests: QuestInfo[];
  onClose: () => void;
  onClaim: (quest: QuestInfo) => Promise<void>;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const weekly = quests.filter((q) => q.type === 'weekly');
  const triday = quests.filter((q) => q.type === 'triday');

  const handleClaim = async (q: QuestInfo) => {
    if (claiming) return;
    setClaiming(q.id);
    try {
      await onClaim(q);
    } finally {
      setClaiming(null);
    }
  };

  const renderQuest = (q: QuestInfo) => {
    const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
    const done = q.completedAt !== null;
    const claimed = q.claimedAt !== null;
    return (
      <div key={`${q.id}:${q.windowKey}`} className={`home-quest-item ${done ? 'is-done' : ''} ${claimed ? 'is-claimed' : ''}`}>
        <div className="home-quest-head">
          <span className="home-quest-title">{q.title}</span>
          <span className="home-quest-timer">{formatTimeLeft(q.resetsAt)}</span>
        </div>
        <div className="home-quest-desc">{q.description}</div>
        <div className="home-quest-progress">
          <div className="home-progress home-quest-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="home-quest-pct">{q.progress} / {q.target}</span>
        </div>
        {done && !claimed && (
          <button
            type="button"
            className="home-quest-claim-btn"
            disabled={claiming === q.id}
            onClick={() => void handleClaim(q)}
          >
            {claiming === q.id ? 'Claiming…' : `Claim +${q.xpReward} XP`}
          </button>
        )}
        {claimed && <span className="home-quest-claimed-badge">Claimed</span>}
      </div>
    );
  };

  return (
    <div className="home-overlay-backdrop" ref={backdropRef} onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}>
      <div className="home-overlay home-quest-panel">
        <div className="home-panel-header">
          <h2 className="home-panel-title">Active Quests</h2>
          <button type="button" className="home-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="home-quest-section">
          <h3 className="home-quest-section-label">Weekly — resets Sunday</h3>
          {weekly.map(renderQuest)}
        </div>
        <div className="home-quest-section">
          <h3 className="home-quest-section-label">3-Day Rotation</h3>
          {triday.map(renderQuest)}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Row Slots ────────────────────────────────────────────────────────

function AchievementsSlot({
  profile,
  commanderInitial,
  commanderName,
  commanderRole,
  onClick,
}: {
  profile: PlayerProfile | null;
  commanderInitial: string;
  commanderName: string;
  commanderRole: string;
  onClick: () => void;
}) {
  const unlocked = profile ? profile.achievements.filter((a) => a.unlockedAt !== null).length : 0;
  const total = profile ? profile.achievements.length : 20;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <div className="home-avatar home-achievements-slot" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <CommanderSigil initial={commanderInitial} color={profile?.levelColor} />
      <div>
        <div className="home-avatar-name">{commanderName}</div>
        <div className="home-avatar-role">{commanderRole}</div>
      </div>
      <div className="home-avatar-progress">
        <span>Achievements</span>
        <div className="home-progress"><span style={{ width: `${pct}%` }} /></div>
        <span>{unlocked} / {total}</span>
      </div>
      <div className="home-slot-hint">Click to view</div>
    </div>
  );
}

function LevelTrackSlot({ profile }: { profile: PlayerProfile | null }) {
  if (!profile) {
    return (
      <div className="home-stat home-level-track">
        <div className="home-stat-label">Command Rank</div>
        <div className="home-level-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="home-stat home-level-track">
      <div className="home-stat-label">Command Rank</div>
      <div
        className="home-level-name"
        style={{ color: profile.levelColor }}
      >
        {profile.levelName}
      </div>
      <div className="home-level-badge-grid">
        {profile.levels.map((lvl) => {
          const isReached = profile.level >= lvl.level;
          const isCurrent = profile.level === lvl.level;
          return (
            <div
              key={lvl.level}
              className={`home-level-badge ${isReached ? 'is-reached' : ''} ${isCurrent ? 'is-current' : ''}`}
              style={isReached ? { '--badge-color': lvl.color } as React.CSSProperties : undefined}
              title={`Lv. ${lvl.level} ${lvl.name}`}
            >
              <span className="home-level-badge-num">{lvl.level}</span>
            </div>
          );
        })}
      </div>
      <div className="home-avatar-progress">
        <span>Lv. {profile.level}</span>
        <div className="home-progress">
          <span style={{ width: `${profile.levelProgress}%` }} />
        </div>
        <span>{profile.xpIntoLevel.toLocaleString()} / {profile.xpForNextLevel.toLocaleString()} XP</span>
      </div>
      {profile.nextLevelName && (
        <div className="home-level-next">→ {profile.nextLevelName}</div>
      )}
    </div>
  );
}

function QuestsSlot({ profile, onClick }: { profile: PlayerProfile | null; onClick: () => void }) {
  const claimable = profile ? profile.quests.filter((q) => q.completedAt !== null && q.claimedAt === null).length : 0;

  return (
    <div className="home-stat home-quests-slot" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="home-stat-label home-quests-label">
        Quests
        {claimable > 0 && <span className="home-quest-badge">{claimable}</span>}
      </div>
      {profile ? (
        <div className="home-quest-preview">
          {profile.quests.map((q) => {
            const pct = Math.min(100, Math.round((q.progress / q.target) * 100));
            const claimed = q.claimedAt !== null;
            const done = q.completedAt !== null;
            return (
              <div key={`${q.id}:${q.windowKey}`} className={`home-quest-preview-item ${done ? 'is-done' : ''}`}>
                <div className="home-quest-preview-title">
                  {q.title}
                  {done && !claimed && <span className="home-quest-dot" />}
                </div>
                <div className="home-progress home-quest-preview-bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="home-level-loading">Loading…</div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage({ account, onContinuePlaying }: HomePageProps) {
  const [section, setSection] = useState<'Home' | 'Games'>('Home');
  const [tab, setTab] = useState<'Overview' | 'Messages'>('Overview');
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState('');
  const [continuePage, setContinuePage] = useState(0);
  const [joinTarget, setJoinTarget] = useState<GameSummary | null>(null);
  const [joinError, setJoinError] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showQuests, setShowQuests] = useState(false);

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

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await getPlayerProfile());
    } catch {
      // profile is optional — fail silently
    }
  }, []);

  useEffect(() => {
    void loadGames();
    void loadProfile();
  }, [loadProfile]);

  const handleClaimQuest = async (quest: QuestInfo) => {
    await claimQuestReward(quest.id, quest.windowKey);
    await loadProfile();
  };

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

  const handleJoin = async (selectedCountryName: string, flagDesign: FlagDesign, speciesSetup: SpeciesSetup) => {
    if (!joinTarget || joinBusy) return;
    try {
      setJoinBusy(true);
      setJoinError('');
      const result = await joinGame(joinTarget.id, selectedCountryName, flagDesign, speciesSetup);
      setJoinTarget(null);
      setGames((current) => current.map((game) => (game.id === result.game.id ? result.game : game)));
      void loadProfile();
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
              className={`home-tab ${item === tab ? 'is-active' : ''}`}
              onClick={() => {
                if (item === 'News') { window.location.href = '/news'; return; }
                if (item === 'Messages') { setTab('Messages'); setSection('Home'); return; }
                if (item === 'Overview') { setTab('Overview'); setSection('Home'); return; }
              }}
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
        ) : tab === 'Messages' ? (
          <main className="home-messages-main">
            <MessagesPanel account={account} />
          </main>
        ) : (
          <main className="home-grid">
            <section className="home-card home-profile">
              <div className="home-card-heading">
                <h2 className="home-card-title">Command Overview</h2>
                <span className="home-card-kicker">Welcome back, {commanderName}</span>
              </div>
              <div className="home-profile-row">
                <AchievementsSlot
                  profile={profile}
                  commanderInitial={commanderInitial}
                  commanderName={commanderName}
                  commanderRole={commanderRole}
                  onClick={() => setShowAchievements(true)}
                />
                <LevelTrackSlot profile={profile} />
                <QuestsSlot profile={profile} onClick={() => setShowQuests(true)} />
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

      {showAchievements && profile && (
        <AchievementPanel
          achievements={profile.achievements}
          onClose={() => setShowAchievements(false)}
        />
      )}

      {showQuests && profile && (
        <QuestPanel
          quests={profile.quests}
          onClose={() => setShowQuests(false)}
          onClaim={handleClaimQuest}
        />
      )}
    </div>
  );
}
