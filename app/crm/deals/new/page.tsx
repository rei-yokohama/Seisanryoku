"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, doc, getDocs, query, setDoc, Timestamp, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { logActivity } from "../../../../lib/activity";
import { AppShell } from "../../../AppShell";
import { ensureProfile } from "../../../../lib/ensureProfile";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
  dealGenres?: string[] | null;
};

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
};

type Employee = {
  id: string;
  name: string;
  authUid?: string;
  color?: string;
};

type DealStatus = "ACTIVE" | "CONFIRMED" | "PLANNED" | "STOPPING" | "INACTIVE";

const DEAL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "稼働中", color: "bg-green-100 text-green-700" },
  { value: "CONFIRMED", label: "稼働確定", color: "bg-blue-100 text-blue-700" },
  { value: "PLANNED", label: "稼働予定", color: "bg-sky-100 text-sky-700" },
  { value: "STOPPING", label: "停止予定", color: "bg-amber-100 text-amber-700" },
  { value: "INACTIVE", label: "停止中", color: "bg-slate-100 text-slate-700" },
] as const;

function normalizeOptions(xs: Array<string | null | undefined>) {
  const set = new Set<string>();
  for (const x of xs) {
    const t = String(x || "").trim();
    if (!t) continue;
    set.add(t);
  }
  return Array.from(set).slice(0, 30);
}

type SearchableSelectProps = {
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
};

