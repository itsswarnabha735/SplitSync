package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.SplitSyncViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateGroupScreen(
    viewModel: SplitSyncViewModel,
    onBackClick: () -> Unit,
    onGroupCreated: (String) -> Unit
) {
    var groupName by remember { mutableStateOf("") }
    var groupDescription by remember { mutableStateOf("") }

    // Start with 2 members, with the creator ("You") as the first member by default
    val members = remember { mutableStateListOf("You", "") }
    val validationError by viewModel.validationError.collectAsState()
    val friendsState by viewModel.allFriendsWithBalances.collectAsState()
    val registeredFriends = friendsState.map { it.friend }

    // Clear validation state on setup
    LaunchedEffect(Unit) {
        viewModel.clearValidationError()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Create New Group", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("back_button")) {
                        Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Go Back")
                    }
                }
            )
        },
        bottomBar = {
            Button(
                onClick = {
                    viewModel.createGroup(
                        name = groupName,
                        description = groupDescription,
                        memberNames = members.toList(),
                        onSuccess = onGroupCreated
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .height(52.dp)
                    .testTag("submit_group_button"),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Create Group", fontSize = 16.sp, fontWeight = FontWeight.Bold)
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
            // Animated Form validation error display
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

            // Group core details fields
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
                            text = "GROUP PROFILE",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.primary,
                            letterSpacing = 1.sp
                        )

                        OutlinedTextField(
                            value = groupName,
                            onValueChange = {
                                groupName = it
                                viewModel.clearValidationError()
                            },
                            label = { Text("Group Name (e.g., Euro Trip, Apartment 4B)") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("input_group_name"),
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp)
                        )

                        OutlinedTextField(
                            value = groupDescription,
                            onValueChange = { groupDescription = it },
                            label = { Text("Description (Optional)") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("input_group_description"),
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Group Members",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Min 2 people required to split bills",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }

                    TextButton(
                        onClick = {
                            members.add("")
                            viewModel.clearValidationError()
                        },
                        modifier = Modifier.testTag("add_member_field_button")
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Add Member", fontWeight = FontWeight.Bold)
                    }
                }
            }

            // Dynamic listed member input blocks
            itemsIndexed(members) { index, memberName ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        var expanded by remember { mutableStateOf(false) }

                        OutlinedTextField(
                            value = memberName,
                            onValueChange = {},
                            readOnly = true,
                            label = { 
                                Text(
                                    if (index == 0) "Group Creator (You)" else "Member ${index + 1} Name"
                                ) 
                            },
                            placeholder = { Text("Select registered user") },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.PersonOutline,
                                    contentDescription = null,
                                    tint = if (index == 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
                                )
                            },
                            trailingIcon = if (index == 0) {
                                null
                            } else {
                                {
                                    IconButton(onClick = { expanded = true }) {
                                        Icon(
                                            imageVector = Icons.Default.ArrowDropDown,
                                            contentDescription = "Expand Member Dropdown",
                                            tint = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                }
                            },
                            modifier = if (index == 0) {
                                Modifier
                                    .fillMaxWidth()
                                    .testTag("input_member_name_$index")
                            } else {
                                Modifier
                                    .fillMaxWidth()
                                    .clickable { expanded = true }
                                    .testTag("input_member_name_$index")
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp)
                        )

                        if (index > 0) {
                            DropdownMenu(
                                expanded = expanded,
                                onDismissRequest = { expanded = false },
                                modifier = Modifier.testTag("member_dropdown_$index")
                            ) {
                                if (registeredFriends.isEmpty()) {
                                    DropdownMenuItem(
                                        text = { Text("No friends registered yet", style = MaterialTheme.typography.bodyMedium) },
                                        onClick = {},
                                        enabled = false
                                    )
                                } else {
                                    // Include "You" option
                                    val isYouSelected = members.contains("You")
                                    if (!isYouSelected || memberName == "You") {
                                        DropdownMenuItem(
                                            text = { Text("You (Creator)", fontWeight = FontWeight.Bold) },
                                            onClick = {
                                                members[index] = "You"
                                                expanded = false
                                                viewModel.clearValidationError()
                                            },
                                            modifier = Modifier.testTag("member_option_you_$index")
                                        )
                                    }

                                    // Include actual registered Friends list
                                    registeredFriends.forEach { friend ->
                                        val isFriendSelected = members.contains(friend.name)
                                        if (!isFriendSelected || memberName == friend.name) {
                                            DropdownMenuItem(
                                                text = { Text(friend.name) },
                                                onClick = {
                                                    members[index] = friend.name
                                                    expanded = false
                                                    viewModel.clearValidationError()
                                                },
                                                modifier = Modifier.testTag("member_option_${friend.id}_$index")
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Allow clearing only if we have more than 2 members, and never delete index 0 (the creator)
                    if (members.size > 2 && index > 0) {
                        IconButton(
                            onClick = {
                                members.removeAt(index)
                                viewModel.clearValidationError()
                            },
                            modifier = Modifier.testTag("delete_member_field_$index")
                        ) {
                            Icon(
                                imageVector = Icons.Default.DeleteOutline,
                                contentDescription = "Delete Member Field",
                                tint = MaterialTheme.colorScheme.tertiary
                            )
                        }
                    }
                }
            }
        }
    }
}
