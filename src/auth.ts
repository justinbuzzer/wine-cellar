import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";
import { config } from "./config";
import { clearSnapshots } from "./offline";

export const msal = new PublicClientApplication({
  auth: {
    clientId: config.clientId,
    authority: config.authority,
    redirectUri: config.redirectUri,
    postLogoutRedirectUri: config.redirectUri,
  },
  cache: {
    // Stay signed in across browser restarts on your own devices.
    cacheLocation: "localStorage",
  },
});

/** Initialise MSAL and finish a sign-in redirect if we're returning from one. */
export async function initAuth(): Promise<AccountInfo | null> {
  await msal.initialize();
  const result = await msal.handleRedirectPromise();
  if (result?.account) {
    msal.setActiveAccount(result.account);
  } else if (!msal.getActiveAccount()) {
    const accounts = msal.getAllAccounts();
    if (accounts.length > 0) msal.setActiveAccount(accounts[0]);
  }
  return msal.getActiveAccount();
}

export function signIn(): Promise<void> {
  return msal.loginRedirect({ scopes: [...config.scopes], prompt: "select_account" });
}

export async function signOut(): Promise<void> {
  await clearSnapshots(); // the offline copy of your data goes with you
  return msal.logoutRedirect({ account: msal.getActiveAccount() ?? undefined });
}

export class OfflineError extends Error {
  constructor() {
    super("You're offline. Changes need a connection; you can still browse your cellar and notes.");
  }
}

/** Get a Graph access token, silently if possible, otherwise via redirect. */
export async function getToken(): Promise<string> {
  const account = msal.getActiveAccount();
  if (!account) throw new Error("Not signed in");
  try {
    const res = await msal.acquireTokenSilent({ scopes: [...config.scopes], account });
    return res.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError || needsSignInAgain(err)) {
      // Never start a sign-in redirect without a connection: it would leave the app.
      // (Checked only here: some PCs report "offline" while connected, so the
      // flag alone never stops a real request.)
      if (navigator.onLine === false) throw new OfflineError();
      await msal.acquireTokenRedirect({ scopes: [...config.scopes], account });
      // The page navigates away; this promise never meaningfully resolves.
      return new Promise<string>(() => {});
    }
    throw err;
  }
}

/**
 * Sign-ins on a website last about 24 hours; after that MSAL tries a hidden
 * renewal, which browsers that block third-party cookies stop, so it times out.
 * That isn't a connection problem: a normal sign-in redirect fixes it (usually
 * an instant bounce, as you're still signed in to Microsoft).
 */
function needsSignInAgain(err: unknown): boolean {
  const code = (err as { errorCode?: string } | null)?.errorCode ?? "";
  return /^(timed_out|monitor_window_timeout|block_iframe_reload|silent_sso_error|no_tokens_found|refresh_token_expired)$/.test(code);
}

export function isAllowed(account: AccountInfo): boolean {
  const allowed: readonly string[] = config.allowedAccountIds;
  return allowed.length === 0 || allowed.includes(account.homeAccountId);
}
