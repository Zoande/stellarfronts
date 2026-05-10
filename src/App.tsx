import { BrowserRouter as Router } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import GamePage from './pages/GamePage';
import HomePage from './pages/HomePage';
import { LoadingScreen } from './components/LoadingScreen';
import BackgroundScene from './components/BackgroundScene';
import { preloadAuthAssets } from './utils/preloadAuthAssets';
import { getCurrentSession, login as loginRequest, logout as logoutRequest, signup as signupRequest } from './auth/client';
import type { AuthAccount } from './auth/types';

export interface AuthState {
  isLoggedIn: boolean;
  account: AuthAccount | null;
  mode: 'login' | 'signup' | 'home';
}

interface HomeTransitionState {
  isActive: boolean;
  isVisible: boolean;
  username: string;
  source: 'login' | 'signup' | 'verify' | 'success';
  progress: number;
  detail: string;
}

const homeVisualAssets = [
  '/textures/galaxy_bg.png',
  '/textures/planets/Methane/Methane_03-1024x512.png',
  '/textures/planets/Snowy/Snowy_02-1024x512.png',
  '/textures/planets/Gaseous/Gaseous_08-1024x512.png',
  '/textures/planets/Arid/Arid_04-1024x512.png',
  '/textures/planets/Tundra/Tundra_04-1024x512.png',
  '/textures/planets/Methane/Methane_04-1024x512.png',
  '/textures/planets/Martian/Martian_03-1024x512.png',
  '/textures/planets/Gaseous/Gaseous_12-1024x512.png',
];

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

function preloadHomeVisualAssets(): Promise<void> {
  return Promise.all(homeVisualAssets.map((src) => preloadImage(src))).then(() => undefined);
}

function getAuthLoadingDetail(detail: string): string {
  if (detail.includes('starbase')) return 'Assembling orbital backdrop';
  if (detail.includes('fighter')) return 'Warming hangar lighting';
  if (detail.includes('planet')) return 'Decoding planetary textures';
  if (detail.includes('star glow') || detail.includes('surface')) return 'Decoding stellar textures';
  if (detail.includes('cameras') || detail.includes('lighting')) return 'Calibrating cameras and lighting';
  if (detail.includes('background scene')) return 'Creating login backdrop';
  if (detail.includes('ready')) return 'Login station is ready';
  if (detail.includes('auth assets')) return 'Preparing login assets';
  return detail;
}

