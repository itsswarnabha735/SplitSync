package com.example

import com.example.data.model.GroupMember
import com.example.data.model.MemberBalanceInfo
import com.example.logic.DebtSimplifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Smoke test that the per-currency greedy debt simplifier still works after the
 * Room -> Firestore migration (which converted every member id from Int to String).
 * No Firebase / Android dependencies — pure JVM unit test.
 */
class DebtSimplifierTest {

    private fun member(id: String, name: String) = GroupMember(id = id, name = name)

    private fun balance(
        member: GroupMember,
        net: Double,
        currency: String = "USD"
    ): MemberBalanceInfo {
        // Express the desired net balance by attributing it to "initialPaid".
        val paid = if (net > 0) net else 0.0
        val owe = if (net < 0) -net else 0.0
        return MemberBalanceInfo(
            member = member,
            currency = currency,
            initialPaid = paid,
            initialOwe = owe,
            paymentsMadeAsSender = 0.0,
            paymentsMadeAsReceiver = 0.0
        )
    }

    @Test
    fun simplifies_three_party_chain_into_two_transactions() {
        val alex = member("alex-uid", "Alex")
        val sarah = member("sarah-uid", "Sarah")
        val sam = member("sam-uid", "Sam")

        val txns = DebtSimplifier.simplifyDebts(listOf(
            balance(alex, -30.0),
            balance(sarah, -20.0),
            balance(sam, 50.0)
        ))

        assertEquals(2, txns.size)
        assertEquals(50.0, txns.sumOf { it.amount }, 0.001)
        assertTrue(txns.all { it.creditor.id == "sam-uid" })
    }

    @Test
    fun per_currency_balances_do_not_mix() {
        val a = member("a", "A")
        val b = member("b", "B")

        val txns = DebtSimplifier.simplifyDebts(listOf(
            balance(a, -10.0, currency = "USD"),
            balance(b, 10.0, currency = "USD"),
            balance(a, 20.0, currency = "EUR"),
            balance(b, -20.0, currency = "EUR")
        ))

        assertEquals(2, txns.size)
        val usdTxn = txns.first { it.currency == "USD" }
        val eurTxn = txns.first { it.currency == "EUR" }
        assertEquals("a", usdTxn.debtor.id)
        assertEquals("b", usdTxn.creditor.id)
        assertEquals(10.0, usdTxn.amount, 0.001)
        assertEquals("b", eurTxn.debtor.id)
        assertEquals("a", eurTxn.creditor.id)
        assertEquals(20.0, eurTxn.amount, 0.001)
    }

    @Test
    fun returns_empty_when_everyone_is_settled() {
        val a = member("a", "A")
        val b = member("b", "B")
        val txns = DebtSimplifier.simplifyDebts(listOf(
            balance(a, 0.0),
            balance(b, 0.0)
        ))
        assertTrue(txns.isEmpty())
    }
}
