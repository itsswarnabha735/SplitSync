import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REQUIRED_CONFIG_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

const CONFIG_ENTRIES = [
  {
    key: "NEXT_PUBLIC_FIREBASE_API_KEY",
    value: firebaseConfig.apiKey,
  },
  {
    key: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    value: firebaseConfig.authDomain,
  },
  {
    key: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    value: firebaseConfig.projectId,
  },
  {
    key: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    value: firebaseConfig.storageBucket,
  },
  {
    key: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    value: firebaseConfig.messagingSenderId,
  },
  {
    key: "NEXT_PUBLIC_FIREBASE_APP_ID",
    value: firebaseConfig.appId,
  },
] as const;

export interface FirebaseConfigError {
  title: string;
  message: string;
  keys: string[];
}

function invalidConfigKeys(): string[] {
  return CONFIG_ENTRIES.filter(({ value }) => {
    const trimmed = value?.trim();
    return (
      !trimmed ||
      trimmed.startsWith("your-") ||
      trimmed.includes("your-project") ||
      trimmed.includes("000000000000")
    );
  }).map(({ key }) => key);
}

function createApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

/**
 * Firestore is initialized with a persistent local cache (the web equivalent of
 * the Android app's `PersistentCacheSettings`), giving offline support and
 * snappy reads.
 */
function createFirestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache(),
    });
  } catch {
    // initializeFirestore throws if called twice (e.g. fast refresh). Fall back.
    const { getFirestore } = require("firebase/firestore");
    return getFirestore(app);
  }
}

let configError: FirebaseConfigError | null = null;
let firebaseApp: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

const badKeys = invalidConfigKeys();
if (badKeys.length > 0) {
  configError = {
    title: "Firebase setup required",
    message:
      "SplitSync cannot start because the Firebase web configuration is missing or still contains placeholder values.",
    keys: badKeys,
  };
} else {
  try {
    firebaseApp = createApp();
    db = createFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
  } catch (err) {
    configError = {
      title: "Firebase setup failed",
      message:
        err instanceof Error
          ? err.message
          : "Firebase could not initialize with the supplied configuration.",
      keys: [...REQUIRED_CONFIG_KEYS],
    };
  }
}

// Wire up local emulators when explicitly enabled for development.
let emulatorsConnected = false;
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
  !emulatorsConnected &&
  auth &&
  db
) {
  emulatorsConnected = true;
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  } catch {
    // Already connected on a previous hot-reload; safe to ignore.
  }
}

export const firebaseConfigError = configError;

export function getFirebaseAuth(): Auth {
  if (!auth) {
    throw new Error(configError?.message ?? "Firebase Auth is unavailable.");
  }
  return auth;
}

export function getFirebaseApp(): FirebaseApp {
  if (!firebaseApp) {
    throw new Error(configError?.message ?? "Firebase app is unavailable.");
  }
  return firebaseApp;
}

export function getFirestoreDb(): Firestore {
  if (!db) {
    throw new Error(configError?.message ?? "Firestore is unavailable.");
  }
  return db;
}