function SearchableSelect({ options, value, onChange, placeholder = "検索...", emptyMessage = "選択肢がありません" }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          handleSelect(filtered[highlightedIndex].id);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearch("");
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:flex-1">
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
      >
        <span className={selectedOption ? "text-slate-900" : "text-slate-400"}>
          {selectedOption?.label || emptyMessage}
        </span>
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-orange-500 focus:bg-white"
              autoComplete="off"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm font-bold text-slate-400">
                該当する項目がありません
              </div>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelect(option.id)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${
                    option.id === value
                      ? "bg-orange-100 text-orange-700"
                      : index === highlightedIndex
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DealNewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [genreEditorOpen, setGenreEditorOpen] = useState(false);
  const [newGenre, setNewGenre] = useState("");
  const [savingGenres, setSavingGenres] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<DealStatus>("ACTIVE");
  const [leaderUid, setLeaderUid] = useState("");
  const [subLeaderUid, setSubLeaderUid] = useState("");
  const [revenue, setRevenue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadCustomers = async (u: User, prof: MemberProfile) => {
    const merged: Customer[] = [];
    if (prof.companyCode) {
      const byCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
      merged.push(...byCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    // companyCode が無い過去データ救済（通常は companyCode でのみ取得する）
    if (!prof.companyCode) {
      const byCreator = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
      merged.push(...byCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    }
    const map = new Map<string, Customer>();
    for (const c of merged) map.set(c.id, c);
    const items = Array.from(map.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setCustomers(items);
    return items;
  };

  const loadEmployees = async (prof: MemberProfile) => {
    if (!prof.companyCode) {
      setEmployees([]);
      return;
    }
    const snap = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Employee));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setEmployees(list);
  };

  useEffect(() => {
    const initialCustomer = searchParams.get("customerId") || "";
    if (initialCustomer) setCustomerId(initialCustomer);
    const initialStatus = (searchParams.get("status") || "").toUpperCase();
    const validStatuses = DEAL_STATUS_OPTIONS.map(o => o.value);
    if (validStatuses.includes(initialStatus as DealStatus)) setStatus(initialStatus as DealStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }
      try {
        const prof = (await ensureProfile(u)) as unknown as MemberProfile | null;
        if (!prof) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile(prof);
        setGenreOptions(normalizeOptions(prof.dealGenres || []));
        const items = await loadCustomers(u, prof);
        await loadEmployees(prof);
        if (!customerId && items.length > 0) setCustomerId(items[0].id);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customerName = useMemo(() => customers.find((c) => c.id === customerId)?.name || "", [customers, customerId]);

  const saveGenreOptions = async (next: string[]) => {
    if (!user) return;
    setSavingGenres(true);
    try {
      await setDoc(doc(db, "profiles", user.uid), { dealGenres: next }, { merge: true });
      setGenreOptions(next);
    } catch (e: any) {
      const code = String(e?.code || "");
      const msg = String(e?.message || "");
      setError(code && msg ? `${code}: ${msg}` : msg || "ジャンル候補の保存に失敗しました");
    } finally {
      setSavingGenres(false);
    }
  };

  const addGenreOption = async () => {
    const t = newGenre.trim();
    if (!t) return;
    const next = normalizeOptions([...genreOptions, t]);
    setNewGenre("");
    await saveGenreOptions(next);
  };

  const removeGenreOption = async (g: string) => {
    const next = genreOptions.filter((x) => x !== g);
    await saveGenreOptions(next);
    if (genre === g) setGenre("");
  };

  const handleSubmit = async () => {
    if (!user || !profile) return;
    if (!customerId) {
      setError("顧客を選択してください");
      return;
    }
    const t = title.trim();
    if (!t) {
      setError("案件名を入力してください");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const revenueTrimmed = revenue.trim();
      const revenueValue: number | null = revenueTrimmed ? Number(revenueTrimmed) : null;
      if (revenueTrimmed) {
        const revenueNum = Number(revenueTrimmed);
        if (Number.isNaN(revenueNum) || revenueNum < 0) {
          setError("売上は 0 以上の数値で入力してください");
          setSaving(false);
          return;
        }
      }

      await addDoc(collection(db, "deals"), {
        companyCode: profile.companyCode,
        createdBy: user.uid,
        customerId,
        title: t,
        genre: genre.trim() || "",
        description: description.trim() || "",
        status,
        leaderUid: leaderUid || null,
        subLeaderUid: subLeaderUid || null,
        revenue: revenueValue,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await logActivity({
        companyCode: profile.companyCode,
        actorUid: user.uid,
        type: "DEAL_CREATED",
        message: `案件を作成しました: ${t}（顧客: ${customerName || "未設定"}）`,
        link: "/projects",
      });
      router.push("/projects");
    } catch (e: any) {
      setError(e?.message || "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="案件の追加" subtitle="Deal creation">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell
      title="案件の追加"
      subtitle="Deal creation"
      headerRight={
        <Link href="/projects" className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-orange-900 hover:bg-orange-50">
          ← 案件一覧
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

            <div className="grid grid-cols-1 gap-4">
              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">顧客 *</div>
                <div className="flex flex-wrap items-center gap-2">
                  <SearchableSelect
                    options={customers.map((c) => ({ id: c.id, label: c.name }))}
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="顧客を検索..."
                    emptyMessage={customers.length === 0 ? "顧客がありません" : "選択してください"}
                  />
                  <Link
                    href="/customers/new"
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    顧客を追加
                  </Link>
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">案件名 *</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：〇〇システム開発"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">カテゴリ</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none sm:flex-1"
                  >
                    <option value="">未設定</option>
                    {genreOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setGenreEditorOpen((v) => !v)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    候補を編集
                  </button>
                </div>
                {genreEditorOpen ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={newGenre}
                        onChange={(e) => setNewGenre(e.target.value)}
                        placeholder="ジャンル候補を追加"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none sm:flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => void addGenreOption()}
                        disabled={savingGenres}
                        className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-300"
                      >
                        追加
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {genreOptions.length === 0 ? (
                        <div className="text-xs font-bold text-slate-500">候補がありません</div>
                      ) : (
                        genreOptions.map((g) => (
                          <span
                            key={g}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-extrabold text-slate-700"
                          >
                            {g}
                            <button
                              type="button"
                              onClick={() => void removeGenreOption(g)}
                              disabled={savingGenres}
                              className="text-slate-400 hover:text-rose-600 disabled:text-slate-300"
                              title="削除"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-2 text-[11px] font-bold text-slate-500">※ 候補はあなた専用です（他ユーザーには影響しません）</div>
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">ステータス</div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DealStatus)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  {DEAL_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">リーダー</div>
                <select
                  value={leaderUid}
                  onChange={(e) => setLeaderUid(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  <option value="">未設定</option>
                  <option value={user.uid}>私</option>
                  {employees
                    .filter((e) => !!e.authUid && e.authUid !== user.uid)
                    .map((e) => (
                      <option key={e.id} value={e.authUid}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">サブリーダー</div>
                <select
                  value={subLeaderUid}
                  onChange={(e) => setSubLeaderUid(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none"
                >
                  <option value="">未設定</option>
                  <option value={user.uid}>私</option>
                  {employees
                    .filter((e) => !!e.authUid && e.authUid !== user.uid)
                    .map((e) => (
                      <option key={e.id} value={e.authUid}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">売上（数値）</div>
                <input
                  value={revenue}
                  onChange={(e) => setRevenue(e.target.value)}
                  inputMode="numeric"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：500000"
                />
              </div>

              <div>
                <div className="mb-1 text-sm font-bold text-slate-700">概要</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-32 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="案件の背景・範囲・注意点など"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Link href="/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                キャンセル
              </Link>
              <button
                onClick={handleSubmit}
                disabled={saving || customers.length === 0}
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-orange-950 hover:bg-orange-600 disabled:bg-orange-300"
              >
                {saving ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
      </div>
    </AppShell>
  );
}

export default function DealNewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <DealNewInner />
    </Suspense>
  );
}


