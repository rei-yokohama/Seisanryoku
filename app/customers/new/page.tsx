"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, query, Timestamp, where } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { logActivity } from "../../../lib/activity";
import { AppShell } from "../../AppShell";

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

const CUSTOMER_TYPES = [
  { value: "CORPORATION", label: "法人" },
  { value: "INDIVIDUAL", label: "個人" },
  { value: "PARTNER", label: "パートナー" },
  { value: "OTHER", label: "その他" },
];

const INDUSTRIES = [
  "IT・通信", "製造業", "小売・流通", "金融・保険", "不動産", "建設",
  "医療・福祉", "教育", "サービス業", "運輸", "飲食", "その他",
];

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function CustomerNewPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<Employee[]>([]);

  // form
  const [name, setName] = useState("");
  const [type, setType] = useState("CORPORATION");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [industry, setIndustry] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [dealStartDate, setDealStartDate] = useState("");
  const [contractAmount, setContractAmount] = useState("");
  const [notes, setNotes] = useState("");

  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  const tagList = useMemo(() => {
    const raw = tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).slice(0, 10);
  }, [tagsText]);

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "私";
  }, [profile?.displayName, user?.email]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (!profSnap.exists()) {
        setLoading(false);
        router.push("/login");
        return;
      }
      const prof = profSnap.data() as MemberProfile;
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

      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const goBack = () => {
    router.push("/customers");
  };

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

  const handleSubmit = async () => {
    if (!user || !profile) return;
    setError("");
    const n = name.trim();
    if (!n) {
      setError("顧客名を入力してください");
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "customers"), {
        companyCode: profile.companyCode,
        createdBy: user.uid,
        name: n,
        type,
        assigneeUid: assigneeUid || null,
        contactName: contactName.trim() || "",
        contactEmail: contactEmail.trim() || "",
        phone: phone.trim() || "",
        address: address.trim() || "",
        industry: industry || "",
        tags: tagList,
        dealStartDate: dealStartDate || null,
        contractAmount: contractAmount ? Number(contractAmount) : null,
        notes: notes.trim() || "",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "CUSTOMER_CREATED",
        message: `顧客を作成しました: ${n}`,
        link: "/customers",
      });

      router.push("/customers");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "顧客の作成に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="顧客追加" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title="顧客追加"
      subtitle="新しい顧客情報を入力"
      headerRight={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {showPreview ? "編集" : "プレビュー"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={clsx(
              "rounded-md px-4 py-2 text-sm font-extrabold text-white",
              saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
            )}
          >
            {saving ? "追加中..." : "追加"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

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

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-600">顧客名 *</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-md border border-orange-300 bg-orange-50/30 px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500"
                placeholder="例：株式会社〇〇"
              />
            </div>

            <div className="md:col-span-12 border-t border-slate-100 pt-4">
              <div className="text-xs font-extrabold text-slate-600 mb-2">詳細情報・メモ</div>
              <div className="rounded-md border border-slate-200">
                <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
                  <button onClick={() => insertAtCursor("**", "**")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">
                    B
                  </button>
                  <button onClick={() => insertAtCursor("*", "*")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">
                    I
                  </button>
                  <button onClick={() => insertAtCursor("~~", "~~")} className="rounded px-2 py-1 text-sm font-extrabold text-slate-700 hover:bg-white">
                    S
                  </button>
                  <button onClick={() => insertAtCursor("\n- ")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">
                    •
                  </button>
                  <button onClick={() => insertAtCursor("\n> ")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">
                    "
                  </button>
                  <button onClick={() => insertAtCursor("`", "`")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">
                    {"{}"}
                  </button>
                  <button onClick={() => insertAtCursor("[", "](url)")} className="rounded px-2 py-1 text-sm font-bold text-slate-700 hover:bg-white">
                    🔗
                  </button>
                  <div className="ml-auto">
                    <button
                      onClick={() => setShowPreview((v) => !v)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                      type="button"
                    >
                      {showPreview ? "編集" : "プレビュー"}
                    </button>
                  </div>
                </div>

                {!showPreview ? (
                  <textarea
                    ref={notesRef}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[180px] w-full resize-y px-3 py-3 text-sm text-slate-800 outline-none"
                    placeholder="取引条件、注意点、過去の実績など"
                  />
                ) : (
                  <div className="min-h-[180px] whitespace-pre-wrap px-3 py-3 text-sm text-slate-800">
                    {notes.trim() ? notes : "（プレビュー：内容がありません）"}
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-12 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-extrabold text-slate-600">担当者</div>
                    <button
                      type="button"
                      onClick={() => setAssigneeUid(user.uid)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      👤 私が担当
                    </button>
                  </div>
                  <select
                    value={assigneeUid}
                    onChange={(e) => setAssigneeUid(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    <option value="">未割当</option>
                    <option value={user.uid}>{myDisplayName}</option>
                    {employees
                      .filter((e) => !!e.authUid && e.authUid !== user.uid)
                      .map((e) => (
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
                    <option value="">選択してください</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>
                        {ind}
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
                    placeholder="例：山田太郎"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">メールアドレス</div>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例：yamada@example.com"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">電話番号</div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例：03-1234-5678"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">取引開始日</div>
                  <input
                    type="date"
                    value={dealStartDate}
                    onChange={(e) => setDealStartDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  />
                </div>

                <div className="md:col-span-12">
                  <div className="text-xs font-extrabold text-slate-600">住所</div>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例：東京都渋谷区〇〇1-2-3"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">契約金額（円/月）</div>
                  <input
                    type="number"
                    value={contractAmount}
                    onChange={(e) => setContractAmount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例：100000"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">タグ（カンマ区切り）</div>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例：VIP,リピーター,要フォロー"
                  />
                  {tagList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tagList.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={goBack}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          type="button"
        >
          キャンセル
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className={clsx(
            "rounded-md px-4 py-2 text-sm font-extrabold text-white",
            saving ? "bg-orange-400" : "bg-orange-600 hover:bg-orange-700",
          )}
          type="button"
        >
          {saving ? "追加中..." : "追加"}
        </button>
      </div>
    </AppShell>
  );
}

