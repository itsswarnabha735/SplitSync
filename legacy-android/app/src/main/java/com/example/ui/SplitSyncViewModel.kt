package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.example.data.model.*
import com.example.data.repository.SplitSyncRepository
import com.example.logic.DebtSimplifier
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

/**
 * Top-level view-model wired against a [SplitSyncRepository] that is already
 * scoped to the signed-in user's uid. Construct via [SplitSyncViewModel.factory].
 */
class SplitSyncViewModel(
    application: Application,
    private val repository: SplitSyncRepository,
    private val currentUserName: String
) : AndroidViewModel(application) {

    val currentUid: String get() = repository.currentUid

    init {
        viewModelScope.launch { repository.seedDemoIfEmpty() }
    }

    val allGroups: StateFlow<List<Group>> = repository.allGroups
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // --- AD-HOC PEER-TO-PEER LEDGER FLOWS ---
    val allFriendsWithBalances: StateFlow<List<FriendWithBalance>> = repository.getFriendsWithBalancesFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val adHocExpenses: StateFlow<List<AdHocExpense>> = repository.getAdHocExpensesFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val adHocPayments: StateFlow<List<AdHocPayment>> = repository.getAdHocPaymentsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allAdHocSplits: StateFlow<List<AdHocSplit>> = repository.getAllAdHocSplitsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val allGroupBalances: StateFlow<List<MemberBalanceInfo>> = repository.getAllGroupBalancesFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val pendingInvites: StateFlow<List<GroupInvite>> = repository.getMyInvitesFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    // Aggregated cross-ledger stats: a member counts as "you" when their
    // linkedUid matches the currently signed-in user. Friend-side balances
    // are inherently scoped to the user already.
    val youAreOwedTotal: StateFlow<Map<String, Double>> = combine(allFriendsWithBalances, allGroupBalances) { friends, groupBalances ->
        val result = mutableMapOf<String, Double>()
        friends.filter { it.netBalance > 0.0 }.forEach {
            result[it.currency] = (result[it.currency] ?: 0.0) + it.netBalance
        }
        groupBalances.filter { it.netBalance > 0.0 && it.member.linkedUid == currentUid }.forEach {
            result[it.currency] = (result[it.currency] ?: 0.0) + it.netBalance
        }
        result
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyMap())

    val youOweTotal: StateFlow<Map<String, Double>> = combine(allFriendsWithBalances, allGroupBalances) { friends, groupBalances ->
        val result = mutableMapOf<String, Double>()
        friends.filter { it.netBalance < 0.0 }.forEach {
            result[it.currency] = (result[it.currency] ?: 0.0) + (-it.netBalance)
        }
        groupBalances.filter { it.netBalance < 0.0 && it.member.linkedUid == currentUid }.forEach {
            result[it.currency] = (result[it.currency] ?: 0.0) + (-it.netBalance)
        }
        result
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyMap())

    val netBalanceTotal: StateFlow<Map<String, Double>> = combine(youAreOwedTotal, youOweTotal) { owed, owe ->
        val result = mutableMapOf<String, Double>()
        (owed.keys + owe.keys).distinct().forEach { currency ->
            val o = owed[currency] ?: 0.0
            val w = owe[currency] ?: 0.0
            result[currency] = o - w
        }
        result
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyMap())

    private val _selectedGroupId = MutableStateFlow<String?>(null)
    val selectedGroupId: StateFlow<String?> = _selectedGroupId.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    val selectedGroup: StateFlow<Group?> = _selectedGroupId
        .flatMapLatest { id -> if (id != null) repository.getGroupById(id) else flowOf(null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(ExperimentalCoroutinesApi::class)
    val selectedGroupMembers: StateFlow<List<GroupMember>> = _selectedGroupId
        .flatMapLatest { id -> if (id != null) repository.getMembersByGroupId(id) else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val selectedGroupExpenses: StateFlow<List<Expense>> = _selectedGroupId
        .flatMapLatest { id -> if (id != null) repository.getExpensesByGroupId(id) else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val selectedGroupPayments: StateFlow<List<Payment>> = _selectedGroupId
        .flatMapLatest { id -> if (id != null) repository.getPaymentsByGroupId(id) else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val memberBalances: StateFlow<List<MemberBalanceInfo>> = _selectedGroupId
        .flatMapLatest { id -> if (id != null) repository.getMemberBalancesFlow(id) else flowOf(emptyList()) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val simplifiedDebts: StateFlow<List<DebtOverview>> = memberBalances
        .map { balances -> DebtSimplifier.simplifyDebts(balances) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _validationError = MutableStateFlow<String?>(null)
    val validationError: StateFlow<String?> = _validationError.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    fun selectGroup(groupId: String?) {
        _selectedGroupId.value = groupId
        clearValidationError()
    }

    fun clearValidationError() { _validationError.value = null }

    // ---- ACTIONS ----

    fun createGroup(name: String, description: String, memberNames: List<String>, onSuccess: (String) -> Unit) {
        if (name.isBlank()) {
            _validationError.value = "Group name cannot be empty."
            return
        }
        val cleanMembers = memberNames.filter { it.isNotBlank() }.toMutableList()
        if (!cleanMembers.any { it.equals("You", ignoreCase = true) }) {
            cleanMembers.add(0, "You")
        }
        if (cleanMembers.size < 2) {
            _validationError.value = "A group must have at least 2 members."
            return
        }
        viewModelScope.launch {
            _isSyncing.value = true
            val groupId = repository.createGroupWithMembers(name.trim(), description.trim(), cleanMembers)
            _isSyncing.value = false
            onSuccess(groupId)
        }
    }

    fun deleteGroup(group: Group, onSuccess: () -> Unit) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deleteGroup(group)
            if (_selectedGroupId.value == group.id) _selectedGroupId.value = null
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun addExpense(
        description: String,
        amount: Double,
        paidById: String,
        splitType: String,
        splitDistribution: Map<String, Double>,
        selectedMembersForEqualSplit: List<String>,
        timestamp: Long = System.currentTimeMillis(),
        currency: String = "USD",
        onSuccess: () -> Unit
    ) {
        if (description.isBlank()) { _validationError.value = "Description cannot be empty."; return }
        if (amount <= 0.0) { _validationError.value = "Amount must be greater than 0."; return }
        if (paidById.isBlank()) { _validationError.value = "Please select who paid for the expense."; return }

        val splits = mutableListOf<Pair<String, Double>>()

        if (splitType == "EQUAL") {
            val participating = selectedMembersForEqualSplit
            if (participating.isEmpty()) {
                _validationError.value = "Please select at least one member to split with."
                return
            }
            val splitAmount = Math.round((amount / participating.size) * 100.0) / 100.0
            var remainingDiff = amount - (splitAmount * participating.size)
            participating.forEach { memberId ->
                val adjustment = when {
                    remainingDiff > 0.01 -> { remainingDiff -= 0.01; 0.01 }
                    remainingDiff < -0.01 -> { remainingDiff += 0.01; -0.01 }
                    else -> 0.0
                }
                splits.add(memberId to (splitAmount + adjustment))
            }
        } else {
            val sum = splitDistribution.values.sum()
            if (Math.abs(sum - amount) > 0.02) {
                _validationError.value = "Sum of split amounts ($${String.format("%.2f", sum)}) must equal total amount ($${String.format("%.2f", amount)})."
                return
            }
            splitDistribution.forEach { (memberId, customAmount) ->
                if (customAmount > 0.0) splits.add(memberId to customAmount)
            }
            if (splits.isEmpty()) {
                _validationError.value = "Please specify exact split portions."
                return
            }
        }

        _validationError.value = null
        val groupId = _selectedGroupId.value ?: return

        viewModelScope.launch {
            _isSyncing.value = true
            repository.createExpenseWithSplits(
                groupId = groupId,
                description = description.trim(),
                amount = amount,
                paidById = paidById,
                splitType = splitType,
                splits = splits,
                timestamp = timestamp,
                currency = currency
            )
            kotlinx.coroutines.delay(200)
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun deleteExpense(expense: Expense) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deleteExpense(expense)
            _isSyncing.value = false
        }
    }

    fun recordManualSettlement(
        fromMemberId: String,
        toMemberId: String,
        amount: Double,
        currency: String = "USD",
        onSuccess: () -> Unit
    ) {
        if (fromMemberId.isBlank() || toMemberId.isBlank()) {
            _validationError.value = "Sender and recipient must be selected."
            return
        }
        if (fromMemberId == toMemberId) {
            _validationError.value = "A member cannot pay themselves."
            return
        }
        if (amount <= 0.0) {
            _validationError.value = "Amount must be greater than 0."
            return
        }
        val groupId = _selectedGroupId.value ?: return

        viewModelScope.launch {
            _isSyncing.value = true
            val payment = Payment(
                groupId = groupId,
                fromMemberId = fromMemberId,
                toMemberId = toMemberId,
                amount = amount,
                currency = currency
            )
            repository.recordPayment(payment)
            kotlinx.coroutines.delay(150)
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun deletePayment(payment: Payment) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deletePayment(payment)
            _isSyncing.value = false
        }
    }

    fun triggerManualSync() {
        viewModelScope.launch {
            _isSyncing.value = true
            kotlinx.coroutines.delay(600)
            _isSyncing.value = false
        }
    }

    // ---- AD-HOC ACTIONS ----

    fun createFriend(name: String, email: String, phone: String, onSuccess: () -> Unit) {
        if (name.isBlank()) {
            _validationError.value = "Friend name cannot be empty."
            return
        }
        _validationError.value = null
        viewModelScope.launch {
            _isSyncing.value = true
            repository.createFriend(name, email, phone)
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun deleteFriend(friend: Friend) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deleteFriend(friend)
            _isSyncing.value = false
        }
    }

    fun addAdHocExpense(
        description: String,
        amount: Double,
        paidByFriendId: String,
        splitType: String,
        splitDistribution: Map<String, Double>,
        selectedParticipantsForEqualSplit: List<String>,
        currency: String = "USD",
        timestamp: Long = System.currentTimeMillis(),
        onSuccess: () -> Unit
    ) {
        if (description.isBlank()) { _validationError.value = "Description cannot be empty."; return }
        if (amount <= 0.0) { _validationError.value = "Amount must be greater than 0."; return }

        val splits = mutableListOf<Pair<String, Double>>()
        if (splitType == "EQUAL") {
            val participating = selectedParticipantsForEqualSplit
            if (participating.isEmpty()) {
                _validationError.value = "Please select at least one participant."
                return
            }
            val splitAmount = Math.round((amount / participating.size) * 100.0) / 100.0
            var remainingDiff = amount - (splitAmount * participating.size)
            participating.forEach { participantId ->
                val adjustment = when {
                    remainingDiff > 0.01 -> { remainingDiff -= 0.01; 0.01 }
                    remainingDiff < -0.01 -> { remainingDiff += 0.01; -0.01 }
                    else -> 0.0
                }
                splits.add(participantId to (splitAmount + adjustment))
            }
        } else {
            val sum = splitDistribution.values.sum()
            if (Math.abs(sum - amount) > 0.02) {
                _validationError.value = "Sum of split portions ($${String.format("%.2f", sum)}) must equal total ($${String.format("%.2f", amount)})."
                return
            }
            splitDistribution.forEach { (participantId, customAmount) ->
                if (customAmount > 0.0) splits.add(participantId to customAmount)
            }
            if (splits.isEmpty()) {
                _validationError.value = "Please enter exact split portions."
                return
            }
        }

        _validationError.value = null
        viewModelScope.launch {
            _isSyncing.value = true
            repository.createAdHocExpenseWithSplits(
                description = description.trim(),
                amount = amount,
                paidByFriendId = paidByFriendId,
                splitType = splitType,
                splits = splits,
                currency = currency,
                timestamp = timestamp
            )
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun deleteAdHocExpense(expense: AdHocExpense) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deleteAdHocExpense(expense)
            _isSyncing.value = false
        }
    }

    fun recordAdHocPayment(
        fromFriendId: String,
        toFriendId: String,
        amount: Double,
        currency: String = "USD",
        timestamp: Long = System.currentTimeMillis(),
        onSuccess: () -> Unit
    ) {
        if (fromFriendId == toFriendId) {
            _validationError.value = "Sender and receiver cannot be the same."
            return
        }
        if (amount <= 0.0) {
            _validationError.value = "Amount must be greater than 0."
            return
        }
        _validationError.value = null
        viewModelScope.launch {
            _isSyncing.value = true
            val payment = AdHocPayment(
                fromFriendId = fromFriendId,
                toFriendId = toFriendId,
                amount = amount,
                currency = currency,
                timestamp = timestamp
            )
            repository.recordAdHocPayment(payment)
            _isSyncing.value = false
            onSuccess()
        }
    }

    fun deleteAdHocPayment(payment: AdHocPayment) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.deleteAdHocPayment(payment)
            _isSyncing.value = false
        }
    }

    // ---- Group invitations ----

    fun inviteMemberToGroup(group: Group, email: String, onResult: (Boolean) -> Unit) {
        if (email.isBlank()) {
            _validationError.value = "Email is required."
            onResult(false); return
        }
        viewModelScope.launch {
            _isSyncing.value = true
            val ok = try {
                repository.inviteToGroupByEmail(group, email, currentUserName)
            } catch (t: Throwable) {
                _validationError.value = t.message
                false
            }
            _isSyncing.value = false
            if (!ok && _validationError.value == null) {
                _validationError.value = "No SplitSync user found with that email."
            }
            onResult(ok)
        }
    }

    fun acceptInvite(invite: GroupInvite, userEmail: String) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.acceptInvite(invite, currentUserName, userEmail)
            _isSyncing.value = false
        }
    }

    fun declineInvite(invite: GroupInvite) {
        viewModelScope.launch {
            _isSyncing.value = true
            repository.declineInvite(invite)
            _isSyncing.value = false
        }
    }

    companion object {
        fun factory(uid: String, displayName: String): ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val app = this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as Application
                SplitSyncViewModel(
                    application = app,
                    repository = SplitSyncRepository(currentUid = uid),
                    currentUserName = displayName
                )
            }
        }
    }
}
