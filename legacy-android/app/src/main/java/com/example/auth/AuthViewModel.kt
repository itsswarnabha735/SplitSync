package com.example.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.auth.api.signin.GoogleSignInAccount
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AuthViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = AuthRepository()

    val currentUser: StateFlow<FirebaseUser?> = repository.currentUserFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, repository.currentUser)

    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    fun clearError() { _error.value = null }

    fun signInWithGoogle(account: GoogleSignInAccount) {
        viewModelScope.launch {
            _isWorking.value = true
            try {
                repository.signInWithGoogle(account)
                _error.value = null
            } catch (t: Throwable) {
                _error.value = t.message ?: "Google sign-in failed."
            } finally {
                _isWorking.value = false
            }
        }
    }

    fun signInWithEmail(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _error.value = "Email and password are required."
            return
        }
        viewModelScope.launch {
            _isWorking.value = true
            try {
                repository.signInWithEmail(email, password)
                _error.value = null
            } catch (t: Throwable) {
                _error.value = t.message ?: "Sign-in failed."
            } finally {
                _isWorking.value = false
            }
        }
    }

    fun signUpWithEmail(displayName: String, email: String, password: String) {
        if (displayName.isBlank() || email.isBlank() || password.length < 6) {
            _error.value = "Name, email, and a 6+ character password are required."
            return
        }
        viewModelScope.launch {
            _isWorking.value = true
            try {
                repository.signUpWithEmail(displayName, email, password)
                _error.value = null
            } catch (t: Throwable) {
                _error.value = t.message ?: "Sign-up failed."
            } finally {
                _isWorking.value = false
            }
        }
    }

    fun signOut() {
        repository.signOut()
    }
}
