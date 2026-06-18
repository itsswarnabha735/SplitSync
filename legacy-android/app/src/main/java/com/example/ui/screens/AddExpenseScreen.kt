package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Payment
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.SplitSyncViewModel
import android.app.DatePickerDialog
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.ArrowDropDown
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddExpenseScreen(
    viewModel: SplitSyncViewModel,
    onBackClick: () -> Unit,
    onExpenseAdded: () -> Unit
) {
    val members by viewModel.selectedGroupMembers.collectAsState()
    val validationError by viewModel.validationError.collectAsState()

    var description by remember { mutableStateOf("") }
    var amountStr by remember { mutableStateOf("") }
    val amount = amountStr.toDoubleOrNull() ?: 0.0

    var selectedPayerId by remember { mutableStateOf<String?>(null) }
    var dropdownExpanded by remember { mutableStateOf(false) }

    var splitType by remember { mutableStateOf("EQUAL") } // EQUAL vs EXACT

    var transactionDate by remember { mutableStateOf(System.currentTimeMillis()) }
    var selectedCurrency by remember { mutableStateOf("USD") }
    var currencyDropdownExpanded by remember { mutableStateOf(false) }

    val currencySymbol = remember(selectedCurrency) {
        when (selectedCurrency) {
            "USD" -> "$"
            "EUR" -> "€"
            "GBP" -> "£"
            "INR" -> "₹"
            "JPY" -> "¥"
            "CAD" -> "C$"
            "AUD" -> "A$"
            else -> "$"
        }
    }

    val context = LocalContext.current
    val dateFormatter = remember { SimpleDateFormat("MMM dd, yyyy", Locale.getDefault()) }

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
                viewModel.clearValidationError()
            },
            currentCal.get(Calendar.YEAR),
            currentCal.get(Calendar.MONTH),
            currentCal.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    // For EQUAL splits: participating member ids
    val equalSelections = remember { mutableStateMapOf<String, Boolean>() }
    // Initialize equalSelections with all members when they finish loading
    LaunchedEffect(members) {
        members.forEach { member ->
            if (!equalSelections.containsKey(member.id)) {
                equalSelections[member.id] = true
            }
        }
    }

    // For EXACT splits: member id to custom portion amount
    val exactInputs = remember { mutableStateMapOf<String, String>() }

    // Clear validation state on setup
    LaunchedEffect(Unit) {
        viewModel.clearValidationError()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Log New Expense", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("back_button_expense")) {
                        Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Go Back")
                    }
                }
            )
        },
        bottomBar = {
            Button(
                onClick = {
                    val payerId = selectedPayerId ?: ""

                    val exactDistribution = exactInputs.mapValues { (_, value) ->
                        value.toDoubleOrNull() ?: 0.0
                    }

                    val activeEqualMembers = equalSelections.filter { it.value }.keys.toList()

                    viewModel.addExpense(
                        description = description,
                        amount = amount,
                        paidById = payerId,
                        splitType = splitType,
                        splitDistribution = exactDistribution,
                        selectedMembersForEqualSplit = activeEqualMembers,
                        timestamp = transactionDate,
                        currency = selectedCurrency,
                        onSuccess = onExpenseAdded
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .height(52.dp)
                    .testTag("submit_expense_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Save Expense", fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Validation header info banner
            item {
                validationError?.let { err ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MaterialTheme.colorScheme.errorContainer)
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ErrorOutline,
                            contentDescription = "Error notification",
                            tint = MaterialTheme.colorScheme.onErrorContainer
                        )
                        Text(
                            text = err,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            // Description, Amount, and Payer inside a unified beautiful Card
            item {
                Card(
                    shape = RoundedCornerShape(24.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = androidx.compose.foundation.BorderStroke(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = "EXPENSE DETAILS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.primary,
                            letterSpacing = 1.sp
                        )

                        OutlinedTextField(
                            value = description,
                            onValueChange = {
                                description = it
                                viewModel.clearValidationError()
                            },
                            label = { Text("What was this for? (e.g., Dinner, Groceries)") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("input_expense_desc"),
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp)
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            OutlinedTextField(
                                value = amountStr,
                                onValueChange = {
                                    amountStr = it
                                    viewModel.clearValidationError()
                                },
                                label = { Text("Amount ($currencySymbol)") },
                                leadingIcon = {
                                    Text(
                                        text = currencySymbol,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(start = 12.dp)
                                    )
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier
                                    .weight(1f)
                                    .testTag("input_expense_amount"),
                                singleLine = true,
                                shape = RoundedCornerShape(14.dp)
                            )

                            // Paid By dropdown menu
                            Box(modifier = Modifier.weight(1.2f)) {
                                val selectedPayer = members.find { it.id == selectedPayerId }
                                OutlinedTextField(
                                    value = selectedPayer?.name ?: "Select Payer",
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Paid By") },
                                    leadingIcon = { Icon(Icons.Default.Payment, contentDescription = null) },
                                    trailingIcon = {
                                        IconButton(onClick = { dropdownExpanded = true }) {
                                            Icon(
                                                imageVector = Icons.Default.ArrowDropDown,
                                                contentDescription = "Dropdown Selection"
                                            )
                                        }
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { dropdownExpanded = true }
                                        .testTag("payer_dropdown_trigger"),
                                    shape = RoundedCornerShape(14.dp)
                                )

                                DropdownMenu(
                                    expanded = dropdownExpanded,
                                    onDismissRequest = { dropdownExpanded = false },
                                    modifier = Modifier.testTag("payer_dropdown_menu")
                                ) {
                                    members.forEach { m ->
                                        DropdownMenuItem(
                                            text = { Text(m.name, fontWeight = FontWeight.Bold) },
                                            onClick = {
                                                selectedPayerId = m.id
                                                dropdownExpanded = false
                                                viewModel.clearValidationError()
                                            },
                                            modifier = Modifier.testTag("payer_item_${m.id}")
                                        )
                                    }
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            // Date selector
                            Box(modifier = Modifier.weight(1f)) {
                                OutlinedTextField(
                                    value = dateFormatter.format(Date(transactionDate)),
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Date") },
                                    leadingIcon = {
                                        Icon(
                                            imageVector = Icons.Default.CalendarToday,
                                            contentDescription = "Pick Date"
                                        )
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag("input_expense_date"),
                                    shape = RoundedCornerShape(14.dp)
                                )
                                Box(
                                    modifier = Modifier
                                        .matchParentSize()
                                        .clickable { showDatePicker() }
                                )
                            }

                            // Currency selector
                            Box(modifier = Modifier.weight(1.2f)) {
                                OutlinedTextField(
                                    value = selectedCurrency,
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Currency") },
                                    leadingIcon = {
                                        Text(
                                            text = currencySymbol,
                                            fontWeight = FontWeight.Bold,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(start = 12.dp)
                                        )
                                    },
                                    trailingIcon = {
                                        IconButton(onClick = { currencyDropdownExpanded = true }) {
                                            Icon(
                                                imageVector = Icons.Default.ArrowDropDown,
                                                contentDescription = "Dropdown Selection"
                                            )
                                        }
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { currencyDropdownExpanded = true }
                                        .testTag("currency_dropdown_trigger"),
                                    shape = RoundedCornerShape(14.dp)
                                )

                                DropdownMenu(
                                    expanded = currencyDropdownExpanded,
                                    onDismissRequest = { currencyDropdownExpanded = false },
                                    modifier = Modifier.testTag("currency_dropdown_menu")
                                ) {
                                    val currencies = listOf(
                                        "USD" to "USD ($)",
                                        "EUR" to "EUR (€)",
                                        "GBP" to "GBP (£)",
                                        "INR" to "INR (₹)",
                                        "JPY" to "JPY (¥)",
                                        "CAD" to "CAD (C$)",
                                        "AUD" to "AUD (A$)"
                                    )
                                    currencies.forEach { (code, label) ->
                                        DropdownMenuItem(
                                            text = { Text(label, fontWeight = FontWeight.Bold) },
                                            onClick = {
                                                selectedCurrency = code
                                                currencyDropdownExpanded = false
                                                viewModel.clearValidationError()
                                            },
                                            modifier = Modifier.testTag("currency_item_$code")
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Split Type configuration buttons
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    val equalSelected = splitType == "EQUAL"
                    val exactSelected = splitType == "EXACT"

                    Button(
                        onClick = {
                            splitType = "EQUAL"
                            viewModel.clearValidationError()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (equalSelected) MaterialTheme.colorScheme.primary else Color.Transparent,
                            contentColor = if (equalSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(40.dp)
                            .testTag("split_equal_btn"),
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Text("Split Equally", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            splitType = "EXACT"
                            viewModel.clearValidationError()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (exactSelected) MaterialTheme.colorScheme.primary else Color.Transparent,
                            contentColor = if (exactSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(40.dp)
                            .testTag("split_exact_btn"),
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Text("Split Exactly", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }

            // Header explaining current Split methodology
            item {
                val subLabel = if (splitType == "EQUAL") {
                    "Who is included in this purchase? Choose anyone participating."
                } else {
                    "Type the exact amount of dollars that each member is responsible for."
                }
                Text(
                    text = subLabel,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            }

            // SPLIT EQUALLY LIST
            if (splitType == "EQUAL") {
                val selectedCount = equalSelections.filter { it.value }.size
                val perPersonEst = if (selectedCount > 0) amount / selectedCount else 0.0

                items(members) { member ->
                    val isChecked = equalSelections[member.id] ?: true
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = if (isChecked) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surface
                        ),
                        border = androidx.compose.foundation.BorderStroke(
                            width = 1.dp,
                            color = if (isChecked) MaterialTheme.colorScheme.primary.copy(alpha = 0.3f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
                        ),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    equalSelections[member.id] = !isChecked
                                    viewModel.clearValidationError()
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Checkbox(
                                    checked = isChecked,
                                    onCheckedChange = {
                                        equalSelections[member.id] = it
                                        viewModel.clearValidationError()
                                    },
                                    modifier = Modifier.testTag("equal_checkbox_${member.id}")
                                )
                                Text(member.name, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                            }

                            if (isChecked) {
                                Text(
                                    text = "$currencySymbol${String.format("%.2f", perPersonEst)}",
                                    fontWeight = FontWeight.Black,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontSize = 15.sp
                                )
                            } else {
                                Text(
                                    text = "${currencySymbol}0.00",
                                    color = MaterialTheme.colorScheme.secondary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }
            } else {
                // SPLIT EXACTLY
                val totalPortions = exactInputs.map { (_, str) -> str.toDoubleOrNull() ?: 0.0 }.sum()
                val diff = amount - totalPortions
                val matchesTotal = Math.abs(diff) < 0.02

                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(
                                if (matchesTotal) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                                else MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)
                            )
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = if (matchesTotal) Icons.Default.Check else Icons.Default.Info,
                                contentDescription = null,
                                tint = if (matchesTotal) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = if (matchesTotal) "Split matches total perfectly!" else "Portion differences:",
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                                color = if (matchesTotal) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onErrorContainer
                            )
                        }

                        Text(
                            text = if (matchesTotal) "Matches 100%" else "Diff: $currencySymbol${String.format("%.2f", diff)}",
                            fontWeight = FontWeight.Black,
                            fontSize = 12.sp,
                            color = if (matchesTotal) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                        )
                    }
                }

                items(members) { member ->
                    val customVal = exactInputs[member.id] ?: ""
                    Card(
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = androidx.compose.foundation.BorderStroke(
                            width = 1.dp,
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                        ),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = member.name,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f)
                            )

                            OutlinedTextField(
                                value = customVal,
                                onValueChange = {
                                    exactInputs[member.id] = it
                                    viewModel.clearValidationError()
                                },
                                placeholder = { Text("0.00", fontSize = 12.sp) },
                                leadingIcon = {
                                    Text(
                                        text = currencySymbol,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary,
                                        fontSize = 14.sp
                                    )
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                singleLine = true,
                                modifier = Modifier
                                    .width(132.dp)
                                    .testTag("exact_portion_${member.id}"),
                                shape = RoundedCornerShape(12.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
