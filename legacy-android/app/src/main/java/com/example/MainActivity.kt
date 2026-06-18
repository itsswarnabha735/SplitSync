package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.auth.AuthViewModel
import com.example.ui.SplitSyncViewModel
import com.example.ui.screens.AddExpenseScreen
import com.example.ui.screens.AuthScreen
import com.example.ui.screens.CreateGroupScreen
import com.example.ui.screens.DashboardScreen
import com.example.ui.screens.GroupDetailScreen
import com.example.ui.theme.MyApplicationTheme
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings

class MainActivity : ComponentActivity() {

    private val authViewModel: AuthViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        FirebaseApp.initializeApp(this)
        configureFirestoreOfflineCache()
        enableEdgeToEdge()

        setContent {
            MyApplicationTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val currentUser by authViewModel.currentUser.collectAsState()
                    val user = currentUser
                    if (user == null) {
                        AuthScreen(viewModel = authViewModel)
                    } else {
                        // Rebuild the SplitSyncViewModel whenever uid changes so its
                        // repository is always pinned to the current user. The key in
                        // `viewModel(key = ...)` forces a fresh instance per uid.
                        val displayName = user.displayName
                            ?: user.email?.substringBefore("@")
                            ?: "Me"
                        val splitSyncViewModel: SplitSyncViewModel = viewModel(
                            key = "splitSyncVm:${user.uid}",
                            factory = remember(user.uid) {
                                SplitSyncViewModel.factory(user.uid, displayName)
                            }
                        )
                        MainNavHost(
                            viewModel = splitSyncViewModel,
                            userEmail = user.email.orEmpty(),
                            onSignOut = { authViewModel.signOut() }
                        )
                    }
                }
            }
        }
    }

    private fun configureFirestoreOfflineCache() {
        try {
            FirebaseFirestore.getInstance().firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setLocalCacheSettings(
                    PersistentCacheSettings.newBuilder().build()
                )
                .build()
        } catch (_: IllegalStateException) {
            // Settings can only be applied once before any Firestore access. Safe to ignore on hot reload.
        }
    }
}

@androidx.compose.runtime.Composable
private fun MainNavHost(
    viewModel: SplitSyncViewModel,
    userEmail: String,
    onSignOut: () -> Unit
) {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = "dashboard"
    ) {
        composable("dashboard") {
            DashboardScreen(
                viewModel = viewModel,
                userEmail = userEmail,
                onCreateGroupClick = { navController.navigate("create_group") },
                onGroupClick = { groupId -> navController.navigate("group_detail/$groupId") },
                onSignOut = onSignOut
            )
        }

        composable("create_group") {
            CreateGroupScreen(
                viewModel = viewModel,
                onBackClick = { navController.popBackStack() },
                onGroupCreated = { newGroupId ->
                    navController.navigate("group_detail/$newGroupId") {
                        popUpTo("dashboard")
                    }
                }
            )
        }

        composable(
            route = "group_detail/{groupId}",
            arguments = listOf(navArgument("groupId") { type = NavType.StringType })
        ) { backStackEntry ->
            val groupId = backStackEntry.arguments?.getString("groupId").orEmpty()
            GroupDetailScreen(
                viewModel = viewModel,
                groupId = groupId,
                onBackClick = { navController.popBackStack() },
                onAddExpenseClick = { navController.navigate("add_expense/$groupId") }
            )
        }

        composable(
            route = "add_expense/{groupId}",
            arguments = listOf(navArgument("groupId") { type = NavType.StringType })
        ) {
            AddExpenseScreen(
                viewModel = viewModel,
                onBackClick = { navController.popBackStack() },
                onExpenseAdded = { navController.popBackStack() }
            )
        }
    }
}
