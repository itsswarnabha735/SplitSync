import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
  type UserCredential,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase";

/**
 * Auth service ported from the Android `AuthRepository`. Every successful sign
 * in/up mirrors a public `/users/{uid}` profile doc so other members can look
 * the user up by email when inviting them to a group.
 */

const googleProvider = new GoogleAuthProvider();

export async function signInWithEmail(
  email: string,
  password: string
): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  await upsertUserDoc(result.user);
  return result;
}

export async function signUpWithEmail(
  displayName: string,
  email: string,
  password: string
): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  const result = await createUserWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
  await updateProfile(result.user, { displayName: displayName.trim() });
  await upsertUserDoc(result.user, displayName.trim());
  return result;
}

export async function signInWithGoogle(): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  const result = await signInWithPopup(auth, googleProvider);
  await upsertUserDoc(result.user);
  return result;
}

export function signOut(): Promise<void> {
  return fbSignOut(getFirebaseAuth());
}

export async function sendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Idempotent upsert of the public `/users/{uid}` document. `email` is stored
 * lowercased so the invite-by-email lookup (`where("email", "==", ...)`) works.
 */
export async function upsertUserDoc(
  user: User,
  overrideDisplayName?: string
): Promise<void> {
  const db = getFirestoreDb();
  const fallbackName =
    user.displayName ?? user.email?.split("@")[0] ?? "Anonymous";
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      displayName: overrideDisplayName ?? fallbackName,
      email: (user.email ?? "").toLowerCase(),
      photoUrl: user.photoURL ?? "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function friendlyAuthError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists with that email.";
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return err instanceof Error ? err.message : "Authentication failed.";
  }
}
