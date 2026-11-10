import type { AuthSession, Language, Me } from '@xatu/shared';
import { create } from 'zustand';
import { identifyUser, resetAnalytics } from '../lib/analytics';
import { setLanguage } from '../lib/i18n';
import { setSentryUser } from '../lib/sentry';
import { readSecure, writeSecure } from '../lib/secure';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  user: Me | null;
  accessToken: string | null;
  accessTokenExpiresAt: number;
  language: Language;
  /** True once the person picked a language on the welcome screen (or a saved one exists). */
  languageChosen: boolean;

  restore: () => Promise<void>;
  signIn: (session: AuthSession) => Promise<void>;
  updateTokens: (session: AuthSession) => Promise<void>;
  signOut: () => Promise<void>;
  chooseLanguage: (language: Language) => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  accessTokenExpiresAt: 0,
  language: 'ta',
  languageChosen: false,

  /** On app start: show the cached user straight away; the API client refreshes tokens on demand. */
  restore: async () => {
    const [refreshToken, userJson, language] = await Promise.all([
      readSecure('refreshToken'),
      readSecure('user'),
      readSecure('language'),
    ]);
    if (language === 'ta' || language === 'en') {
      setLanguage(language);
      set({ language, languageChosen: true });
    }
    let user: Me | null;
    try {
      user = userJson ? (JSON.parse(userJson) as Me) : null;
    } catch {
      user = null;
    }
    if (refreshToken && user) setSentryUser(user.id);
    set({ status: refreshToken && user ? 'signedIn' : 'signedOut', user });
  },

  signIn: async (session) => {
    identifyUser(session.user.id, session.user.language);
    setSentryUser(session.user.id);
    await writeSecure('refreshToken', session.refreshToken);
    await writeSecure('user', JSON.stringify(session.user));
    set({
      status: 'signedIn',
      user: session.user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: Date.parse(session.accessTokenExpiresAt),
    });
  },

  updateTokens: async (session) => {
    await writeSecure('refreshToken', session.refreshToken);
    await writeSecure('user', JSON.stringify(session.user));
    set({
      user: session.user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: Date.parse(session.accessTokenExpiresAt),
    });
  },

  signOut: async () => {
    resetAnalytics();
    setSentryUser(null);
    await writeSecure('refreshToken', null);
    await writeSecure('user', null);
    set({ status: 'signedOut', user: null, accessToken: null, accessTokenExpiresAt: 0 });
  },

  chooseLanguage: async (language) => {
    setLanguage(language);
    set({ language, languageChosen: true });
    await writeSecure('language', language);
  },
}));
