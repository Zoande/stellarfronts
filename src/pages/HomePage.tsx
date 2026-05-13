import { useMemo } from 'react';
import { buildFactions } from '@/data/Factions';
import { GALAXY_MAP } from '@/data/GalaxyMap';
import { generateStarMap } from '@/data/StarMap';
import type { AuthAccount } from '@/auth/types';
import lobbyBackdrop from '../../backgroudn lobby.png';
import stellarLogo from '../../logosteller.png';
import '../styles/Home.css';

interface HomePageProps {
  account: AuthAccount;
  onContinuePlaying: () => void;
}

interface ProgressStat {
  label: string;
  value: string;
  meta: string;
  progress: number;
  variant: 'rank' | 'contract';
}

const navigationItems = ['Home', 'Fleet', 'Ranking', 'Alliance', 'Shop'];
const tabItems = ['Overview', 'News', 'Messages'];

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
    image: '/textures/planets/Methane/Methane_04-1024x512.png',
  },
  {
    header: 'Scenario Rotation',
    name: 'Outer Rim Siege',
    meta: 'Available until 02:13:34:58',
    image: '/textures/planets/Martian/Martian_03-1024x512.png',
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

export default function HomePage({ account, onContinuePlaying }: HomePageProps) {
  const factions = useMemo(() => {
    const cfg = GALAXY_MAP;
    const initialStars = generateStarMap(
      cfg.width,
      cfg.height,
      cfg.starCount,
      cfg.seed,
      cfg.minStarSpacing,
      cfg.shape,
    );
    return buildFactions(initialStars, cfg).slice(0, 8);
  }, []);

  const commanderName = account.username.trim() || 'Commander';
  const commanderInitial = commanderName.charAt(0).toUpperCase();
  const primaryFaction = account.accountType === 'seeded-faction' && account.factionId !== null
    ? factions.find((faction) => faction.id === account.factionId) ?? factions[0]
    : null;
  const commanderRole = account.accountType === 'seeded-faction' ? primaryFaction?.name ?? 'Faction Commander' : 'Observer';
  const commanderNote = account.accountType === 'seeded-faction'
    ? `${primaryFaction?.name ?? 'Faction'} account is synced.`
    : 'Observer account is synced.';

  return (
    <div
      className="home-page"
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(2, 7, 18, 0.18), rgba(1, 3, 9, 0.82)), url(${lobbyBackdrop})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center center',
        backgroundRepeat: 'no-repeat',
      }}
    >
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

      <div
        className="home-brand-strip"
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '6px 2px 10px',
        }}
      >
        <img
          src={stellarLogo}
          alt="StellarFronts"
          style={{
            width: 'min(300px, 42vw)',
            height: 'auto',
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 18px rgba(124, 207, 255, 0.28))',
          }}
        />
      </div>

      <div className="home-shell">
        <header className="home-top-nav" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <button
              key={item}
              type="button"
              className={`home-top-link ${item === 'Home' ? 'is-active' : ''}`}
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
                  <div className="home-progress">
                    <span style={{ width: '37%' }} />
                  </div>
                  <span>10,746 / 11,500</span>
                </div>
              </div>

              {progressStats.map((stat) => (
                <div className="home-stat" key={stat.label}>
                  <MedalIcon variant={stat.variant} />
                  <div className="home-stat-label">{stat.label}</div>
                  <div className="home-stat-value">{stat.value}</div>
                  <div className="home-progress">
                    <span style={{ width: `${stat.progress}%` }} />
                  </div>
                  <div className="home-progress-meta">{stat.meta}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="home-card home-action">
            <div className="home-action-frame">
              <div className="home-ship-holo" aria-hidden="true">
                <span />
              </div>
              <h2 className="home-action-title">Ready For A New Operation?</h2>
              <p className="home-action-subtitle">
                {commanderNote}
              </p>
              <button type="button" className="home-launch-btn" onClick={onContinuePlaying}>
                Continue Playing
              </button>
            </div>
          </section>

          <section className="home-card home-continue">
            <div className="home-card-heading">
              <h2 className="home-card-title">Continue Playing</h2>
              <span className="home-card-kicker">Last saved 18 minutes ago</span>
            </div>

            <div className="home-server-row">
              <div className="home-server-art" aria-hidden="true">
                <img src="/textures/planets/Gaseous/Gaseous_12-1024x512.png" alt="" />
              </div>
              <div className="home-server-copy">
                <div className="home-server-name">EU-Cygnus Prime</div>
                <div className="home-server-meta">{account.accountType === 'seeded-faction' ? 'Faction-bound account online' : 'Observer account online'}</div>
                <div className="home-route-strip" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <button type="button" className="home-secondary-btn" onClick={onContinuePlaying}>
                Continue
              </button>
            </div>

            <div className="home-intel-row">
              <div>
                <span className="home-intel-label">Current Sector</span>
                <strong>Kepler Veil</strong>
              </div>
              <div>
                <span className="home-intel-label">Fleet Status</span>
                <strong>3 wings ready</strong>
              </div>
              <div>
                <span className="home-intel-label">Threat</span>
                <strong>Elevated</strong>
              </div>
            </div>
          </section>

          <section className="home-card home-events">
            <h2 className="home-card-title">Events</h2>
            <div className="home-event-grid">
              {eventCards.map((event) => (
                <article className="home-event" key={event.name}>
                  <div className="home-event-image">
                    <img src={event.image} alt="" />
                  </div>
                  <div className="home-event-header">{event.header}</div>
                  <div className="home-event-name">{event.name}</div>
                  <div className="home-event-meta">{event.meta}</div>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
