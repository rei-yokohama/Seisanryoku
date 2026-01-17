"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { logActivity } from "../../../../lib/activity";
import { ensureProfile } from "../../../../lib/ensureProfile";
import { AppShell } from "../../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  email?: string | null;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
};

type CustomerDoc = {
  companyCode: string;
  createdBy: string;
  name: string;
  type?: string;
  isActive?: boolean | null; // 稼働中/停止中
  inactivatedAt?: Timestamp | null; // 停止したタイミング
  assigneeUid?: string | null;
  subAssigneeUid?: string | null; // サブリーダー
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  address?: string;
  industry?: string;
  tags?: string[];
  dealStartDate?: string | null;
  transactionStartDate?: string | null;
  contractAmount?: number | string | null;
  notes?: string;
};

const CUSTOMER_TYPES = [
  { value: "CORPORATION", label: "法人" },
  { value: "INDIVIDUAL", label: "個人" },
  { value: "PARTNER", label: "パートナー" },
  { value: "OTHER", label: "その他" },
];

const INDUSTRIES = ["IT・通信", "製造業", "小売・流通", "金融・保険", "不動産", "建設", "医療・福祉", "教育", "サービス業", "運輸", "飲食", "その他"];

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function CustomerEditPage() {
  const router = useRouter();
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);

  // form
  const [name, setName] = useState("");
  const [type, setType] = useState("CORPORATION");
  const [isActive, setIsActive] = useState(true);
  const [assigneeUid, setAssigneeUid] = useState("");
  const [subAssigneeUid, setSubAssigneeUid] = useState(""); // サブリーダー
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [industry, setIndustry] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [dealStartDate, setDealStartDate] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadedOnce, setLoadedOnce] = useState(false);
  const initialIsActiveRef = useRef<boolean>(true);

  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const tagList = useMemo(() => {
    const raw = tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).slice(0, 10);
  }, [tagsText]);

  const insertAtCursor = (before: string, after = "") => {
    const el = notesRef.current;
    if (!el) {
      setNotes((prev) => prev + before + after);
      return;
    }
    const start = el.selectionStart ?? notes.length;
    const end = el.selectionEnd ?? notes.length;
    const selected = notes.slice(start, end);
    const next = notes.slice(0, start) + before + selected + after + notes.slice(end);
    setNotes(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + selected.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      try {
        const prof = await ensureProfile(u);
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);

        // employees (for assignee)
        const mergedEmployees: Employee[] = [];
        if (prof.companyCode) {
          const snapEmpByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmployees.push(...snapEmpByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        }
        const snapEmpByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
        mergedEmployees.push(...snapEmpByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
        const empById = new Map<string, Employee>();
        for (const e of mergedEmployees) empById.set(e.id, e);
        const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setEmployees(empItems);

        // customer
        const custSnap = await getDoc(doc(db, "customers", customerId));
        if (!custSnap.exists()) {
          setError("顧客が見つかりません");
          setLoading(false);
          return;
        }
        const c = custSnap.data() as CustomerDoc;
        if (!loadedOnce) {
          setName(c.name || "");
          setType((c.type as string) || "CORPORATION");
          const active = c.isActive !== false;
          setIsActive(active);
          initialIsActiveRef.current = active;
          setAssigneeUid((c.assigneeUid as string) || "");
          setSubAssigneeUid((c.subAssigneeUid as string) || "");
          setContactName(c.contactName || "");
          setContactEmail(c.contactEmail || "");
          setPhone(c.phone || "");
          setAddress(c.address || "");
          setIndustry(c.industry || "");
          setTagsText((c.tags || []).join(", "));
          const ds = (c.dealStartDate || c.transactionStartDate || "") as string;
          setDealStartDate(ds || "");
          const ca = c.contractAmount;
          setContractAmount(ca === null || ca === undefined ? "" : String(ca));
          setNotes(c.notes || "");
          setLoadedOnce(true);
        }
      } catch (e: any) {
        setError(e?.message || "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, customerId, loadedOnce]);

  const handleSave = async () => {
    if (!user || !profile) return;
    setError("");
    const n = name.trim();
    if (!n) {
      setError("顧客名を入力してください");
      return;
    }
    setSaving(true);
    try {
      const nextIsActive = !!isActive;
      const wasActive = initialIsActiveRef.current;
      const willInactivate = wasActive && !nextIsActive;
      const inactivatedAt = willInactivate ? Timestamp.now() : null;

      const updates: Record<string, any> = {
        name: n,
        type,
        isActive: nextIsActive,
        assigneeUid: assigneeUid || null,
        subAssigneeUid: subAssigneeUid || null,
        contactName: contactName.trim() || "",
        contactEmail: contactEmail.trim() || "",
        phone: phone.trim() || "",
        address: address.trim() || "",
        industry: industry || "",
        tags: tagList,
        // 互換性のため両方書く
        dealStartDate: dealStartDate || null,
        transactionStartDate: dealStartDate || null,
        contractAmount: contractAmount ? Number(contractAmount) : null,
        notes: notes.trim() || "",
        updatedAt: Timestamp.now(),
      };
      // 停止にした瞬間だけ「停止した時刻」を更新
      if (willInactivate) updates.inactivatedAt = inactivatedAt;
      // 再稼働にした場合は停止時刻をクリア
      if (nextIsActive) updates.inactivatedAt = null;

      await updateDoc(doc(db, "customers", customerId), updates);

      if (willInactivate) {
        await logActivity({
          companyCode: profile.companyCode,
          actorUid: user.uid,
          type: "CUSTOMER_UPDATED",
          entityId: customerId,
          message: `顧客を停止にしました: ${n}`,
          link: `/customers/${customerId}`,
        });
      }

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "CUSTOMER_UPDATED",
        entityId: customerId,
        message: `顧客を更新しました: ${n}`,
        link: `/customers/${customerId}`,
      });

      // 次回以降の差分判定のため更新
      initialIsActiveRef.current = nextIsActive;
      router.push(`/customers/${customerId}`);
    } catch (e: any) {
      setError(e?.message || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="顧客編集" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title="顧客編集"
      subtitle="顧客情報を更新"
      headerRight={
        <div className="flex items-center gap-2">
          <Link
            href={`/customers/${customerId}`}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            ← 詳細
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className={clsx("rounded-md px-4 py-2 text-sm font-extrabold text-white", saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700")}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">種別</div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                {CUSTOMER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">稼働ステータス</div>
              <select
                value={isActive ? "ACTIVE" : "INACTIVE"}
                onChange={(e) => setIsActive(e.target.value === "ACTIVE")}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                <option value="ACTIVE">稼働中</option>
                <option value="INACTIVE">停止中</option>
              </select>
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-600">顧客名 *</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="例：株式会社サンプル"
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">担当(リーダー)</div>
              <select
                value={assigneeUid}
                onChange={(e) => setAssigneeUid(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                <option value="">未設定</option>
                <option value={user.uid}>私</option>
                {employees.filter((e) => !!e.authUid && e.authUid !== user.uid).map((e) => (
                  <option key={e.id} value={e.authUid}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">サブリーダー</div>
              <select
                value={subAssigneeUid}
                onChange={(e) => setSubAssigneeUid(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                <option value="">未設定</option>
                <option value={user.uid}>私</option>
                {employees.filter((e) => !!e.authUid && e.authUid !== user.uid).map((e) => (
                  <option key={e.id} value={e.authUid}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">業種</div>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                <option value="">未設定</option>
                {INDUSTRIES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">担当者名</div>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="例：山田 太郎"
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">担当者メール</div>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="example@company.com"
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">電話</div>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="03-xxxx-xxxx"
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">住所</div>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="東京都..."
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">取引開始日</div>
              <input
                value={dealStartDate}
                onChange={(e) => setDealStartDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="YYYY-MM-DD"
              />
            </div>

            <div className="md:col-span-6">
              <div className="text-xs font-extrabold text-slate-600">契約金額（数値）</div>
              <input
                value={contractAmount}
                onChange={(e) => setContractAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="例：500000"
                inputMode="numeric"
              />
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-600">タグ（カンマ区切り）</div>
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                placeholder="例：広告, 重要, リード"
              />
              {tagList.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {tagList.map((t) => (
                    <span key={t} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-700">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="md:col-span-12">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-slate-600">備考</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    onClick={() => insertAtCursor("**重要**: ", "")}
                  >
                    太字
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    onClick={() => insertAtCursor("- ", "")}
                  >
                    箇条書き
                  </button>
                </div>
              </div>
              <textarea
                ref={notesRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 h-40 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                placeholder="メモ（Markdown風）"
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}


