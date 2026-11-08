import {SNAPSHOT_MAX_AGE_MS} from './snapshot';

type AcquisitionClocks = {fetched_at: string; collection_started_at?: string};

/** Retention starts at the oldest retained acquisition, never at revalidation. */
export function ashareSnapshotExpiresAt(snapshot: AcquisitionClocks): number {
  return Math.min(Date.parse(snapshot.fetched_at), Date.parse(snapshot.collection_started_at ?? snapshot.fetched_at)) + SNAPSHOT_MAX_AGE_MS;
}

export function ashareSnapshotExpired(snapshot: AcquisitionClocks, now: number): boolean {
  const expiresAt = ashareSnapshotExpiresAt(snapshot);
  return !Number.isFinite(now) || !Number.isFinite(expiresAt) || now >= expiresAt;
}
