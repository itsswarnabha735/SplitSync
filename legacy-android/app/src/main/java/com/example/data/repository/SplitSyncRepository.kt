package com.example.data.repository

import com.example.data.model.*
import com.example.logic.DebtSimplifier
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/**
 * Single source of truth for SplitSync. Backs the entire ViewModel with Cloud
 * Firestore. The class keeps its old name ("SplitSyncRepository") and the same
 * shape of Flow-returning queries / suspend writers that the ViewModel already
 * consumed, so the migration from Room is contained behind this seam.
 *
 * `currentUid` is the FirebaseAuth uid of the currently signed-in user. All
 * per-user (ad-hoc) reads and writes are scoped to `/users/{currentUid}/...`.
 */
class SplitSyncRepository(
    val currentUid: String,
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()
) {

    // -----------------------------------------------------------------------
    // Path helpers
    // -----------------------------------------------------------------------
    private fun groupsRef() = firestore.collection("groups")
    private fun groupDoc(groupId: String) = groupsRef().document(groupId)
    private fun membersRef(groupId: String) = groupDoc(groupId).collection("members")
    private fun expensesRef(groupId: String) = groupDoc(groupId).collection("expenses")
    private fun paymentsRef(groupId: String) = groupDoc(groupId).collection("payments")

    private fun userDoc(uid: String = currentUid) = firestore.collection("users").document(uid)
    private fun friendsRef() = userDoc().collection("friends")
    private fun adhocExpensesRef() = userDoc().collection("adhocExpenses")
    private fun adhocPaymentsRef() = userDoc().collection("adhocPayments")
    private fun groupInvitesRef() = userDoc().collection("groupInvites")

    // -----------------------------------------------------------------------
    // Generic snapshot -> Flow plumbing
    // -----------------------------------------------------------------------
    private inline fun <reified T : Any> Query.asFlow(
        crossinline mapper: (DocumentSnapshot) -> T?
    ): Flow<List<T>> = callbackFlow {
        val reg = addSnapshotListener { snap, err ->
            if (err != null) { close(err); return@addSnapshotListener }
            val items = snap?.documents?.mapNotNull(mapper).orEmpty()
            trySend(items)
        }
        awaitClose { reg.remove() }
    }

    private fun docToGroup(d: DocumentSnapshot): Group? =
        d.toObject(Group::class.java)?.apply { id = d.id }

    private fun docToMember(d: DocumentSnapshot): GroupMember? =
        d.toObject(GroupMember::class.java)?.apply { id = d.id }

    private fun docToExpense(d: DocumentSnapshot): Expense? =
        d.toObject(Expense::class.java)?.apply { id = d.id }

    private fun docToPayment(d: DocumentSnapshot): Payment? =
        d.toObject(Payment::class.java)?.apply { id = d.id }

    private fun docToFriend(d: DocumentSnapshot): Friend? =
        d.toObject(Friend::class.java)?.apply { id = d.id }

    private fun docToAdHocExpense(d: DocumentSnapshot): AdHocExpense? =
        d.toObject(AdHocExpense::class.java)?.apply { id = d.id }

    private fun docToAdHocPayment(d: DocumentSnapshot): AdHocPayment? =
        d.toObject(AdHocPayment::class.java)?.apply { id = d.id }

    private fun docToInvite(d: DocumentSnapshot): GroupInvite? =
        d.toObject(GroupInvite::class.java)?.apply { id = d.id }

    // -----------------------------------------------------------------------
    // Group queries (multi-user shared, scoped via memberUids array-contains)
    // -----------------------------------------------------------------------
    val allGroups: Flow<List<Group>> = groupsRef()
        .whereArrayContains("memberUids", currentUid)
        .orderBy("createdAt", Query.Direction.DESCENDING)
        .asFlow(::docToGroup)

    fun getGroupById(groupId: String): Flow<Group?> = callbackFlow {
        val reg = groupDoc(groupId).addSnapshotListener { snap, err ->
            if (err != null) { close(err); return@addSnapshotListener }
            trySend(snap?.let(::docToGroup))
        }
        awaitClose { reg.remove() }
    }

    fun getMembersByGroupId(groupId: String): Flow<List<GroupMember>> =
        membersRef(groupId).asFlow(::docToMember)

    fun getExpensesByGroupId(groupId: String): Flow<List<Expense>> =
        expensesRef(groupId)
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .asFlow(::docToExpense)

    fun getPaymentsByGroupId(groupId: String): Flow<List<Payment>> =
        paymentsRef(groupId)
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .asFlow(::docToPayment)

    // -----------------------------------------------------------------------
    // Group writes
    // -----------------------------------------------------------------------

    /**
     * Creates a group and its initial members in one atomic batch.
     * The creator (the signed-in user) is always added as a member with their
     * uid as `linkedUid`, and their uid is included in `memberUids` so they
     * pass the access rule.
     */
    suspend fun createGroupWithMembers(
        groupName: String,
        description: String,
        memberNames: List<String>
    ): String {
        val cleaned = memberNames.map { it.trim() }.filter { it.isNotBlank() }
        val groupRef = groupsRef().document()
        val groupId = groupRef.id

        val batch = firestore.batch()
        val group = Group(
            id = groupId,
            name = groupName.trim(),
            description = description.trim(),
            createdAt = System.currentTimeMillis(),
            createdBy = currentUid,
            memberUids = listOf(currentUid)
        )
        batch.set(groupRef, group)

        cleaned.forEach { name ->
            val memberRef = membersRef(groupId).document()
            val isCreator = name.equals("You", ignoreCase = true)
            val member = GroupMember(
                id = memberRef.id,
                groupId = groupId,
                name = if (isCreator) "You" else name,
                linkedUid = if (isCreator) currentUid else ""
            )
            batch.set(memberRef, member)
        }
        batch.commit().await()
        return groupId
    }

    /**
     * Creates an expense and embeds its splits in a single document write.
     */
    suspend fun createExpenseWithSplits(
        groupId: String,
        description: String,
        amount: Double,
        paidById: String,
        splitType: String,
        splits: List<Pair<String, Double>>,
        timestamp: Long = System.currentTimeMillis(),
        currency: String = "USD"
    ) {
        val ref = expensesRef(groupId).document()
        val expense = Expense(
            id = ref.id,
            groupId = groupId,
            description = description.trim(),
            amount = amount,
            paidById = paidById,
            splitType = splitType,
            timestamp = timestamp,
            currency = currency,
            splits = splits.toMap()
        )
        ref.set(expense).await()
    }

    suspend fun deleteExpense(expense: Expense) {
        if (expense.id.isBlank() || expense.groupId.isBlank()) return
        expensesRef(expense.groupId).document(expense.id).delete().await()
    }

    suspend fun recordPayment(payment: Payment) {
        val ref = paymentsRef(payment.groupId).document()
        val withId = payment.copy(id = ref.id)
        ref.set(withId).await()
    }

    suspend fun deletePayment(payment: Payment) {
        if (payment.id.isBlank() || payment.groupId.isBlank()) return
        paymentsRef(payment.groupId).document(payment.id).delete().await()
    }

    /**
     * Deletes a group and every subcollection underneath (members, expenses,
     * payments). Firestore has no native cascade so we fan out the deletes.
     */
    suspend fun deleteGroup(group: Group) {
        if (group.id.isBlank()) return
        val gid = group.id
        val members = membersRef(gid).get().await().documents
        val expenses = expensesRef(gid).get().await().documents
        val payments = paymentsRef(gid).get().await().documents

        val batch = firestore.batch()
        members.forEach { batch.delete(it.reference) }
        expenses.forEach { batch.delete(it.reference) }
        payments.forEach { batch.delete(it.reference) }
        batch.delete(groupDoc(gid))
        batch.commit().await()
    }

    // -----------------------------------------------------------------------
    // Group balance composition
    // -----------------------------------------------------------------------

    fun getMemberBalancesFlow(groupId: String): Flow<List<MemberBalanceInfo>> =
        combine(
            getMembersByGroupId(groupId),
            getExpensesByGroupId(groupId),
            getPaymentsByGroupId(groupId)
        ) { members, expenses, payments ->
            calculateBalances(members, expenses, payments)
        }

    /**
     * Across-groups balance flow used by the cross-group "You are owed" /
     * "You owe" aggregates on the dashboard. Snapshots all groups the user
     * belongs to and combines their member/expense/payment streams. Only the
     * "You" rows on the dashboard reference this, so its O(groups) listener
     * cost is acceptable.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun getAllGroupBalancesFlow(): Flow<List<MemberBalanceInfo>> =
        allGroups.flatMapLatest { groups ->
            if (groups.isEmpty()) flowOf(emptyList())
            else combine(groups.map { g -> getMemberBalancesFlow(g.id) }) { perGroup ->
                perGroup.toList().flatten()
            }
        }

    private fun calculateBalances(
        members: List<GroupMember>,
        expenses: List<Expense>,
        payments: List<Payment>
    ): List<MemberBalanceInfo> {
        val currencies = (expenses.map { it.currency } + payments.map { it.currency })
            .distinct()
            .ifEmpty { listOf("USD") }
        val result = mutableListOf<MemberBalanceInfo>()

        for (cur in currencies) {
            for (member in members) {
                val paidAmount = expenses
                    .filter { it.paidById == member.id && it.currency == cur }
                    .sumOf { it.amount }

                val owedAmount = expenses
                    .filter { it.currency == cur }
                    .sumOf { it.splits[member.id] ?: 0.0 }

                val sentPayments = payments
                    .filter { it.fromMemberId == member.id && it.currency == cur }
                    .sumOf { it.amount }

                val receivedPayments = payments
                    .filter { it.toMemberId == member.id && it.currency == cur }
                    .sumOf { it.amount }

                result.add(
                    MemberBalanceInfo(
                        member = member,
                        currency = cur,
                        initialPaid = paidAmount,
                        initialOwe = owedAmount,
                        paymentsMadeAsSender = sentPayments,
                        paymentsMadeAsReceiver = receivedPayments
                    )
                )
            }
        }
        return result
    }

    fun getGroupStatsFlow(groupId: String): Flow<GroupWithMembersAndStats?> = combine(
        getGroupById(groupId),
        getMembersByGroupId(groupId),
        getExpensesByGroupId(groupId),
        getPaymentsByGroupId(groupId)
    ) { group, members, expenses, payments ->
        if (group == null) return@combine null
        val totalExpense = expenses.sumOf { it.amount }
        val balances = calculateBalances(members, expenses, payments)
        val pending = DebtSimplifier.simplifyDebts(balances).size
        GroupWithMembersAndStats(
            group = group,
            members = members,
            totalExpense = totalExpense,
            pendingSettlementsCount = pending
        )
    }

    // -----------------------------------------------------------------------
    // Ad-hoc peer-to-peer ledger (scoped to /users/{currentUid}/...)
    // -----------------------------------------------------------------------

    fun getAllFriendsFlow(): Flow<List<Friend>> =
        friendsRef().orderBy("name").asFlow(::docToFriend)

    fun getAdHocExpensesFlow(): Flow<List<AdHocExpense>> =
        adhocExpensesRef()
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .asFlow(::docToAdHocExpense)

    fun getAdHocPaymentsFlow(): Flow<List<AdHocPayment>> =
        adhocPaymentsRef()
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .asFlow(::docToAdHocPayment)

    /**
     * Derives a flat list of AdHocSplit projections from the embedded
     * `splits` maps on every ad-hoc expense. The dashboard treats these as a
     * single stream (the old Room schema kept them in their own table).
     */
    fun getAllAdHocSplitsFlow(): Flow<List<AdHocSplit>> =
        getAdHocExpensesFlow().map { expenses ->
            expenses.flatMap { exp ->
                exp.splits.map { (participantId, portion) ->
                    AdHocSplit(
                        adhocExpenseId = exp.id,
                        participantFriendId = participantId,
                        amount = portion
                    )
                }
            }
        }

    fun getFriendsWithBalancesFlow(): Flow<List<FriendWithBalance>> = combine(
        getAllFriendsFlow(),
        getAdHocExpensesFlow(),
        getAdHocPaymentsFlow()
    ) { friends, expenses, payments ->
        val result = mutableListOf<FriendWithBalance>()
        val currencies = (expenses.map { it.currency } + payments.map { it.currency })
            .distinct()
            .ifEmpty { listOf("USD") }

        for (cur in currencies) {
            for (friend in friends) {
                var balance = 0.0
                for (expense in expenses) {
                    if (expense.currency != cur) continue
                    if (expense.paidByFriendId == YOU_ID) {
                        balance += expense.splits[friend.id] ?: 0.0
                    } else if (expense.paidByFriendId == friend.id) {
                        balance -= expense.splits[YOU_ID] ?: 0.0
                    }
                }
                for (payment in payments) {
                    if (payment.currency != cur) continue
                    if (payment.fromFriendId == friend.id && payment.toFriendId == YOU_ID) balance -= payment.amount
                    else if (payment.fromFriendId == YOU_ID && payment.toFriendId == friend.id) balance += payment.amount
                }
                result.add(FriendWithBalance(friend, balance, cur))
            }
        }
        result
    }

    suspend fun createFriend(name: String, email: String, phone: String): String {
        val ref = friendsRef().document()
        val friend = Friend(
            id = ref.id,
            name = name.trim(),
            email = email.trim(),
            phone = phone.trim()
        )
        ref.set(friend).await()
        return ref.id
    }

    suspend fun deleteFriend(friend: Friend) {
        if (friend.id.isBlank()) return
        friendsRef().document(friend.id).delete().await()
    }

    suspend fun createAdHocExpenseWithSplits(
        description: String,
        amount: Double,
        paidByFriendId: String,
        splitType: String,
        splits: List<Pair<String, Double>>,
        currency: String = "USD",
        timestamp: Long = System.currentTimeMillis()
    ): String {
        val ref = adhocExpensesRef().document()
        val expense = AdHocExpense(
            id = ref.id,
            description = description.trim(),
            amount = amount,
            paidByFriendId = paidByFriendId,
            splitType = splitType,
            timestamp = timestamp,
            currency = currency,
            splits = splits.toMap()
        )
        ref.set(expense).await()
        return ref.id
    }

    suspend fun deleteAdHocExpense(expense: AdHocExpense) {
        if (expense.id.isBlank()) return
        adhocExpensesRef().document(expense.id).delete().await()
    }

    suspend fun recordAdHocPayment(payment: AdHocPayment) {
        val ref = adhocPaymentsRef().document()
        ref.set(payment.copy(id = ref.id)).await()
    }

    suspend fun deleteAdHocPayment(payment: AdHocPayment) {
        if (payment.id.isBlank()) return
        adhocPaymentsRef().document(payment.id).delete().await()
    }

    // -----------------------------------------------------------------------
    // Group invitations
    // -----------------------------------------------------------------------

    fun getMyInvitesFlow(): Flow<List<GroupInvite>> =
        groupInvitesRef()
            .orderBy("invitedAt", Query.Direction.DESCENDING)
            .asFlow(::docToInvite)

    /**
     * Looks up a user by email and writes a /users/{inviteeUid}/groupInvites/{groupId}
     * doc. Returns true if an invite was written, false if no user with that
     * email exists yet.
     */
    suspend fun inviteToGroupByEmail(group: Group, email: String, invitedByName: String): Boolean {
        val normalized = email.trim().lowercase()
        if (normalized.isEmpty()) return false
        val snap = firestore.collection("users")
            .whereEqualTo("email", normalized)
            .limit(1)
            .get()
            .await()
        val target = snap.documents.firstOrNull() ?: return false
        val targetUid = target.id
        if (group.memberUids.contains(targetUid)) return true

        val invite = GroupInvite(
            id = group.id,
            groupId = group.id,
            groupName = group.name,
            invitedByUid = currentUid,
            invitedByName = invitedByName,
            invitedAt = System.currentTimeMillis()
        )
        firestore.collection("users")
            .document(targetUid)
            .collection("groupInvites")
            .document(group.id)
            .set(invite)
            .await()
        return true
    }

    /**
     * Accepts an invite: appends currentUid to the group's memberUids array,
     * inserts a linked GroupMember doc, and removes the invite.
     */
    suspend fun acceptInvite(invite: GroupInvite, myDisplayName: String, myEmail: String) {
        if (invite.groupId.isBlank()) return
        val gref = groupDoc(invite.groupId)
        val mref = membersRef(invite.groupId).document()
        val member = GroupMember(
            id = mref.id,
            groupId = invite.groupId,
            name = myDisplayName.ifBlank { "Me" },
            email = myEmail,
            linkedUid = currentUid
        )

        val batch = firestore.batch()
        batch.update(gref, "memberUids", FieldValue.arrayUnion(currentUid))
        batch.set(mref, member)
        batch.delete(groupInvitesRef().document(invite.id))
        batch.commit().await()
    }

    suspend fun declineInvite(invite: GroupInvite) {
        if (invite.id.isBlank()) return
        groupInvitesRef().document(invite.id).delete().await()
    }

    // -----------------------------------------------------------------------
    // First-launch demo seeding (per user, idempotent)
    // -----------------------------------------------------------------------

    suspend fun seedDemoIfEmpty() {
        val existing = friendsRef().limit(1).get().await()
        if (!existing.isEmpty) return

        val alexId = createFriend("Alex", "alex@example.com", "555-0199")
        val sarahId = createFriend("Sarah", "sarah@example.com", "555-0212")
        createFriend("Sam", "sam@example.com", "555-0144")

        createAdHocExpenseWithSplits(
            description = "Board Games Cafe",
            amount = 90.0,
            paidByFriendId = YOU_ID,
            splitType = "EQUAL",
            splits = listOf(YOU_ID to 30.0, alexId to 30.0, sarahId to 30.0)
        )
        createAdHocExpenseWithSplits(
            description = "Cozy Coffee & Pastries",
            amount = 48.0,
            paidByFriendId = sarahId,
            splitType = "EQUAL",
            splits = listOf(YOU_ID to 24.0, sarahId to 24.0)
        )

        // Touch the user doc so it exists even before the first sign-in profile write completes.
        userDoc().set(mapOf("uid" to currentUid), SetOptions.merge()).await()
    }
}

