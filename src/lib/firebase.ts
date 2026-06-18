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

function createApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export const firebaseApp = createApp();

/**
 * Firestore is initialized with a persistent local cache (the web equivalent of
 * the Android app's `PersistentCacheSettings`), giving offline support and
 * snappy reads.
 */
function createFirestore(): Firestore {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache(),
    });
  } catch {
    // initializeFirestore throws if called twice (e.g. fast refresh). Fall back.
    const { getFirestore } = require("firebase/firestore");
    return getFirestore(firebaseApp);
  }
}

export const db: Firestore = createFirestore();
export const auth: Auth = getAuth(firebaseApp);

// Wire up local emulators when explicitly enabled for development.
let emulatorsConnected = false;
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
  !emulatorsConnected
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
