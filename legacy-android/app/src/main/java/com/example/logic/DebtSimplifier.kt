package com.example.logic

import com.example.data.model.DebtOverview
import com.example.data.model.GroupMember
import com.example.data.model.MemberBalanceInfo
import kotlin.math.abs
import kotlin.math.min

object DebtSimplifier {

    /**
     * Minimizes interpersonal debt using the greedy approach described in the PRD.
     * Takes as input a list of MemberBalanceInfo objects, each containing a member
     * and their net balance calculated from all expenses, splits, and custom payments.
     */
    fun simplifyDebts(balances: List<MemberBalanceInfo>): List<DebtOverview> {
        val groupedBalances = balances.groupBy { it.currency }
        val allTransactions = mutableListOf<DebtOverview>()

        for ((currency, currencyBalances) in groupedBalances) {
            val epsilon = 0.01

            val debtors = currencyBalances
                .filter { it.netBalance < -epsilon }
                .map { it.member to abs(it.netBalance) }
                .toMutableList()

            val creditors = currencyBalances
                .filter { it.netBalance > epsilon }
                .map { it.member to it.netBalance }
                .toMutableList()

            while (debtors.isNotEmpty() && creditors.isNotEmpty()) {
                // Sort both arrays in descending order of magnitude
                debtors.sortByDescending { it.second }
                creditors.sortByDescending { it.second }

                val (debtor, absoluteDebtorBalance) = debtors[0]
                val (creditor, creditorBalance) = creditors[0]

                // The settle amount is the minimum of absolute debtor balance and creditor balance
                val settleAmount = min(absoluteDebtorBalance, creditorBalance)

                // Round to 2 decimal places
                val roundedSettleAmount = Math.round(settleAmount * 100.0) / 100.0

                if (roundedSettleAmount > 0.0) {
                    allTransactions.add(
                        DebtOverview(
                            debtor = debtor,
                            creditor = creditor,
                            amount = roundedSettleAmount,
                            currency = currency
                        )
                    )
                }

                // Adjust remaining balances
                val remainingDebtor = absoluteDebtorBalance - settleAmount
                val remainingCreditor = creditorBalance - settleAmount

                if (remainingDebtor > epsilon) {
                    debtors[0] = debtor to remainingDebtor
                } else {
                    debtors.removeAt(0)
                }

                if (remainingCreditor > epsilon) {
                    creditors[0] = creditor to remainingCreditor
                } else {
                    creditors.removeAt(0)
                }
            }
        }

        return allTransactions
    }
}
