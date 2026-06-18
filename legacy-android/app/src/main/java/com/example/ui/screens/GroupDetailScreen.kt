package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.model.*
import com.example.ui.SplitSyncViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupDetailScreen(
    viewModel: SplitSyncViewModel,
    groupId: String,
    onBackClick: () -> Unit,
    onAddExpenseClick: () -> Unit
) {
    val group by viewModel.selectedGroup.collectAsState()
    val members by viewModel.selectedGroupMembers.collectAsState()
    val expenses by viewModel.selectedGroupExpenses.collectAsState()
    val payments by viewModel.selectedGroupPayments.collectAsState()
    val balances by viewModel.memberBalances.collectAsState()
    val debts by viewModel.simplifiedDebts.collectAsState()
    val isSyncing by viewModel.isSyncing.collectAsState()

    var selectedTabIndex by remember { mutableStateOf(0) }
    val tabs = listOf("Ledger", "Balances", "Debt Solver", "Settlements")

    var showInviteDialog by remember { mutableStateOf(false) }

    // Record settlement dialog state
    var showSettleDialog by remember { mutableStateOf(false) }
    var prefilledDebtor by remember { mutableStateOf<GroupMember?>(null) }
    var prefilledCreditor by remember { mutableStateOf<GroupMember?>(null) }
    var prefilledAmount by remember { mutableStateOf(0.0) }
    var prefilledCurrency by remember { mutableStateOf("USD") }

    // Setup active group in ViewModel
    LaunchedEffect(groupId) {
        viewModel.selectGroup(groupId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = group?.name ?: "Group Details",
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        )
                        if (group?.description?.isNotBlank() == true) {
                            Text(
                                text = group!!.description,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.secondary,
                                maxLines = 1
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("back_button_group")) {
                        Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Go Back")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { showInviteDialog = true },
                        modifier = Modifier.testTag("invite_member_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.PersonAdd,
                            contentDescription = "Invite member"
                        )
                    }
                    IconButton(
                        onClick = { viewModel.triggerManualSync() },
                        modifier = Modifier.testTag("sync_group_button_top")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Sync",
                            tint = if (isSyncing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onAddExpenseClick,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier
                    .navigationBarsPadding()
                    .testTag("add_expense_fab")
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(imageVector = Icons.Default.PostAdd, contentDescription = "Add Expense")
                    Text("Add Expense", fontWeight = FontWeight.Bold)
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
            // Synchronization progress indicator bar
            if (isSyncing) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            // High level group visual summary header card
            val groupSumGradient = Brush.linearGradient(
                colors = listOf(
                    MaterialTheme.colorScheme.primary,
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                    MaterialTheme.colorScheme.secondary.copy(alpha = 0.8f)
                )
            )

            val groupCurrencies = expenses.map { it.currency }.distinct().ifEmpty { listOf("USD") }
            val groupPagerState = rememberPagerState(pageCount = { groupCurrencies.size })

            HorizontalPager(
                state = groupPagerState,
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 16.dp),
                contentPadding = PaddingValues(horizontal = if (groupCurrencies.size > 1) 32.dp else 16.dp),
                pageSpacing = 16.dp
            ) { page ->
                val currency = groupCurrencies[page]
                val totalSpend = expenses.filter { it.currency == currency }.sumOf { it.amount }
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
                        .clip(RoundedCornerShape(24.dp))
                        .background(groupSumGradient)
                        .padding(20.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.PieChart,
                                    contentDescription = null,
                                    tint = Color.White.copy(alpha = 0.8f),
                                    modifier = Modifier.size(13.dp)
                                )
                                Text(
                                    text = "TOTAL GROUP SPEND ($currency)",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = Color.White.copy(alpha = 0.8f),
                                    letterSpacing = 1.sp
                                )
                            }
                            Text(
                                text = "$cSymbol${String.format("%.2f", totalSpend)}",
                                fontSize = 28.sp,
                                fontWeight = FontWeight.ExtraBold,
                                color = Color.White
                            )
                        }

                        // Network Offline Local Persistence Indicator Badge
                        Row(
                            modifier = Modifier
                                .clip(RoundedCornerShape(100.dp))
                                .background(Color.White.copy(alpha = 0.2f))
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .background(Color(0xFF81C784), shape = CircleShape)
                            )
                            Text(
                                text = "SplitSync Local Engine",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Black,
                                color = Color.White,
                                letterSpacing = 0.5.sp
                            )
                        }
                    }
                }
            }

            if (groupCurrencies.size > 1) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
                    horizontalArrangement = Arrangement.Center
                ) {
                    repeat(groupCurrencies.size) { iteration ->
                        val color = if (groupPagerState.currentPage == iteration) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.2f)
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

            // M3 Scrollable TabRow
            TabRow(
                selectedTabIndex = selectedTabIndex,
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth()
            ) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTabIndex == index,
                        onClick = { selectedTabIndex = index },
                        text = { Text(title, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) },
                        modifier = Modifier.testTag("tab_$index")
                    )
                }
            }

            // Tab contents rendering using reactive lists
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                when (selectedTabIndex) {
                    0 -> LedgerTab(
                        expenses = expenses,
                        members = members,
                        onDeleteExpense = { viewModel.deleteExpense(it) }
                    )
                    1 -> BalancesTab(balances = balances)
                    2 -> DebtSolverTab(
                        debts = debts,
                        onSettleUp = { debt ->
                            prefilledDebtor = debt.debtor
                            prefilledCreditor = debt.creditor
                            prefilledAmount = debt.amount
                            prefilledCurrency = debt.currency
                            showSettleDialog = true
                        }
                    )
                    3 -> SettlementsTab(
                        payments = payments,
                        members = members,
                        onDeletePayment = { viewModel.deletePayment(it) }
                    )
                }
            }
        }
    }

    // Dynamic prefilled settlement modal/dialog
    if (showSettleDialog && prefilledDebtor != null && prefilledCreditor != null) {
        val selectedFromMemberId = prefilledDebtor!!.id
        val selectedToMemberId = prefilledCreditor!!.id
        var customSettleAmountStr by remember { mutableStateOf(String.format("%.2f", prefilledAmount)) }
        val settlementValidationError by viewModel.validationError.collectAsState()

        val currencySymbol = when (prefilledCurrency) {
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
            onDismissRequest = {
                showSettleDialog = false
                viewModel.clearValidationError()
            },
            title = { Text("Record Settle Up Payment") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    settlementValidationError?.let { err ->
                        Text(
                            text = err,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Text(
                        text = "This records a manual cash settlement or online payment between group members to resolve the simplified balance in $prefilledCurrency.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.secondary
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Sender (Pays)", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .padding(12.dp)
                            ) {
                                Text(prefilledDebtor!!.name, fontWeight = FontWeight.Bold)
                            }
                        }

                        Icon(
                            imageVector = Icons.Default.ArrowForward,
                            contentDescription = "pays to"
                        )

                        Column(modifier = Modifier.weight(1f)) {
                            Text("Recipient (Receives)", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .padding(12.dp)
                            ) {
                                Text(prefilledCreditor!!.name, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    OutlinedTextField(
                        value = customSettleAmountStr,
                        onValueChange = {
                            customSettleAmountStr = it
                            viewModel.clearValidationError()
                        },
                        label = { Text("Settle Amount ($currencySymbol)") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("settle_amount_input"),
                        singleLine = true,
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
                        val amt = customSettleAmountStr.toDoubleOrNull()
                        if (amt == null || amt <= 0.0) {
                            viewModel.recordManualSettlement("", "", 0.0, prefilledCurrency) {} // force view model validation trigger
                        } else {
                            viewModel.recordManualSettlement(
                                fromMemberId = selectedFromMemberId,
                                toMemberId = selectedToMemberId,
                                amount = amt,
                                currency = prefilledCurrency
                            ) {
                                showSettleDialog = false
                            }
                        }
                    },
                    modifier = Modifier.testTag("settle_confirm_button")
                ) {
                    Text("Confirm Settle", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showSettleDialog = false
                        viewModel.clearValidationError()
                    }
                ) {
                    Text("Cancel")
                }
            }
        )
    }

    // --- INVITE MEMBER DIALOG (multi-user sharing) ---
    if (showInviteDialog) {
        val currentGroup = group
        var inviteEmail by remember { mutableStateOf("") }
        var statusMessage by remember { mutableStateOf<String?>(null) }
        val inviteValidationError by viewModel.validationError.collectAsState()

        AlertDialog(
            onDismissRequest = {
                showInviteDialog = false
                viewModel.clearValidationError()
            },
            title = { Text("Invite Member", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Send a group invite to a SplitSync user by email. They'll see it on their dashboard and can accept to join '${currentGroup?.name ?: "this group"}'.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    OutlinedTextField(
                        value = inviteEmail,
                        onValueChange = {
                            inviteEmail = it
                            statusMessage = null
                            viewModel.clearValidationError()
                        },
                        label = { Text("Email") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("invite_email_input")
                    )
                    val err = inviteValidationError ?: statusMessage
                    if (err != null) {
                        Text(
                            text = err,
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val g = currentGroup ?: return@Button
                        viewModel.inviteMemberToGroup(g, inviteEmail) { ok ->
                            if (ok) {
                                statusMessage = null
                                showInviteDialog = false
                            }
                        }
                    },
                    enabled = inviteEmail.isNotBlank(),
                    modifier = Modifier.testTag("invite_send_button")
                ) {
                    Text("Send Invite", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showInviteDialog = false
                    viewModel.clearValidationError()
                }) {
                    Text("Cancel")
                }
            }
        )
    }
}

// --- SUB-TABS COMPOSE BLOCKS ---

@Composable
fun LedgerTab(
    expenses: List<Expense>,
    members: List<GroupMember>,
    onDeleteExpense: (Expense) -> Unit
) {
    val dateFormatter = remember { SimpleDateFormat("MMM dd, yyyy", Locale.getDefault()) }

    if (expenses.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Book,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(48.dp)
                )
                Text(
                    text = "No expenses logged",
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "Use '+ Add Expense' at the bottom right to start.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(expenses) { expense ->
                val payer = members.find { it.id == expense.paidById }
                Card(
                    modifier = Modifier.padding(vertical = 4.dp),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = androidx.compose.foundation.BorderStroke(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            val descHash = Math.abs(expense.description.hashCode() % 4)
                            val gradColors = when(descHash) {
                                0 -> listOf(Color(0xFFE8F5E9), Color(0xFFC8E6C9), Color(0xFF2E7D32)) // green
                                1 -> listOf(Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFF1565C0)) // blue
                                2 -> listOf(Color(0xFFFFEBEE), Color(0xFFFFCDD2), Color(0xFFC62828)) // red
                                else -> listOf(Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFE65100)) // orange
                            }
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .background(
                                        brush = Brush.linearGradient(colors = listOf(gradColors[0], gradColors[1])),
                                        shape = CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = when(descHash) {
                                        0 -> Icons.Default.Restaurant
                                        1 -> Icons.Default.DirectionsCar
                                        2 -> Icons.Default.Home
                                        else -> Icons.Default.ShoppingBag
                                    },
                                    contentDescription = null,
                                    tint = gradColors[2],
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                            Column {
                                Text(
                                    text = expense.description,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Text(
                                        text = "Paid by ",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.secondary
                                    )
                                    Text(
                                        text = payer?.name ?: "Unknown",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                    Text(
                                        text = "• ${expense.splitType}",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.secondary
                                    )
                                    Text(
                                        text = "• ${dateFormatter.format(Date(expense.timestamp))}",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.secondary
                                    )
                                }
                            }
                        }

                        val currencySymbol = when (expense.currency) {
                            "USD" -> "$"
                            "EUR" -> "€"
                            "GBP" -> "£"
                            "INR" -> "₹"
                            "JPY" -> "¥"
                            "CAD" -> "C$"
                            "AUD" -> "A$"
                            else -> "$"
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = "$currencySymbol${String.format("%.2f", expense.amount)}",
                                fontWeight = FontWeight.Black,
                                color = MaterialTheme.colorScheme.onSurface,
                                fontSize = 16.sp,
                                letterSpacing = (-0.5).sp
                            )
                            IconButton(onClick = { onDeleteExpense(expense) }) {
                                Icon(
                                    imageVector = Icons.Default.DeleteOutline,
                                    contentDescription = "Delete Expense",
                                    tint = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.8f),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun BalancesTab(balances: List<MemberBalanceInfo>) {
    val groupedByCurrency = remember(balances) { balances.groupBy { it.currency } }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        groupedByCurrency.forEach { (currency, currencyBalances) ->
            item {
                val currencyName = when (currency) {
                    "USD" -> "US Dollar (USD)"
                    "EUR" -> "Euro (EUR)"
                    "GBP" -> "British Pound (GBP)"
                    "INR" -> "Indian Rupee (INR)"
                    "JPY" -> "Japanese Yen (JPY)"
                    "CAD" -> "Canadian Dollar (CAD)"
                    "AUD" -> "Australian Dollar (AUD)"
                    else -> currency
                }
                Text(
                    text = currencyName,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                )
            }

            items(currencyBalances) { bal ->
                val isOwed = bal.netBalance > 0.01
                val isSettleWhole = Math.abs(bal.netBalance) <= 0.01

                val currencySymbol = when (currency) {
                    "USD" -> "$"
                    "EUR" -> "€"
                    "GBP" -> "£"
                    "INR" -> "₹"
                    "JPY" -> "¥"
                    "CAD" -> "C$"
                    "AUD" -> "A$"
                    else -> "$"
                }

                Card(
                    modifier = Modifier.padding(vertical = 4.dp),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = androidx.compose.foundation.BorderStroke(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = bal.member.name,
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Spent: $currencySymbol${String.format("%.2f", bal.initialPaid)}",
                                    fontSize = 11.sp,
                                    color = Color(0xFF2E7D32),
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "Share: $currencySymbol${String.format("%.2f", bal.initialOwe)}",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.secondary
                                )
                            }

                            // Add a micro visual progress metric
                            val totalVol = bal.initialPaid + bal.initialOwe
                            val rawRatio = if (totalVol > 0.1) (bal.initialPaid / totalVol).toFloat() else 0f
                            val fillRatio = rawRatio.coerceIn(0f, 1f)

                            LinearProgressIndicator(
                                progress = fillRatio,
                                modifier = Modifier
                                    .width(130.dp)
                                    .height(5.dp)
                                    .clip(RoundedCornerShape(3.dp)),
                                color = if (isOwed) Color(0xFF81C784) else MaterialTheme.colorScheme.primary,
                                trackColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        }

                        // Balance status badge
                        val badgeColor = when {
                            isSettleWhole -> MaterialTheme.colorScheme.surfaceVariant
                            isOwed -> Color(0xFFE8F5E9)
                            else -> Color(0xFFFFEBEE)
                        }
                        val badgeTextColor = when {
                            isSettleWhole -> MaterialTheme.colorScheme.onSurfaceVariant
                            isOwed -> Color(0xFF2E7D32)
                            else -> Color(0xFFC62828)
                        }
                        val badgeLabel = when {
                            isSettleWhole -> "Settled"
                            isOwed -> "▲ +$currencySymbol${String.format("%.2f", bal.netBalance)}"
                            else -> "▼ -$currencySymbol${String.format("%.2f", Math.abs(bal.netBalance))}"
                        }

                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(badgeColor)
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text(
                                text = badgeLabel,
                                color = badgeTextColor,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 11.sp,
                                letterSpacing = 0.5.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun DebtSolverTab(
    debts: List<DebtOverview>,
    onSettleUp: (DebtOverview) -> Unit
) {
    if (debts.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(56.dp)
                )
                Text(
                    text = "Aww yeah! All settled up!",
                    fontWeight = FontWeight.Black,
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 16.sp
                )
                Text(
                    text = "Everyone is square. No pending transactions required.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(horizontal = 48.dp),
                    textAlign = TextAlign.Center
                )
            }
        }
    } else {
        Column(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f))
                    .padding(16.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Lightbulb,
                        contentDescription = "Dynamic Optimization Tip",
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "Debt Simplification Algorithm active! Tap 'Settle up' next to any optimized transaction to register a cash payment.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(debts) { debt ->
                    Card(
                        modifier = Modifier.padding(vertical = 4.dp),
                        shape = RoundedCornerShape(20.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = androidx.compose.foundation.BorderStroke(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                        )
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            // Flow Graphic
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Debtor pill (Sender)
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color(0xFFFFEBEE))
                                        .padding(12.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("SENDER", fontSize = 8.sp, fontWeight = FontWeight.Bold, color = Color(0xFFC62828))
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            text = debt.debtor.name,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 14.sp,
                                            color = Color(0xFFB71C1C)
                                        )
                                    }
                                }

                                // Interactive Transfer arrow with Amount
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center
                                ) {
                                    val currencySymbol = when (debt.currency) {
                                        "USD" -> "$"
                                        "EUR" -> "€"
                                        "GBP" -> "£"
                                        "INR" -> "₹"
                                        "JPY" -> "¥"
                                        "CAD" -> "C$"
                                        "AUD" -> "A$"
                                        else -> "$"
                                    }
                                    Text(
                                        text = "$currencySymbol${String.format("%.2f", debt.amount)}",
                                        fontWeight = FontWeight.Black,
                                        fontSize = 16.sp,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                    Icon(
                                        imageVector = Icons.Default.ArrowForward,
                                        contentDescription = "pays",
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }

                                // Creditor pill (Recipient)
                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color(0xFFE8F5E9))
                                        .padding(12.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text("RECIPIENT", fontSize = 8.sp, fontWeight = FontWeight.Bold, color = Color(0xFF2E7D32))
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            text = debt.creditor.name,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 14.sp,
                                            color = Color(0xFF1B5E20)
                                        )
                                    }
                                }
                            }

                            // Horizontal Divider dividing content and Settle Up action
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(1.dp)
                                    .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Minimised group transfer",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.secondary,
                                    fontWeight = FontWeight.Medium
                                )

                                Button(
                                    onClick = { onSettleUp(debt) },
                                    shape = RoundedCornerShape(100.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                                        contentColor = MaterialTheme.colorScheme.primary
                                    ),
                                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                                    modifier = Modifier
                                        .testTag("settle_up_btn_${debt.debtor.id}_${debt.creditor.id}")
                                        .height(34.dp)
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.Check,
                                            contentDescription = null,
                                            modifier = Modifier.size(12.dp)
                                        )
                                        Text("Settle up", fontWeight = FontWeight.Bold, fontSize = 11.sp)
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

@Composable
fun SettlementsTab(
    payments: List<Payment>,
    members: List<GroupMember>,
    onDeletePayment: (Payment) -> Unit
) {
    if (payments.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Receipt,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.size(48.dp)
                )
                Text(
                    text = "No settlements recorded yet",
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "Record transactions in 'Debt Solver' or settle balances directly.",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(payments) { pay ->
                val fromM = members.find { it.id == pay.fromMemberId }
                val toM = members.find { it.id == pay.toMemberId }

                Card(
                    modifier = Modifier.padding(vertical = 4.dp),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = androidx.compose.foundation.BorderStroke(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .background(
                                        Color(0xFFE8F5E9),
                                        shape = CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = null,
                                    tint = Color(0xFF2E7D32),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                            Column {
                                Text(
                                    text = "${fromM?.name ?: "Unknown"} paid ${toM?.name ?: "Unknown"}",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(
                                    text = "Recorded settlement repayment",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.secondary
                                )
                            }
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            val currencySymbol = when (pay.currency) {
                                "USD" -> "$"
                                "EUR" -> "€"
                                "GBP" -> "£"
                                "INR" -> "₹"
                                "JPY" -> "¥"
                                "CAD" -> "C$"
                                "AUD" -> "A$"
                                else -> "$"
                            }
                            Text(
                                text = "$currencySymbol${String.format("%.2f", pay.amount)}",
                                fontWeight = FontWeight.Black,
                                color = Color(0xFF2E7D32),
                                fontSize = 15.sp,
                                letterSpacing = (-0.5).sp
                            )
                            IconButton(onClick = { onDeletePayment(pay) }) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Delete settlement",
                                    tint = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.8f),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
