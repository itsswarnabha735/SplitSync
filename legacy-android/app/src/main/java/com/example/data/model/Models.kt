package com.example.data.model

/**
 * Stable sentinel used inside ad-hoc collections (which already live under
 * /users/{uid}/...) to represent the signed-in user themselves. It replaces the
 * old Int `0` sentinel from the Room schema.
 */
const val YOU_ID: String = "self"

// ---------------------------------------------------------------------------
// Group ledger (shared across all members of a group)
//   /groups/{groupId}
//   /groups/{groupId}/members/{memberId}
//   /groups/{groupId}/expenses/{expenseId}   (splits embedded as Map<memberId, amount>)
//   /groups/{groupId}/payments/{paymentId}
// ---------------------------------------------------------------------------

data class Group(
    var id: String = "",
    val name: String = "",
    val description: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val createdBy: String = "",
    /** Flat array of every member uid currently in the group; drives access rules. */
    val memberUids: List<String> = emptyList()
)

data class GroupMember(
    var id: String = "",
    val groupId: String = "",
    val name: String = "",
    val email: String = "",
    /** uid of a SplitSync user this member is linked to, when one exists. */
    val linkedUid: String = ""
)

data class Expense(
    var id: String = "",
    val groupId: String = "",
    val description: String = "",
    val amount: Double = 0.0,
    val paidById: String = "",
    val splitType: String = "EQUAL",
    val timestamp: Long = System.currentTimeMillis(),
    val currency: String = "USD",
    /** Embedded splits: memberId -> portion owed. */
    val splits: Map<String, Double> = emptyMap()
)

data class Payment(
    var id: String = "",
    val groupId: String = "",
    val fromMemberId: String = "",
    val toMemberId: String = "",
    val amount: Double = 0.0,
    val timestamp: Long = System.currentTimeMillis(),
    val currency: String = "USD"
)

// ---------------------------------------------------------------------------
// Per-user ad-hoc ledger
//   /users/{uid}/friends/{friendId}
//   /users/{uid}/adhocExpenses/{expenseId}   (splits embedded as Map<participantId, amount>)
//   /users/{uid}/adhocPayments/{paymentId}
//
// Inside this subtree, the constant YOU_ID is used as the participant identifier
// for the signed-in user themselves.
// ---------------------------------------------------------------------------

data class Friend(
    var id: String = "",
    val name: String = "",
    val email: String = "",
    val phone: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    /** uid of a SplitSync user this friend is linked to, when one exists. */
    val linkedUid: String = ""
)

data class AdHocExpense(
    var id: String = "",
    val description: String = "",
    val amount: Double = 0.0,
    /** YOU_ID for the signed-in user; otherwise a Friend.id. */
    val paidByFriendId: String = YOU_ID,
    val splitType: String = "EQUAL",
    val timestamp: Long = System.currentTimeMillis(),
    val currency: String = "USD",
    /** Embedded splits: participantId -> portion owed. */
    val splits: Map<String, Double> = emptyMap()
)

data class AdHocPayment(
    var id: String = "",
    val fromFriendId: String = YOU_ID,
    val toFriendId: String = YOU_ID,
    val amount: Double = 0.0,
    val timestamp: Long = System.currentTimeMillis(),
    val currency: String = "USD"
)

// ---------------------------------------------------------------------------
// Group invitation: written into /users/{inviteeUid}/groupInvites/{groupId}
// when an existing member invites someone by email.
// ---------------------------------------------------------------------------

data class GroupInvite(
    var id: String = "",
    val groupId: String = "",
    val groupName: String = "",
    val invitedByUid: String = "",
    val invitedByName: String = "",
    val invitedAt: Long = System.currentTimeMillis()
)

// ---------------------------------------------------------------------------
// Non-entity UI models. These are unchanged in shape from the Room version,
// except every Int identifier becomes String.
// ---------------------------------------------------------------------------

data class GroupWithMembersAndStats(
    val group: Group,
    val members: List<GroupMember>,
    val totalExpense: Double,
    val pendingSettlementsCount: Int
)

data class MemberBalanceInfo(
    val member: GroupMember,
    val currency: String = "USD",
    val initialPaid: Double,
    val initialOwe: Double,
    val paymentsMadeAsSender: Double,
    val paymentsMadeAsReceiver: Double
) {
    val netBalance: Double
        get() = (initialPaid + paymentsMadeAsSender) - (initialOwe + paymentsMadeAsReceiver)
}

data class DebtOverview(
    val debtor: GroupMember,
    val creditor: GroupMember,
    val amount: Double,
    val currency: String = "USD"
)

data class FriendWithBalance(
    val friend: Friend,
    val netBalance: Double,
    val currency: String = "USD"
)

/**
 * Compact "ad-hoc split" projection. The Room schema kept these in their own
 * table; on Firestore they live embedded on the parent AdHocExpense, but the
 * dashboard UI still iterates them as a flat list so we expose this view-model.
 */
data class AdHocSplit(
    val id: String = "",
    val adhocExpenseId: String = "",
    val participantFriendId: String = YOU_ID,
    val amount: Double = 0.0
)
