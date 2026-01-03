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
  if (profSnap.exists()) return profSnap.data() as MemberProfile;

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


