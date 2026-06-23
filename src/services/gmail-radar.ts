import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "@/lib/firebase";

interface GmailOAuthUrlResponse {
  url: string;
}

interface GmailSyncResponse {
  scanned: number;
  created: number;
  skipped: number;
  paused?: boolean;
}

export async function createGmailOAuthUrl(): Promise<string> {
  const fn = httpsCallable<void, GmailOAuthUrlResponse>(
    getFirebaseFunctions(),
    "createGmailOAuthUrl"
  );
  const result = await fn();
  return result.data.url;
}

export async function finishGmailOAuth(params: {
  code: string;
  state: string;
}): Promise<{ email: string; sync?: GmailSyncResponse }> {
  const fn = httpsCallable<
    { code: string; state: string },
    { email: string; sync?: GmailSyncResponse }
  >(getFirebaseFunctions(), "finishGmailOAuth");
  const result = await fn(params);
  return result.data;
}

export async function syncGmailTransactions(): Promise<GmailSyncResponse> {
  const fn = httpsCallable<void, GmailSyncResponse>(
    getFirebaseFunctions(),
    "syncGmailTransactions"
  );
  const result = await fn();
  return result.data;
}

export async function disconnectGmailRadar(): Promise<void> {
  const fn = httpsCallable<void, { disconnected: boolean }>(
    getFirebaseFunctions(),
    "disconnectGmailRadar"
  );
  await fn();
}
