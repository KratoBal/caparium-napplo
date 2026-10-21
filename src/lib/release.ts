// The commit the running deploy was built from, for GET /api/health (acrobot 34597: every deploy measurable from
// outside, without a login). The same contract as acropora-os (apps/api/src/common/release-info.util.ts,
// docs/COOLIFY.md): RELEASE_COMMIT_SHA is set per deploy by the platform (Coolify substitutes ${SOURCE_COMMIT}),
// never typed by hand. Anything but a full 40-character lowercase hex SHA reads as null: a wrong hash would say
// "verified" against the wrong release, null says "cannot be verified".
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

export function releaseCommit(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.RELEASE_COMMIT_SHA?.trim();
  return value && FULL_COMMIT_SHA.test(value) ? value : null;
}
