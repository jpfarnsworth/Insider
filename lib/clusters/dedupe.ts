export interface StoredCluster {
  id: string;
  /** The signal's time (ms): when the market first knew. */
  signalAt: number;
  /** Ids of the transactions the cluster is built from. */
  transactionIds: string[];
}

/**
 * Finds clusters of one issuer that are really the same buying episode stored more than once.
 * Detection matches a stored cluster to a detected one by its trigger filing, so when the trigger
 * changes (a 4/A replaces the filing that completed the rule, or late filings shift the order) the
 * same purchases used to get a second signal, sometimes months after the first. Clusters that share
 * a purchase are one episode; the earliest signal is the canonical one because it records when the
 * market first knew, and the rest are superseded (kept, never deleted: they may carry scores).
 */
export function findDuplicates(clusters: StoredCluster[]): Array<{ keep: string; supersede: string[] }> {
  // Union-find over clusters linked by a shared transaction.
  const parent = new Map(clusters.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const owner = new Map<string, string>();
  for (const c of clusters) {
    for (const t of c.transactionIds) {
      const seen = owner.get(t);
      if (seen === undefined) owner.set(t, c.id);
      else parent.set(find(c.id), find(seen));
    }
  }

  const groups = new Map<string, StoredCluster[]>();
  for (const c of clusters) groups.set(find(c.id), [...(groups.get(find(c.id)) ?? []), c]);

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const ordered = [...g].sort((a, b) => a.signalAt - b.signalAt || a.id.localeCompare(b.id));
      return { keep: ordered[0].id, supersede: ordered.slice(1).map((c) => c.id) };
    });
}
