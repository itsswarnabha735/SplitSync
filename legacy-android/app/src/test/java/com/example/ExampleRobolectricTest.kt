package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.data.model.GroupMember
import com.example.data.model.MemberBalanceInfo
import com.example.logic.DebtSimplifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

    @Test
    fun `read string from context verifies SplitSync name`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val appName = context.getString(R.string.app_name)
        assertEquals("SplitSync", appName)
    }

    @Test
    fun `verify debt simplification engine greedy matching`() {
        // Prepare 3 members
        val bob = GroupMember(id = 1, groupId = 1, name = "Bob")
        val alice = GroupMember(id = 2, groupId = 1, name = "Alice")
        val charlie = GroupMember(id = 3, groupId = 1, name = "Charlie")

        // 3-way equal split of $90 paid by Bob
        // Alice owes $30, Charlie owes $30, Bob paid $90 and owes $30 (net +$60)
        val bobBalance = MemberBalanceInfo(bob, initialPaid = 90.0, initialOwe = 30.0, paymentsMadeAsSender = 0.0, paymentsMadeAsReceiver = 0.0)
        val aliceBalance = MemberBalanceInfo(alice, initialPaid = 0.0, initialOwe = 30.0, paymentsMadeAsSender = 0.0, paymentsMadeAsReceiver = 0.0)
        val charlieBalance = MemberBalanceInfo(charlie, initialPaid = 0.0, initialOwe = 30.0, paymentsMadeAsSender = 0.0, paymentsMadeAsReceiver = 0.0)

        val balances = listOf(bobBalance, aliceBalance, charlieBalance)

        val transactions = DebtSimplifier.simplifyDebts(balances)

        // There should be exactly 2 simplified transactions: Alice owes Bob $30, Charlie owes Bob $30
        assertEquals(2, transactions.size)

        val aliceTx = transactions.find { it.debtor.id == alice.id }
        val charlieTx = transactions.find { it.debtor.id == charlie.id }

        assertTrue(aliceTx != null)
        assertEquals(bob.id, aliceTx!!.creditor.id)
        assertEquals(30.0, aliceTx.amount, 0.01)

        assertTrue(charlieTx != null)
        assertEquals(bob.id, charlieTx!!.creditor.id)
        assertEquals(30.0, charlieTx.amount, 0.01)
    }
}