function App() {
  const [authLoadingProgress, setAuthLoadingProgress] = useState(0);
  const [authAssetProgress, setAuthAssetProgress] = useState(0);
  const [authSceneProgress, setAuthSceneProgress] = useState(0);
  const [authLoadingDetail, setAuthLoadingDetail] = useState('Preparing login assets');
  const [authBackgroundReady, setAuthBackgroundReady] = useState(false);
  const [authSessionReady, setAuthSessionReady] = useState(false);
  const [showAuthStartupLoading, setShowAuthStartupLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState>({
    isLoggedIn: false,
    account: null,
    mode: 'login',
  });
  const [homeTransition, setHomeTransition] = useState<HomeTransitionState>({
    isActive: false,
    isVisible: false,
    username: '',
    source: 'login',
    progress: 0,
    detail: 'Confirming command credentials',
  });

  useEffect(() => {
    let cancelled = false;

    void preloadAuthAssets((state) => {
      if (cancelled) return;
      setAuthAssetProgress(state.progress);
      setAuthLoadingDetail(getAuthLoadingDetail(state.detail));
    }).then(() => {
      if (cancelled) return;
      setAuthAssetProgress(1);
      setAuthLoadingDetail('Login assets are ready');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void getCurrentSession()
      .then((account) => {
        if (cancelled || !account) return;
        setAuth({
          isLoggedIn: true,
          account,
          mode: 'home',
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAuthSessionReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authBackgroundReady) {
      setAuthLoadingProgress(100);
      return;
    }

    const weightedProgress = (authAssetProgress * 0.35 + authSceneProgress * 0.65) * 100;
    setAuthLoadingProgress(Math.min(98, weightedProgress));
  }, [authAssetProgress, authBackgroundReady, authSceneProgress]);

  const handleAuthBackgroundProgress = useCallback((progress: number, detail: string) => {
    setAuthSceneProgress(progress);
    setAuthLoadingDetail(getAuthLoadingDetail(detail));
  }, []);

  const handleAuthBackgroundReady = useCallback(() => {
    setAuthBackgroundReady(true);
    setAuthSceneProgress(1);
    setAuthLoadingProgress(100);
    setAuthLoadingDetail('Login station is ready');
  }, []);

  const handleAuthStartupLoadingHidden = useCallback(() => {
    setShowAuthStartupLoading(false);
  }, []);

  useEffect(() => {
    if (!homeTransition.isActive) return;
    let cancelled = false;

    const transitionSteps = [
      { delay: 120, progress: 24, detail: 'Confirming command credentials' },
      { delay: 420, progress: 52, detail: 'Syncing commander profile' },
      { delay: 760, progress: 82, detail: 'Loading home command visuals' },
    ];

    const timers = transitionSteps.map((step) => window.setTimeout(() => {
      if (cancelled) return;
      setHomeTransition((prev) => ({
        ...prev,
        progress: step.progress,
        detail: step.detail,
      }));
    }, step.delay));

    timers.push(window.setTimeout(() => {
      void preloadHomeVisualAssets().then(() => {
        if (cancelled) return;

        setHomeTransition((prev) => ({
          ...prev,
          detail: 'Opening command center',
          progress: 100,
        }));

        window.setTimeout(() => {
          if (cancelled) return;
          setHomeTransition((prev) => ({
            ...prev,
            isVisible: false,
          }));
        }, 500);
      });
    }, 960));

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [homeTransition.isActive, homeTransition.username]);

  const startHomeTransition = (
    username: string,
    source: HomeTransitionState['source'],
    initialDetail = 'Confirming command credentials',
  ) => {
    setHomeTransition({
      isActive: true,
      isVisible: true,
      username,
      source,
      progress: 8,
      detail: initialDetail,
    });
  };

  const handleLoginSubmit = async (username: string, password: string) => {
    const account = await loginRequest({ username, password });
    startHomeTransition(account.username, 'login', 'Login accepted');
    setAuth({
      isLoggedIn: true,
      account,
      mode: 'home',
    });
  };

  const handleSignupClick = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'signup',
    }));
  };

  const handleBackToLogin = () => {
    setAuth((prev) => ({
      ...prev,
      mode: 'login',
    }));
  };

  const handleSignupSubmit = async (username: string, password: string) => {
    const account = await signupRequest({ username, password });
    startHomeTransition(account.username, 'signup', 'Account created');
    setAuth({
      isLoggedIn: true,
      account,
      mode: 'home',
    });
  };

  const handleLogout = async () => {
    try {
      await logoutRequest();
    } catch {
      // Clear local auth state even if the auth server is unavailable.
    }

    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }

    setAuth({
      isLoggedIn: false,
      account: null,
      mode: 'login',
    });
    setHomeTransition({
      isActive: false,
      isVisible: false,
      username: '',
      source: 'login',
      progress: 0,
      detail: 'Confirming command credentials',
    });
  };

  const handleStartGameFromHome = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/game');
    }
    setAuth((prev) => ({
      ...prev,
      mode: 'home',
    }));
  };

  const isGameRoute = typeof window !== 'undefined' && window.location.pathname === '/game';
  const homeTransitionTitle = homeTransition.source === 'signup'
    ? 'Creating command profile'
    : 'Opening command center';

  const handleHomeTransitionHidden = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/home');
    }

    setAuth({
      isLoggedIn: true,
      account: auth.account,
      mode: 'home',
    });

    setHomeTransition((prev) => ({
      ...prev,
      isActive: false,
    }));
  };

  const authScreen = auth.mode === 'signup'
    ? (
      <SignupPage
        onSignupSubmit={handleSignupSubmit}
        onBackToLogin={handleBackToLogin}
      />
    )
    : (
      <LoginPage
        onLoginSubmit={handleLoginSubmit}
        onSignupClick={handleSignupClick}
      />
    );

  if (isGameRoute && auth.isLoggedIn && auth.account) {
    return (
      <Router>
        <GamePage username={auth.account.username} onLogout={handleLogout} />
      </Router>
    );
  }

  if (homeTransition.isActive) {
    const shouldRenderHomeBehindLoader = homeTransition.progress >= 82;

    return (
      <Router>
        {shouldRenderHomeBehindLoader && (
          <HomePage
            account={auth.account ?? {
              id: 0,
              username: homeTransition.username,
              accountType: 'observer',
              factionId: null,
              createdAt: 0,
              updatedAt: 0,
            }}
            onContinuePlaying={handleStartGameFromHome}
          />
        )}
        <LoadingScreen
          theme="auth"
          subtitle="Command Link"
          title={homeTransitionTitle}
          progress={homeTransition.progress}
          detail={homeTransition.detail}
          isVisible={homeTransition.isVisible}
          onHidden={handleHomeTransitionHidden}
          zIndex={240}
        />
      </Router>
    );
  }

  if (auth.isLoggedIn && auth.mode === 'home') {
    return (
      <Router>
        <HomePage
          account={auth.account ?? { id: 0, username: '', accountType: 'observer', factionId: null, createdAt: 0, updatedAt: 0 }}
          onContinuePlaying={handleStartGameFromHome}
        />
      </Router>
    );
  }

  return (
    <Router>
      <div className="auth-container">
        <BackgroundScene
          onLoadProgress={handleAuthBackgroundProgress}
          onReady={handleAuthBackgroundReady}
        />

        {showAuthStartupLoading && (
          <LoadingScreen
            theme="auth"
            subtitle="Login Station"
            title="StellarFronts Login"
            progress={authLoadingProgress}
            detail={authLoadingDetail}
            isVisible={!(authBackgroundReady && authSessionReady)}
            onHidden={handleAuthStartupLoadingHidden}
            zIndex={220}
          />
        )}

        {authBackgroundReady && authScreen}
      </div>
    </Router>
  );
}

export default App;
