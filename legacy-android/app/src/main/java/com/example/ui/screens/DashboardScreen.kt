package com.example.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.Group
import com.example.data.model.Friend
import com.example.data.model.AdHocExpense
import com.example.data.model.AdHocSplit
import com.example.data.model.AdHocPayment
import com.example.data.model.FriendWithBalance
import com.example.data.model.GroupInvite
import com.example.data.model.YOU_ID
import com.example.ui.SplitSyncViewModel
import android.app.DatePickerDialog
import androidx.compose.ui.platform.LocalContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: SplitSyncViewModel,
    userEmail: String = "",
    onCreateGroupClick: () -> Unit,
    onGroupClick: (String) -> Unit,
    onSignOut: () -> Unit = {}
) {
    val groups by viewModel.allGroups.collectAsState()
    val isSyncing by viewModel.isSyncing.collectAsState()
    val pendingInvites by viewModel.pendingInvites.collectAsState()

    // P2P/Ad-Hoc states collected from Firestore-backed view-model flows
    val friendsList by viewModel.allFriendsWithBalances.collectAsState()
    val adhocExpensesList by viewModel.adHocExpenses.collectAsState()
    val adhocPaymentsList by viewModel.adHocPayments.collectAsState()
    val adhocSplitsList by viewModel.allAdHocSplits.collectAsState()

    // Dynamic combined balance aggregates
    val youAreOwedTotal by viewModel.youAreOwedTotal.collectAsState()
    val youOweTotal by viewModel.youOweTotal.collectAsState()
    val netBalanceTotal by viewModel.netBalanceTotal.collectAsState()

    var currentTab by remember { mutableStateOf(0) } // 0 = Groups, 1 = Friends (Ad-Hoc), 2 = Information/Settings

    // Dialog trigger states
    var showDeleteDialog by remember { mutableStateOf<Group?>(null) }
    var showContextSelector by remember { mutableStateOf(false) }
    var showGroupSelectForExpense by remember { mutableStateOf(false) }
    var showAddFriendDialog by remember { mutableStateOf(false) }
    var showAddAdHocExpenseDialog by remember { mutableStateOf(false) }
    var activeFriendDetail by remember { mutableStateOf<List<FriendWithBalance>?>(null) }
    var showAdHocSettleDialog by remember { mutableStateOf<FriendWithBalance?>(null) }

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 8.dp
            ) {
                NavigationBarItem(
                    selected = currentTab == 0,
                    onClick = { currentTab = 0 },
                    icon = { Icon(Icons.Default.Groups, contentDescription = "Groups") },
                    label = { Text("Groups", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                )
                NavigationBarItem(
                    selected = currentTab == 1,
                    onClick = { currentTab = 1 },
                    icon = { Icon(Icons.Default.Person, contentDescription = "Friends") },
                    label = { Text("Friends (P2P)", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                )
                NavigationBarItem(
                    selected = currentTab == 2,
                    onClick = { currentTab = 2 },
                    icon = { Icon(Icons.Default.Settings, contentDescription = "Settings") },
                    label = { Text("Help & Sync", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showContextSelector = true },
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier
                    .navigationBarsPadding()
                    .testTag("create_group_fab") // Keep tag matching template expectation for testing triggers
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "New Entry",
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Text("Add Entry", fontWeight = FontWeight.Bold)
                }
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            // Live Synchronizing progress indicator
            AnimatedVisibility(
                visible = isSyncing,
                enter = fadeIn(),
                exit = fadeOut()
            ) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // Custom Status Bar & Top App Bar (Vibrant Palette style)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = "SPLITSYNC",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.primary,
                            letterSpacing = 2.5.sp
                        )
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(Color(0xFF81C784), shape = CircleShape)
                        )
                    }
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = when (currentTab) {
                            0 -> "Ledger Overview"
                            1 -> "P2P Friends"
                            else -> "Sync & Help"
                        },
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground,
                        letterSpacing = (-0.5).sp
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Manual sync icon button
                    IconButton(
                        onClick = { viewModel.triggerManualSync() },
                        modifier = Modifier
                            .testTag("sync_button")
                            .background(
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                shape = CircleShape
                            )
                            .size(38.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Sync Balances",
                            tint = if (isSyncing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(18.dp)
                        )
                    }

                    // User initial avatar badge
                    val avatarGradient = Brush.linearGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primaryContainer,
                            MaterialTheme.colorScheme.secondaryContainer
                        )
                    )
                    val initial = (userEmail.firstOrNull()?.uppercase() ?: "S")
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .background(
                                brush = avatarGradient,
                                shape = CircleShape
                            )
                            .clip(CircleShape)
                            .clickable { onSignOut() }
                            .testTag("sign_out_avatar"),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = initial,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            // Pending group invites (multi-user sharing): tap Accept to join.
            if (pendingInvites.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    pendingInvites.forEach { invite ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("invite_card_${invite.id}"),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Group invite",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Black,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        letterSpacing = 1.sp
                                    )
                                    Text(
                                        text = "${invite.invitedByName} invited you to '${invite.groupName}'",
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    TextButton(
                                        onClick = { viewModel.declineInvite(invite) },
                                        modifier = Modifier.testTag("invite_decline_${invite.id}")
                                    ) {
                                        Text("Decline")
                                    }
                                    Button(
                                        onClick = { viewModel.acceptInvite(invite, userEmail) },
                                        modifier = Modifier.testTag("invite_accept_${invite.id}")
                                    ) {
                                        Text("Accept", fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Summary Card (Material You responsive dynamic balance)
            val premiumCardGradient = Brush.linearGradient(
                colors = listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                    MaterialTheme.colorScheme.secondary.copy(alpha = 0.75f)
                )
            )

            val currenciesList = (netBalanceTotal.keys + youAreOwedTotal.keys + youOweTotal.keys).distinct().ifEmpty { listOf("USD") }
            val pagerState = rememberPagerState(pageCount = { currenciesList.size })

            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = if (currenciesList.size > 1) 32.dp else 16.dp),
                pageSpacing = 16.dp
            ) { page ->
                val currency = currenciesList[page]
                val currentNetBalance = netBalanceTotal[currency] ?: 0.0
                val currentYouOwe = youOweTotal[currency] ?: 0.0
                val currentYouAreOwed = youAreOwedTotal[currency] ?: 0.0
                val cSymbol = when (currency) {
                    "USD" -> "$"
                    "EUR" -> "€"
                    "GBP" -> "£"
                    "INR" -> "₹"
                    "JPY" -> "¥"
                    "CAD" -> "C$"
                    "AUD" -> "A$"
                    else -> "$"
                }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(28.dp))
                        .background(premiumCardGradient)
                        .padding(24.dp)
                ) {
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Top
                        ) {
                            Column {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.AccountBalanceWallet,
                                        contentDescription = null,
                                        tint = Color.White.copy(alpha = 0.8f),
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Text(
                                        text = "NET SPLIT BALANCE ($currency)",
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color.White.copy(alpha = 0.8f),
                                        letterSpacing = 1.5.sp
                                    )
                                }
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "$cSymbol${String.format("%.2f", if (currentNetBalance < 0) -currentNetBalance else currentNetBalance)}",
                                    fontSize = 38.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White,
                                    letterSpacing = (-0.5).sp
                                )
                            }
                            Box(
                                modifier = Modifier
                                    .background(
                                        color = if (currentNetBalance >= 0) Color.White.copy(alpha = 0.25f) else Color(0x33FFCDD2),
                                        shape = RoundedCornerShape(100.dp)
                                    )
                                    .padding(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .background(
                                                color = if (currentNetBalance >= 0) Color(0xFF81C784) else Color(0xFFE57373),
                                                shape = CircleShape
                                            )
                                    )
                                    Text(
                                        text = if (currentNetBalance >= 0) "YOU ARE OWED" else "YOU OWE NET",
                                        color = Color.White,
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        letterSpacing = 0.5.sp
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(20.dp))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            // Owe card (frosted glass indicator)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(18.dp))
                                    .background(Color.White.copy(alpha = 0.12f))
                                    .padding(12.dp)
                            ) {
                                Column {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.TrendingDown,
                                            contentDescription = null,
                                            tint = Color(0xFFFFCDD2),
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Text(
                                            text = "YOU OWE",
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Color.White.copy(alpha = 0.7f),
                                            letterSpacing = 0.8.sp
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "$cSymbol${String.format("%.2f", currentYouOwe)}",
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFFFEBEE)
                                    )
                                }
                            }

                            // Owed card (frosted glass indicator)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(18.dp))
                                    .background(Color.White.copy(alpha = 0.12f))
                                    .padding(12.dp)
                            ) {
                                Column {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.TrendingUp,
                                            contentDescription = null,
                                            tint = Color(0xFFA5D6A7),
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Text(
                                            text = "OWED TO YOU",
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = Color.White.copy(alpha = 0.7f),
                                            letterSpacing = 0.8.sp
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "$cSymbol${String.format("%.2f", currentYouAreOwed)}",
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFE8F5E9)
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (currenciesList.size > 1) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.Center
                ) {
                    repeat(currenciesList.size) { iteration ->
                        val color = if (pagerState.currentPage == iteration) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.2f)
                        Box(
                            modifier = Modifier
                                .padding(4.dp)
                                .clip(CircleShape)
                                .background(color)
                                .size(8.dp)
                        )
                    }
                }
            }

            // Tab Navigation Dispatch
            when (currentTab) {
                0 -> {
                    // --- GROUPS TAB ---
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "ACTIVE GROUPS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.secondary,
                            letterSpacing = 1.sp
                        )
                        Text(
                            text = "${groups.size} Ledgers",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    if (groups.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(64.dp)
                                        .background(
                                            MaterialTheme.colorScheme.secondaryContainer,
                                            shape = CircleShape
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.ReceiptLong,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.secondary,
                                        modifier = Modifier.size(32.dp)
                                    )
                                }
                                Text(
                                    text = "No groups yet",
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "Tap 'Add Entry' to set roommate circles, trip ledgers, and shared expenses.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.secondary,
                                    modifier = Modifier.padding(horizontal = 48.dp),
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentPadding = PaddingValues(bottom = 88.dp)
                        ) {
                            items(groups) { group ->
                                val initials = group.name.take(2).uppercase()
                                // Consistent beautiful pastel gradients based on group id hash
                                val gradients = listOf(
                                    listOf(Color(0xFFE8F5E9), Color(0xFFC8E6C9), Color(0xFF2E7D32)), // Sage/emerald
                                    listOf(Color(0xFFE0F2F1), Color(0xFFB2DFDB), Color(0xFF00695C)), // Mint/teal
                                    listOf(Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFF1565C0)), // Indigo
                                    listOf(Color(0xFFEDE7F6), Color(0xFFD1C4E9), Color(0xFF673AB7)), // Lavender
                                    listOf(Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFE65100))  // Apricot
                                )
                                val chosenGrad = gradients[Math.abs(group.id.hashCode() % gradients.size)]
                                val avatarBgBrush = Brush.linearGradient(colors = listOf(chosenGrad[0], chosenGrad[1]))

                                Card(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 6.dp)
                                        .clickable { onGroupClick(group.id) }
                                        .testTag("group_card_${group.id}"),
                                    shape = RoundedCornerShape(20.dp),
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.surface
                                    ),
                                    border = androidx.compose.foundation.BorderStroke(
                                        width = 1.dp,
                                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
                                    )
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp, vertical = 14.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(44.dp)
                                                    .background(
                                                        brush = avatarBgBrush,
                                                        shape = RoundedCornerShape(12.dp)
                                                    ),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Text(
                                                    text = initials,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    color = chosenGrad[2]
                                                )
                                            }
                                            Column {
                                                Text(
                                                    text = group.name,
                                                    fontWeight = FontWeight.Bold,
                                                    fontSize = 16.sp,
                                                    color = MaterialTheme.colorScheme.onSurface
                                                )
                                                Spacer(modifier = Modifier.height(2.dp))
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.FolderOpen,
                                                        contentDescription = null,
                                                        tint = MaterialTheme.colorScheme.secondary,
                                                        modifier = Modifier.size(12.dp)
                                                    )
                                                    Text(
                                                        text = if (group.description.isNotBlank()) group.description else "Shared Ledger",
                                                        fontSize = 12.sp,
                                                        color = MaterialTheme.colorScheme.secondary,
                                                        maxLines = 1
                                                    )
                                                }
                                            }
                                        }

                                        IconButton(
                                            onClick = { showDeleteDialog = group },
                                            modifier = Modifier
                                                .testTag("delete_group_${group.id}")
                                                .size(36.dp)
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.DeleteOutline,
                                                    contentDescription = "Delete Group",
                                                    tint = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.8f),
                                                    modifier = Modifier.size(18.dp)
                                                )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                1 -> {
                    // --- FRIENDS (AD-HOC P2P) TAB ---
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 20.dp, end = 20.dp, top = 24.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "INDIVIDUAL FRIENDS (P2P)",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.secondary,
                            letterSpacing = 1.sp
                        )
                        TextButton(
                            onClick = { showAddFriendDialog = true }
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Add Friend", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }

                    if (friendsList.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(64.dp)
                                        .background(
                                            MaterialTheme.colorScheme.secondaryContainer,
                                            shape = CircleShape
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.PeopleOutline,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.secondary,
                                        modifier = Modifier.size(32.dp)
                                    )
                                }
                                Text(
                                    text = "No friends yet",
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "Add friends to split quick bills peer-to-peer outside of any groups.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.secondary,
                                    modifier = Modifier.padding(horizontal = 48.dp),
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentPadding = PaddingValues(bottom = 88.dp)
                        ) {
                            val uniqueFriends = friendsList.groupBy { it.friend.id }.values.toList()
                            items(uniqueFriends) { fwbs ->
                                val representativeFwb = fwbs.first()
                                val friendInfo = representativeFwb.friend
                                Card(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp, vertical = 6.dp)
                                        .clickable { activeFriendDetail = fwbs },
                                    shape = RoundedCornerShape(20.dp),
                                    colors = CardDefaults.cardColors(
                                        containerColor = MaterialTheme.colorScheme.surface
                                    ),
                                    border = androidx.compose.foundation.BorderStroke(
                                        width = 1.dp,
                                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f)
                                    )
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp, vertical = 14.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            // Soft monogram avatar circle
                                            val initials = friendInfo.name.take(2).uppercase()
                                            val badgeGradients = listOf(
                                                listOf(Color(0xFFEDE7F6), Color(0xFFD1C4E9), Color(0xFF5E35B1)), // purple
                                                listOf(Color(0xFFE8F5E9), Color(0xFFC8E6C9), Color(0xFF2E7D32)), // green
                                                listOf(Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFE65100)), // orange
                                                listOf(Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFF1565C0))  // blue
                                            )
                                            val colorIndex = Math.abs(friendInfo.id.hashCode() % badgeGradients.size)
                                            val (bgColor, blendColor, letterColor) = badgeGradients[colorIndex]

                                            Box(
                                                modifier = Modifier
                                                    .size(44.dp)
                                                    .background(
                                                        brush = Brush.linearGradient(colors = listOf(bgColor, blendColor)),
                                                        shape = CircleShape
                                                    ),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Text(
                                                    text = initials,
                                                    color = letterColor,
                                                    fontWeight = FontWeight.Bold,
                                                    fontSize = 13.sp
                                                )
                                            }

                                            Column {
                                                Text(
                                                    text = friendInfo.name,
                                                    fontWeight = FontWeight.Bold,
                                                    fontSize = 16.sp,
                                                    color = MaterialTheme.colorScheme.onSurface
                                                )
                                                Spacer(modifier = Modifier.height(2.dp))
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.AlternateEmail,
                                                        contentDescription = null,
                                                        tint = MaterialTheme.colorScheme.secondary,
                                                        modifier = Modifier.size(11.dp)
                                                    )
                                                    Text(
                                                        text = if (friendInfo.email.isNotBlank()) friendInfo.email else "Direct balance",
                                                        fontSize = 12.sp,
                                                        color = MaterialTheme.colorScheme.secondary,
                                                        maxLines = 1
                                                    )
                                                }
                                            }
                                        }

                                        Column(
                                            horizontalAlignment = Alignment.End,
                                            verticalArrangement = Arrangement.spacedBy(6.dp),
                                            modifier = Modifier.width(IntrinsicSize.Max)
                                        ) {
                                            fwbs.forEach { fwb ->
                                                val bal = fwb.netBalance
                                                val currencySymbol = when (fwb.currency) {
                                                    "USD" -> "$"
                                                    "EUR" -> "€"
                                                    "GBP" -> "£"
                                                    "INR" -> "₹"
                                                    "JPY" -> "¥"
                                                    "CAD" -> "C$"
                                                    "AUD" -> "A$"
                                                    else -> "$"
                                                }
                                                if (bal > 0.01) {
                                                    Box(
                                                        modifier = Modifier
                                                            .fillMaxWidth()
                                                            .widthIn(min = 90.dp)
                                                            .clip(RoundedCornerShape(8.dp))
                                                            .background(Color(0xFFE8F5E9))
                                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                                        contentAlignment = Alignment.CenterEnd
                                                    ) {
                                                        Column(horizontalAlignment = Alignment.End) {
                                                            Text("OWES YOU", fontSize = 8.sp, color = Color(0xFF2E7D32), fontWeight = FontWeight.Bold)
                                                            Text("$currencySymbol${String.format("%.2f", bal)}", fontSize = 14.sp, fontWeight = FontWeight.Black, color = Color(0xFF2E7D32))
                                                        }
                                                    }
                                                } else if (bal < -0.01) {
                                                    Box(
                                                        modifier = Modifier
                                                            .fillMaxWidth()
                                                            .widthIn(min = 90.dp)
                                                            .clip(RoundedCornerShape(8.dp))
                                                            .background(Color(0xFFFFEBEE))
                                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                                        contentAlignment = Alignment.CenterEnd
                                                    ) {
                                                        Column(horizontalAlignment = Alignment.End) {
                                                            Text("YOU OWE", fontSize = 8.sp, color = Color(0xFFC62828), fontWeight = FontWeight.Bold)
                                                            Text("$currencySymbol${String.format("%.2f", -bal)}", fontSize = 14.sp, fontWeight = FontWeight.Black, color = Color(0xFFC62828))
                                                        }
                                                    }
                                                } else {
                                                    Box(
                                                        modifier = Modifier
                                                            .fillMaxWidth()
                                                            .widthIn(min = 90.dp)
                                                            .clip(RoundedCornerShape(8.dp))
                                                            .background(MaterialTheme.colorScheme.surfaceVariant)
                                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                                        contentAlignment = Alignment.CenterEnd
                                                    ) {
                                                        Column(horizontalAlignment = Alignment.End) {
                                                            Text("SETTLED", fontSize = 8.sp, color = MaterialTheme.colorScheme.secondary, fontWeight = FontWeight.Bold)
                                                            Text("$currencySymbol"+"0.00", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                else -> {
                    // --- HELP & SYNC TAB ---
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState())
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = "LEDGER & DEBT CONFIGURATION",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.secondary,
                            letterSpacing = 1.sp
                        )

                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Icon(Icons.Default.Sync, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                    Text("Local SQLite Sync Engine", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                }
                                Text(
                                    text = "SplitSync aggregates group balances locally and runs the transaction minimization algorithm automatically. Ad-Hoc expenses are calculated as continuous direct peer-to-peer nets.",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.secondary
                                )
                                Button(
                                    onClick = { viewModel.triggerManualSync() },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Simulate Force Refresh Sync")
                                }
                            }
                        }

                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text("Rule of Separation (PRD Compliant)", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text(
                                    text = "• Localized Group Ledger: Settlements and expenses remain confined to the specific trip or roommates group.\n\n• Global Ad-Hoc Ledger: Split-amounts added outside of groups compile into a single net 1-on-1 balance per friend.",
                                    fontSize = 12.sp,
                                    lineHeight = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // --- CONTEXT SELECTOR POPUP DIALOG ---
    if (showContextSelector) {
        AlertDialog(
            onDismissRequest = { showContextSelector = false },
            title = { Text("Where does this belong?", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Choose the billing destination for your new entry.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.secondary
                    )

                    // Card 1: Individual P2P friends (Ad-Hoc)
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                showContextSelector = false
                                if (friendsList.isEmpty()) {
                                    showAddFriendDialog = true
                                } else {
                                    showAddAdHocExpenseDialog = true
                                }
                            },
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(Icons.Default.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column {
                                Text("Individual Friends (P2P)", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("Instant ad-hoc split outside of group folders.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                            }
                        }
                    }

                    // Card 2: Group Expense
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                showContextSelector = false
                                if (groups.isEmpty()) {
                                    onCreateGroupClick()
                                } else {
                                    showGroupSelectForExpense = true
                                }
                            },
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(Icons.Default.PostAdd, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column {
                                Text("Group Expense Ledger", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("Log cost inside standard group folder.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                            }
                        }
                    }

                    // Card 3: Create Group
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                showContextSelector = false
                                onCreateGroupClick()
                            },
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(Icons.Default.GroupAdd, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column {
                                Text("Create New Group Ledger", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("Add a new roommates, trip, or household folder.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showContextSelector = false }) {
                    Text("Close")
                }
            }
        )
    }

    // --- GROUP SELECTION DIALOG (LAUNCHED FROM CONTEXT) ---
    if (showGroupSelectForExpense) {
        AlertDialog(
            onDismissRequest = { showGroupSelectForExpense = false },
            title = { Text("Select Target Group", fontWeight = FontWeight.Bold) },
            text = {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(groups) { group ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    showGroupSelectForExpense = false
                                    onGroupClick(group.id)
                                },
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Icon(Icons.Default.FolderShared, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                Text(group.name, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showGroupSelectForExpense = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // --- ADD FRIEND DIALOG ---
    if (showAddFriendDialog) {
        var friendName by remember { mutableStateOf("") }
        var friendEmail by remember { mutableStateOf("") }
        var friendPhone by remember { mutableStateOf("") }
        var addValidationError by remember { mutableStateOf<String?>(null) }

        AlertDialog(
            onDismissRequest = { showAddFriendDialog = false },
            title = { Text("Add New Friend", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    addValidationError?.let { err ->
                        Text(err, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }

                    Text("Enter information to add this contact on the Peer-to-Peer ledger.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)

                    OutlinedTextField(
                        value = friendName,
                        onValueChange = { friendName = it },
                        label = { Text("Full Name") },
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = friendEmail,
                        onValueChange = { friendEmail = it },
                        label = { Text("Email Address") },
                        modifier = Modifier.fillMaxWidth()
                    )

                    OutlinedTextField(
                        value = friendPhone,
                        onValueChange = { friendPhone = it },
                        label = { Text("Phone Number") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (friendName.isBlank()) {
                            addValidationError = "Friend name is required."
                            return@Button
                        }
                        addValidationError = null
                        viewModel.createFriend(friendName, friendEmail, friendPhone) {
                            showAddFriendDialog = false
                        }
                    }
                ) {
                    Text("Add Friend")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddFriendDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // --- ADD AD-HOC EXPENSE DIALOG (SUPPORTS EQUAL & EXACT SPLIT SYSTEMS) ---
    if (showAddAdHocExpenseDialog) {
        var description by remember { mutableStateOf("") }
        var amountStr by remember { mutableStateOf("") }
        var paidByMeOrFriendId by remember { mutableStateOf(YOU_ID) } // YOU_ID = You, otherwise Friend.id
        var adHocSplitType by remember { mutableStateOf("EQUAL") }
        val selectedAdHocParticipants = remember { mutableStateListOf(YOU_ID) }
        val adHocSplitPortions = remember { mutableStateMapOf<String, String>() }

        var adHocCurrency by remember { mutableStateOf("USD") }
        var currencyDropdownExpanded by remember { mutableStateOf(false) }

        val context = LocalContext.current
        val dateFormatter = remember { SimpleDateFormat("MMM dd, yyyy", Locale.getDefault()) }
        var transactionDate by remember { mutableStateOf(System.currentTimeMillis()) }

        var localValidationError by remember { mutableStateOf<String?>(null) }

        val showDatePicker = {
            val currentCal = Calendar.getInstance()
            currentCal.timeInMillis = transactionDate
            DatePickerDialog(
                context,
                { _, year, month, dayOfMonth ->
                    val selectedCalendar = Calendar.getInstance()
                    selectedCalendar.set(Calendar.YEAR, year)
                    selectedCalendar.set(Calendar.MONTH, month)
                    selectedCalendar.set(Calendar.DAY_OF_MONTH, dayOfMonth)
                    transactionDate = selectedCalendar.timeInMillis
                    localValidationError = null
                },
                currentCal.get(Calendar.YEAR),
                currentCal.get(Calendar.MONTH),
                currentCal.get(Calendar.DAY_OF_MONTH)
            ).show()
        }

        val uniqueFriends = remember(friendsList) { friendsList.distinctBy { it.friend.id } }

        // Prefill default checked participants
        LaunchedEffect(Unit) {
            uniqueFriends.forEach { selectedAdHocParticipants.add(it.friend.id) }
        }

        AlertDialog(
            onDismissRequest = { showAddAdHocExpenseDialog = false },
            title = { Text("Add Ad-Hoc Split", fontWeight = FontWeight.Bold) },
            text = {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    item {
                        localValidationError?.let { err ->
                            Text(err, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                    }

                    item {
                        OutlinedTextField(
                            value = dateFormatter.format(Date(transactionDate)),
                            onValueChange = {},
                            label = { Text("Date") },
                            readOnly = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { showDatePicker() },
                            enabled = false,
                            colors = OutlinedTextFieldDefaults.colors(
                                disabledTextColor = MaterialTheme.colorScheme.onSurface,
                                disabledBorderColor = MaterialTheme.colorScheme.outline,
                                disabledLabelColor = MaterialTheme.colorScheme.onSurfaceVariant
                            ),
                            trailingIcon = {
                                Icon(
                                    imageVector = Icons.Default.CalendarToday,
                                    contentDescription = "Select Date",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        )
                    }

                    item {
                        OutlinedTextField(
                            value = description,
                            onValueChange = { description = it },
                            label = { Text("Description") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                    }

                    item {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            OutlinedTextField(
                                value = amountStr,
                                onValueChange = { amountStr = it },
                                label = { Text("Total Amount") },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                            )
                            
                            Box {
                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant,
                                    modifier = Modifier
                                        .clickable { currencyDropdownExpanded = true }
                                        .padding(top = 8.dp),
                                    shape = RoundedCornerShape(14.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 16.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Text(adHocCurrency, fontWeight = FontWeight.Bold)
                                        Icon(Icons.Default.ArrowDropDown, contentDescription = "Dropdown Selection")
                                    }
                                }

                                DropdownMenu(
                                    expanded = currencyDropdownExpanded,
                                    onDismissRequest = { currencyDropdownExpanded = false }
                                ) {
                                    val currencies = listOf(
                                        "USD" to "USD (\$)",
                                        "EUR" to "EUR (€)",
                                        "GBP" to "GBP (£)",
                                        "INR" to "INR (₹)",
                                        "JPY" to "JPY (¥)",
                                        "CAD" to "CAD (C\$)",
                                        "AUD" to "AUD (A\$)"
                                    )
                                    currencies.forEach { (code, label) ->
                                        DropdownMenuItem(
                                            text = { Text(label, fontWeight = FontWeight.Bold) },
                                            onClick = {
                                                adHocCurrency = code
                                                currencyDropdownExpanded = false
                                                localValidationError = null
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }

                    item {
                        Text("Paid By", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { paidByMeOrFriendId = YOU_ID }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(selected = paidByMeOrFriendId == YOU_ID, onClick = { paidByMeOrFriendId = YOU_ID })
                                Text("You")
                            }

                            uniqueFriends.forEach { fwb ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { paidByMeOrFriendId = fwb.friend.id }
                                        .padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    RadioButton(selected = paidByMeOrFriendId == fwb.friend.id, onClick = { paidByMeOrFriendId = fwb.friend.id })
                                    Text(fwb.friend.name)
                                }
                            }
                        }
                    }

                    item {
                        Text("Split With", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        if (selectedAdHocParticipants.contains(YOU_ID)) selectedAdHocParticipants.remove(YOU_ID)
                                        else selectedAdHocParticipants.add(YOU_ID)
                                    }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = selectedAdHocParticipants.contains(YOU_ID),
                                    onCheckedChange = { checked ->
                                        if (checked) selectedAdHocParticipants.add(YOU_ID)
                                        else selectedAdHocParticipants.remove(YOU_ID)
                                    }
                                )
                                Text("You")
                            }

                            uniqueFriends.forEach { fwb ->
                                val fid = fwb.friend.id
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            if (selectedAdHocParticipants.contains(fid)) selectedAdHocParticipants.remove(fid)
                                            else selectedAdHocParticipants.add(fid)
                                        }
                                        .padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Checkbox(
                                        checked = selectedAdHocParticipants.contains(fid),
                                        onCheckedChange = { checked ->
                                            if (checked) selectedAdHocParticipants.add(fid)
                                            else selectedAdHocParticipants.remove(fid)
                                        }
                                    )
                                    Text(fwb.friend.name)
                                }
                            }
                        }
                    }

                    item {
                        Text("Split Details", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { adHocSplitType = "EQUAL" }) {
                                RadioButton(selected = adHocSplitType == "EQUAL", onClick = { adHocSplitType = "EQUAL" })
                                Text("Equally")
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { adHocSplitType = "EXACT" }) {
                                RadioButton(selected = adHocSplitType == "EXACT", onClick = { adHocSplitType = "EXACT" })
                                Text("Exact division")
                            }
                        }
                    }

                    if (adHocSplitType == "EXACT") {
                        item {
                            Text("Specify exact parts ($adHocCurrency):", fontWeight = FontWeight.Bold, fontSize = 11.sp, color = MaterialTheme.colorScheme.secondary)
                        }

                        selectedAdHocParticipants.forEach { pid ->
                            val name = if (pid == YOU_ID) "You" else uniqueFriends.find { it.friend.id == pid }?.friend?.name ?: "Friend"
                            item {
                                OutlinedTextField(
                                    value = adHocSplitPortions[pid] ?: "",
                                    onValueChange = { adHocSplitPortions[pid] = it },
                                    label = { Text("Portion for $name") },
                                    modifier = Modifier.fillMaxWidth(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val amount = amountStr.toDoubleOrNull() ?: 0.0
                        if (description.isBlank()) {
                            localValidationError = "Description is required."
                            return@Button
                        }
                        if (amount <= 0.0) {
                            localValidationError = "Please enter valid billing amount."
                            return@Button
                        }
                        if (selectedAdHocParticipants.isEmpty()) {
                            localValidationError = "Please select at least one participating friend."
                            return@Button
                        }

                        val exactMap = mutableMapOf<String, Double>()
                        if (adHocSplitType == "EXACT") {
                            selectedAdHocParticipants.forEach { pid ->
                                val valPort = adHocSplitPortions[pid]?.toDoubleOrNull() ?: 0.0
                                exactMap[pid] = valPort
                            }
                            val sum = exactMap.values.sum()
                            if (Math.abs(sum - amount) > 0.02) {
                                localValidationError = "Detailed splits ($${String.format("%.2f", sum)}) must equal total cost ($${String.format("%.2f", amount)})."
                                return@Button
                            }
                        }

                        localValidationError = null
                        viewModel.addAdHocExpense(
                            description = description,
                            amount = amount,
                            paidByFriendId = paidByMeOrFriendId,
                            splitType = adHocSplitType,
                            splitDistribution = exactMap,
                            selectedParticipantsForEqualSplit = selectedAdHocParticipants.toList(),

                            currency = adHocCurrency,
                            timestamp = transactionDate

                        ) {
                            showAddAdHocExpenseDialog = false
                        }
                    }
                ) {
                    Text("Record Expense", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddAdHocExpenseDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // --- FRIEND DETAIL DIALOG (DETAILED shared bills and payments ledger) ---
        activeFriendDetail?.let { fwbs ->
        val friendId = fwbs.first().friend.id
        val friendInfo = fwbs.first().friend

        // Filter linked adhoc expenses
        val linkedExpenses = adhocExpensesList.filter { expense ->
            val splits = adhocSplitsList.filter { it.adhocExpenseId == expense.id }
            if (expense.paidByFriendId == YOU_ID) {
                splits.any { it.participantFriendId == friendId }
            } else if (expense.paidByFriendId == friendId) {
                splits.any { it.participantFriendId == YOU_ID }
            } else {
                false
            }
        }

        // Filter linked adhoc payments
        val linkedPayments = adhocPaymentsList.filter { payment ->
            (payment.fromFriendId == YOU_ID && payment.toFriendId == friendId) ||
            (payment.fromFriendId == friendId && payment.toFriendId == YOU_ID)
        }

        // Combine and list chronologically
        val sortedLedger = (linkedExpenses.map { it to "EXPENSE" } + linkedPayments.map { it to "PAYMENT" })
            .sortedByDescending { (item, type) ->
                if (type == "EXPENSE") (item as AdHocExpense).timestamp else (item as AdHocPayment).timestamp
            }

        val dateFormatter = remember { SimpleDateFormat("MMM dd, yyyy", Locale.getDefault()) }

        AlertDialog(
            onDismissRequest = { activeFriendDetail = null },
            title = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .background(MaterialTheme.colorScheme.secondaryContainer, shape = CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = friendInfo.name.take(2).uppercase(),
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    }
                    Text(friendInfo.name, fontWeight = FontWeight.Bold)
                }
            },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    // Contact details card
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            if (friendInfo.email.isNotBlank()) {
                                Text(friendInfo.email, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                            }
                            if (friendInfo.phone.isNotBlank()) {
                                Text(friendInfo.phone, fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                            }
                        }
                        IconButton(
                            onClick = {
                                viewModel.deleteFriend(friendInfo)
                                activeFriendDetail = null
                            },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.DeleteOutline,
                                contentDescription = "Delete Contact",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }

                    // Balance Display Box
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        items(fwbs) { fwb ->
                            val b = fwb.netBalance
                            val cSymbol = when (fwb.currency) {
                                "USD" -> "$"
                                "EUR" -> "€"
                                "GBP" -> "£"
                                "INR" -> "₹"
                                "JPY" -> "¥"
                                "CAD" -> "C$"
                                "AUD" -> "A$"
                                else -> "$"
                            }
                            Box(
                                modifier = Modifier
                                    .widthIn(min = 140.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(
                                        if (b > 0.01) Color(0xFFE8F5E9)
                                        else if (b < -0.01) Color(0xFFFFEBEE)
                                        else MaterialTheme.colorScheme.surfaceVariant
                                    )
                                    .padding(16.dp)
                            ) {
                                Column(horizontalAlignment = Alignment.Start) {
                                    Text("Net Balance", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                    Spacer(modifier = Modifier.height(4.dp))
                                    if (b > 0.01) {
                                        Text("${friendInfo.name} owes you", fontSize = 10.sp, color = Color(0xFF2E7D32), fontWeight = FontWeight.Bold)
                                        Text("$cSymbol${String.format("%.2f", b)}", fontSize = 20.sp, fontWeight = FontWeight.Black, color = Color(0xFF2E7D32))
                                    } else if (b < -0.01) {
                                        Text("You owe ${friendInfo.name}", fontSize = 10.sp, color = Color(0xFFC62828), fontWeight = FontWeight.Bold)
                                        Text("$cSymbol${String.format("%.2f", -b)}", fontSize = 20.sp, fontWeight = FontWeight.Black, color = Color(0xFFC62828))
                                    } else {
                                        Text("Settled up", fontSize = 10.sp, color = MaterialTheme.colorScheme.secondary)
                                        Text("$cSymbol"+"0.00", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
                                    }
                                }
                            }
                        }
                    }

                    Text(
                        text = "SHARED TRANSACTION LEDGER",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.secondary,
                        letterSpacing = 1.sp
                    )

                    if (sortedLedger.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(120.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("No direct P2P activities recorded.", fontSize = 13.sp, color = MaterialTheme.colorScheme.secondary)
                        }
                    } else {
                        Box(modifier = Modifier.height(200.dp)) {
                            LazyColumn(
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                items(sortedLedger) { (item, type) ->
                                    Card(
                                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(10.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            if (type == "EXPENSE") {
                                                val exp = item as AdHocExpense
                                                val splits = adhocSplitsList.filter { it.adhocExpenseId == exp.id }
                                                val cSymbol = when (exp.currency) {
                                                    "USD" -> "$"
                                                    "EUR" -> "€"
                                                    "GBP" -> "£"
                                                    "INR" -> "₹"
                                                    "JPY" -> "¥"
                                                    "CAD" -> "C$"
                                                    "AUD" -> "A$"
                                                    else -> "$"
                                                }
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                        Text(exp.description, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                                        Text(dateFormatter.format(Date(exp.timestamp)), fontSize = 10.sp, color = MaterialTheme.colorScheme.secondary)
                                                    }
                                                    
                                                    val detailText = if (exp.paidByFriendId == YOU_ID) {
                                                        val friendPortion = splits.find { it.participantFriendId == friendId }?.amount ?: 0.0
                                                        "You paid $cSymbol${String.format("%.2f", exp.amount)} (Owes you $cSymbol${String.format("%.2f", friendPortion)})"
                                                    } else {
                                                        val youPortion = splits.find { it.participantFriendId == YOU_ID }?.amount ?: 0.0
                                                        "${friendInfo.name} paid $cSymbol${String.format("%.2f", exp.amount)} (You owe $cSymbol${String.format("%.2f", youPortion)})"
                                                    }
                                                    Text(detailText, fontSize = 11.sp, color = MaterialTheme.colorScheme.primary)
                                                }
                                                IconButton(
                                                    onClick = { viewModel.deleteAdHocExpense(exp) },
                                                    modifier = Modifier.size(24.dp)
                                                ) {
                                                    Icon(Icons.Default.Clear, contentDescription = "Delete", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                                                }
                                            } else {
                                                val pay = item as AdHocPayment
                                                val cSymbol = when (pay.currency) {
                                                    "USD" -> "$"
                                                    "EUR" -> "€"
                                                    "GBP" -> "£"
                                                    "INR" -> "₹"
                                                    "JPY" -> "¥"
                                                    "CAD" -> "C$"
                                                    "AUD" -> "A$"
                                                    else -> "$"
                                                }
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                        val payText = if (pay.fromFriendId == YOU_ID) "Your Payment -> ${friendInfo.name}" else "${friendInfo.name}'s Payment -> You"
                                                        Text(payText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                                        Text(dateFormatter.format(Date(pay.timestamp)), fontSize = 10.sp, color = MaterialTheme.colorScheme.secondary)
                                                    }
                                                    Text("Amount: $cSymbol${String.format("%.2f", pay.amount)}", fontSize = 11.sp, color = Color(0xFF2E7D32))
                                                }
                                                IconButton(
                                                    onClick = { viewModel.deleteAdHocPayment(pay) },
                                                    modifier = Modifier.size(24.dp)
                                                ) {
                                                    Icon(Icons.Default.Clear, contentDescription = "Delete", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = {
                            showAdHocSettleDialog = fwbs.find { it.netBalance != 0.0 } ?: fwbs.first()
                            activeFriendDetail = null
                        }
                    ) {
                        Icon(Icons.Default.PriceCheck, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Settle Up")
                    }
                    Button(
                        onClick = {
                            showAddAdHocExpenseDialog = true
                            activeFriendDetail = null
                        }
                    ) {
                        Icon(Icons.Default.PostAdd, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Log Expense")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { activeFriendDetail = null }) {
                    Text("Close")
                }
            }
        )
    }

    // --- AD-HOC RECORD SETTLEMENT DIALOG ---
    showAdHocSettleDialog?.let { fwb ->
        val currentBal = fwb.netBalance
        val initialVal = if (currentBal < 0) -currentBal else currentBal

        var inputSettleAmount by remember { mutableStateOf(String.format("%.2f", initialVal)) }
        val defaultDebtorId = if (currentBal < 0) YOU_ID else fwb.friend.id // If negative, You pay friend. Else, friend pays You.
        val defaultCreditorId = if (currentBal < 0) fwb.friend.id else YOU_ID

        var localSettleError by remember { mutableStateOf<String?>(null) }

        val fromName = if (defaultDebtorId == YOU_ID) "You" else fwb.friend.name
        val toName = if (defaultCreditorId == YOU_ID) "You" else fwb.friend.name

        val context = LocalContext.current
        val dateFormatter = remember { SimpleDateFormat("MMM dd, yyyy", Locale.getDefault()) }
        var transactionDate by remember { mutableStateOf(System.currentTimeMillis()) }

        val showDatePicker = {
            val currentCal = Calendar.getInstance()
            currentCal.timeInMillis = transactionDate
            DatePickerDialog(
                context,
                { _, year, month, dayOfMonth ->
                    val selectedCalendar = Calendar.getInstance()
                    selectedCalendar.set(Calendar.YEAR, year)
                    selectedCalendar.set(Calendar.MONTH, month)
                    selectedCalendar.set(Calendar.DAY_OF_MONTH, dayOfMonth)
                    transactionDate = selectedCalendar.timeInMillis
                    localSettleError = null
                },
                currentCal.get(Calendar.YEAR),
                currentCal.get(Calendar.MONTH),
                currentCal.get(Calendar.DAY_OF_MONTH)
            ).show()
        }

        val currencySymbol = when (fwb.currency) {
            "USD" -> "$"
            "EUR" -> "€"
            "GBP" -> "£"
            "INR" -> "₹"
            "JPY" -> "¥"
            "CAD" -> "C$"
            "AUD" -> "A$"
            else -> "$"
        }

        AlertDialog(
            onDismissRequest = { showAdHocSettleDialog = null },
            title = { Text("Record P2P Settlement", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
                    localSettleError?.let { err ->
                        Text(err, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }

                    Text("This records cash or online settlement strictly between you and ${fwb.friend.name} in ${fwb.currency}.", fontSize = 12.sp, color = MaterialTheme.colorScheme.secondary)
                    
                    OutlinedTextField(
                        value = dateFormatter.format(Date(transactionDate)),
                        onValueChange = {},
                        label = { Text("Date") },
                        readOnly = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showDatePicker() },
                        enabled = false,
                        colors = OutlinedTextFieldDefaults.colors(
                            disabledTextColor = MaterialTheme.colorScheme.onSurface,
                            disabledBorderColor = MaterialTheme.colorScheme.outline,
                            disabledLabelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        trailingIcon = {
                            Icon(
                                imageVector = Icons.Default.CalendarToday,
                                contentDescription = "Select Date",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Sender (Pays)", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
                            Box(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(8.dp)) {
                                Text(fromName, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                        Icon(Icons.Default.ArrowForward, contentDescription = "pays to")
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Recipient (Gets)", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
                            Box(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(8.dp)) {
                                Text(toName, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }

                    OutlinedTextField(
                        value = inputSettleAmount,
                        onValueChange = { inputSettleAmount = it },
                        label = { Text("Settlement Amount ($currencySymbol)") },
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        leadingIcon = {
                            Text(
                                text = currencySymbol,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(start = 12.dp)
                            )
                        }
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val amount = inputSettleAmount.toDoubleOrNull() ?: 0.0
                        if (amount <= 0.0) {
                            localSettleError = "Invalid settlement amount."
                            return@Button
                        }
                        localSettleError = null
                        viewModel.recordAdHocPayment(
                            fromFriendId = defaultDebtorId,
                            toFriendId = defaultCreditorId,
                            amount = amount,
                            currency = fwb.currency,
                            timestamp = transactionDate
                        ) {
                            showAdHocSettleDialog = null
                        }
                    }
                ) {
                    Text("Settle Balances")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAdHocSettleDialog = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    // --- DELETE GROUP CONFIRMATION DIALOG ---
    showDeleteDialog?.let { group ->
        AlertDialog(
            onDismissRequest = { showDeleteDialog = null },
            title = { Text("Delete Group?", fontWeight = FontWeight.Bold) },
            text = { Text("All expenses, splits, and custom payments inside '${group.name}' will be permanently deleted.") },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.deleteGroup(group) {
                            showDeleteDialog = null
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary)
                ) {
                    Text("Delete", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}
