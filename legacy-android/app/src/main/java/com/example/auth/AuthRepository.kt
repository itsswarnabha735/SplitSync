package com.example.auth

import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class AuthRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {
    val currentUser: FirebaseUser? get() = auth.currentUser

    /**
     * Hot flow of the current authenticated user (or null when signed out).
     * Emits immediately on collection with the current value, and on every auth state change.
     */
    val currentUserFlow: Flow<FirebaseUser?> = callbackFlow {
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    suspend fun signInWithGoogle(account: GoogleSignInAccount): AuthResult {
        val credential = GoogleAuthProvider.getCredential(account.idToken, null)
        val result = auth.signInWithCredential(credential).await()
        result.user?.let { upsertUserDoc(it) }
        return result
    }

    suspend fun signInWithEmail(email: String, password: String): AuthResult {
        val result = auth.signInWithEmailAndPassword(email.trim(), password).await()
        result.user?.let { upsertUserDoc(it) }
        return result
    }

    suspend fun signUpWithEmail(displayName: String, email: String, password: String): AuthResult {
        val result = auth.createUserWithEmailAndPassword(email.trim(), password).await()
        result.user?.let { user ->
            // Persist display name on the FirebaseUser profile then mirror to Firestore
            val update = com.google.firebase.auth.UserProfileChangeRequest.Builder()
                .setDisplayName(displayName.trim())
                .build()
            user.updateProfile(update).await()
            upsertUserDoc(user, overrideDisplayName = displayName.trim())
        }
        return result
    }

    fun signOut() {
        auth.signOut()
    }

    /**
     * Idempotent upsert of the public /users/{uid} doc. Used so that other members
     * can look this user up by email when inviting them to a group.
     */
    private suspend fun upsertUserDoc(user: FirebaseUser, overrideDisplayName: String? = null) {
        val data = mapOf(
            "uid" to user.uid,
            "displayName" to (overrideDisplayName ?: user.displayName ?: user.email?.substringBefore("@") ?: "Anonymous"),
            "email" to (user.email ?: ""),
            "photoUrl" to (user.photoUrl?.toString() ?: ""),
            "updatedAt" to System.currentTimeMillis()
        )
        firestore.collection("users")
            .document(user.uid)
            .set(data, SetOptions.merge())
            .await()
    }
}
