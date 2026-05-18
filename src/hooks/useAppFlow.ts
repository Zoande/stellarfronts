import { useCallback, useEffect, useState } from 'react';
import { getCurrentSession, login as loginRequest, logout as logoutRequest, signup as signupRequest } from '@/auth/client';
import type { AuthAccount } from '@/auth/types';
import { preloadAuthAssets } from '@/utils/preloadAuthAssets';

export interface AuthState {
  isLoggedIn: boolean;
  account: AuthAccount | null;
  mode: 'login' | 'signup' | 'home';
}

export interface HomeTransitionState {
  isActive: boolean;
  isVisible: boolean;
  username: string;
  source: 'login' | 'signup';
  progress: number;
  detail: string;
}

export interface UseAppFlowResult {
  authLoadingProgress: number;
  authLoadingDetail: string;
  authBackgroundReady: boolean;
  authSessionReady: boolean;
  showAuthStartupLoading: boolean;
  auth: AuthState;
  homeTransition: HomeTransitionState;
  handleAuthBackgroundProgress: (progress: number, detail: string) => void;
  handleAuthBackgroundReady: () => void;
  handleAuthStartupLoadingHidden: () => void;
  handleLoginSubmit: (username: string, password: string) => Promise<void>;
  handleSignupClick: () => void;
  handleBackToLogin: () => void;
  handleSignupSubmit: (username: string, password: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleStartGameFromHome: () => void;
  homeTransitionTitle: string;
  handleHomeTransitionHidden: () => void;
}

const homeVisualAssets = [
  '/textures/galaxy_bg.webp',
  '/textures/planets/Methane/Methane_03-1024x512.webp',
  '/textures/planets/Snowy/Snowy_02-1024x512.webp',
  '/textures/planets/Gaseous/Gaseous_08-1024x512.webp',
  '/textures/planets/Arid/Arid_04-1024x512.webp',
  '/textures/planets/Tundra/Tundra_04-1024x512.webp',
  '/textures/planets/Methane/Methane_04-1024x512.webp',
  '/textures/planets/Martian/Martian_03-1024x512.webp',
  '/textures/planets/Gaseous/Gaseous_12-1024x512.webp',
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

export function useAppFlow(): UseAppFlowResult {
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

  const handleHomeTransitionHidden = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/home');
    }

    setAuth((prev) => ({
      ...prev,
      isLoggedIn: true,
      mode: 'home',
    }));

    setHomeTransition((prev) => ({
      ...prev,
      isActive: false,
    }));
  };

  const homeTransitionTitle = homeTransition.source === 'signup'
    ? 'Creating command profile'
    : 'Opening command center';

  return {
    authLoadingProgress,
    authLoadingDetail,
    authBackgroundReady,
    authSessionReady,
    showAuthStartupLoading,
    auth,
    homeTransition,
    handleAuthBackgroundProgress,
    handleAuthBackgroundReady,
    handleAuthStartupLoadingHidden,
    handleLoginSubmit,
    handleSignupClick,
    handleBackToLogin,
    handleSignupSubmit,
    handleLogout,
    handleStartGameFromHome,
    homeTransitionTitle,
    handleHomeTransitionHidden,
  };
}