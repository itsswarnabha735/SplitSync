import type { AdHocExpense, AdHocPayment, Friend } from "./models";
import { YOU_ID } from "./models";

export interface FriendIdentityIndex {
  friends: Friend[];
  aliasToCanonicalId: Map<string, string>;
  aliasesByCanonicalId: Map<string, string[]>;
  canonicalById: Map<string, Friend>;
}

export function buildFriendIdentityIndex(friends: Friend[]): FriendIdentityIndex {
  const parent = new Map<string, string>();

  function ensure(node: string) {
    if (!parent.has(node)) parent.set(node, node);
  }

  function find(node: string): string {
    ensure(node);
    const p = parent.get(node)!;
    if (p === node) return p;
    const root = find(p);
    parent.set(node, root);
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const friendNode = (id: string) => `friend:${id}`;

  for (const friend of friends) {
    const node = friendNode(friend.id);
    ensure(node);

    const linkedUid = normalizeUid(friend.linkedUid);
    if (linkedUid) union(node, `uid:${linkedUid}`);

    const email = normalizeEmail(friend.email);
    if (email) union(node, `email:${email}`);
  }

  const strongFriendsByName = new Map<string, Friend[]>();
  for (const friend of friends) {
    if (!hasStrongIdentity(friend)) continue;
    const name = normalizeName(friend.name);
    if (!name) continue;
    strongFriendsByName.set(name, [...(strongFriendsByName.get(name) ?? []), friend]);
  }

  for (const friend of friends) {
    if (hasStrongIdentity(friend)) continue;
    const name = normalizeName(friend.name);
    if (!name) continue;

    const candidates = strongFriendsByName.get(name) ?? [];
    const candidateRoots = new Set(
      candidates.map((candidate) => find(friendNode(candidate.id)))
    );
    if (candidateRoots.size === 1 && candidates[0]) {
      union(friendNode(friend.id), friendNode(candidates[0].id));
    }
  }

  const grouped = new Map<string, Friend[]>();
  for (const friend of friends) {
    const root = find(friendNode(friend.id));
    grouped.set(root, [...(grouped.get(root) ?? []), friend]);
  }

  const canonicalFriends: Friend[] = [];
  const aliasToCanonicalId = new Map<string, string>();
  const aliasesByCanonicalId = new Map<string, string[]>();
  const canonicalById = new Map<string, Friend>();

  for (const members of grouped.values()) {
    const canonical = mergeCanonicalFriend(selectCanonicalFriend(members), members);
    canonicalFriends.push(canonical);
    canonicalById.set(canonical.id, canonical);

    const aliases = members.map((member) => member.id);
    aliasesByCanonicalId.set(canonical.id, aliases);
    for (const alias of aliases) {
      aliasToCanonicalId.set(alias, canonical.id);
    }
  }

  canonicalFriends.sort(compareFriendsForDisplay);

  return {
    friends: canonicalFriends,
    aliasToCanonicalId,
    aliasesByCanonicalId,
    canonicalById,
  };
}

export function canonicalizeAdHocExpenses(
  expenses: AdHocExpense[],
  aliasToCanonicalId: Map<string, string>
): AdHocExpense[] {
  return expenses.map((expense) => ({
    ...expense,
    paidByFriendId: canonicalParticipantId(
      expense.paidByFriendId,
      aliasToCanonicalId
    ),
    splits: canonicalAmountMap(expense.splits, aliasToCanonicalId),
  }));
}

export function canonicalizeAdHocPayments(
  payments: AdHocPayment[],
  aliasToCanonicalId: Map<string, string>
): AdHocPayment[] {
  return payments.map((payment) => ({
    ...payment,
    fromFriendId: canonicalParticipantId(payment.fromFriendId, aliasToCanonicalId),
    toFriendId: canonicalParticipantId(payment.toFriendId, aliasToCanonicalId),
  }));
}

export function canonicalParticipantId(
  participantId: string,
  aliasToCanonicalId: Map<string, string>
): string {
  if (participantId === YOU_ID) return YOU_ID;
  return aliasToCanonicalId.get(participantId) ?? participantId;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeUid(uid: string): string {
  return uid.trim();
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasStrongIdentity(friend: Friend): boolean {
  return Boolean(normalizeUid(friend.linkedUid) || normalizeEmail(friend.email));
}

function selectCanonicalFriend(friends: Friend[]): Friend {
  return [...friends].sort((a, b) => {
    const rank = canonicalRank(a) - canonicalRank(b);
    if (rank !== 0) return rank;
    const createdAt = safeCreatedAt(a) - safeCreatedAt(b);
    if (createdAt !== 0) return createdAt;
    return a.id.localeCompare(b.id);
  })[0];
}

function canonicalRank(friend: Friend): number {
  const linkedUid = normalizeUid(friend.linkedUid);
  if (linkedUid && friend.id === linkedUid) return 0;
  if (linkedUid) return 1;
  if (normalizeEmail(friend.email)) return 2;
  return 3;
}

function mergeCanonicalFriend(canonical: Friend, members: Friend[]): Friend {
  const firstWith = (field: keyof Friend): string => {
    const value = canonical[field];
    if (typeof value === "string" && value.trim()) return value;
    for (const member of members) {
      const candidate = member[field];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return "";
  };

  return {
    ...canonical,
    name: firstWith("name"),
    email: firstWith("email"),
    phone: firstWith("phone"),
    linkedUid: firstWith("linkedUid"),
    createdAt: Math.min(...members.map(safeCreatedAt)),
  };
}

function compareFriendsForDisplay(a: Friend, b: Friend): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

function safeCreatedAt(friend: Friend): number {
  return Number.isFinite(friend.createdAt) ? friend.createdAt : Number.MAX_SAFE_INTEGER;
}

function canonicalAmountMap(
  values: Record<string, number>,
  aliasToCanonicalId: Map<string, string>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [participantId, amount] of Object.entries(values)) {
    const canonicalId = canonicalParticipantId(participantId, aliasToCanonicalId);
    out[canonicalId] = (out[canonicalId] ?? 0) + amount;
  }
  return out;
}
