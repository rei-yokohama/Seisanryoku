import { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "./firebase";

export type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  companyName?: string | null;
  email?: string | null;
};

/**
 * Ensure `profiles/{uid}` exists.
 * - If it already exists, returns it.
 * - If not, tries to restore companyCode from `workspaceMemberships` (self-readable),
 *   then creates/merges the profile document.
 */
export async function ensureProfile(user: User): Promise<MemberProfile | null> {
  const profRef = doc(db, "profiles", user.uid);
  const profSnap = await getDoc(profRef);
  if (profSnap.exists()) {
    const existing = profSnap.data() as MemberProfile;
    const existingCode = String((existing as any)?.companyCode || "").trim();
    if (existingCode) return existing;

    // Profile exists but companyCode is missing -> try to restore from membership and patch it.
    const membershipSnap = await getDocs(query(collection(db, "workspaceMemberships"), where("uid", "==", user.uid)));
    const membership = !membershipSnap.empty ? membershipSnap.docs[0].data() : null;
    const companyCode = String(membership?.companyCode || "").trim();
    if (!companyCode) return existing; // best-effort: keep existing profile

    // Best-effort company name (should be readable when membership exists)
    let companyName: string | null = existing.companyName || null;
    try {
      const compSnap = await getDoc(doc(db, "companies", companyCode));
      if (compSnap.exists()) {
        const cd = compSnap.data() as any;
        companyName = (cd?.companyName || cd?.name || null) as string | null;
      }
    } catch {
      // noop
    }

    const patched: MemberProfile = {
      ...existing,
      uid: user.uid,
      companyCode,
      companyName,
      displayName: existing.displayName || user.displayName || user.email?.split("@")[0] || "ユーザー",
      email: existing.email || user.email || null,
    };
    await setDoc(profRef, patched, { merge: true });
    return patched;
  }

  // Restore from membership (readable for self)
  const membershipSnap = await getDocs(query(collection(db, "workspaceMemberships"), where("uid", "==", user.uid)));
  const membership = !membershipSnap.empty ? membershipSnap.docs[0].data() : null;
  const companyCode = String(membership?.companyCode || "").trim();
  if (!companyCode) return null;

  // Best-effort company name (should be readable when membership exists)
  let companyName: string | null = null;
  try {
    const compSnap = await getDoc(doc(db, "companies", companyCode));
    if (compSnap.exists()) {
      const cd = compSnap.data() as any;
      companyName = (cd?.companyName || cd?.name || null) as string | null;
    }
  } catch {
    // noop
  }

  const displayName = user.displayName || user.email?.split("@")[0] || "ユーザー";
  const profile: MemberProfile = {
    uid: user.uid,
    companyCode,
    companyName,
    displayName,
    email: user.email || null,
  };

  await setDoc(profRef, profile, { merge: true });
  return profile;
}


