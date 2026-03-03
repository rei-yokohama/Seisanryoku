"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import { AppShell } from "../../AppShell";

type MemberProfile = {
  uid: string;
  companyCode: string;
  displayName?: string | null;
};

type IssuerProfile = {
  id: string;
  name: string;
  companyName: string;
  corporateNumber?: string;
  postalCode?: string;
  address?: string;
  tel?: string;
  bankName: string;
  branchName: string;
  accountType: "普通" | "当座";
  accountNumber: string;
  accountHolder: string;
  isDefault?: boolean;
};

const EMPTY_PROFILE: Omit<IssuerProfile, "id"> = {
  name: "",
  companyName: "",
  corporateNumber: "",
  postalCode: "",
  address: "",
  tel: "",
  bankName: "",
  branchName: "",
  accountType: "普通",
  accountNumber: "",
  accountHolder: "",
  isDefault: false,
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default function BillingSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [profiles, setProfiles] = useState<IssuerProfile[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<IssuerProfile, "id">>(EMPTY_PROFILE);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/login"); return; }
      setUser(u);
      try {
        const prof = await ensureProfile(u);
        if (!prof?.companyCode) { router.push("/login"); return; }
        setProfile(prof as MemberProfile);

        const compSnap = await getDoc(doc(db, "companies", prof.companyCode));
        const owner = compSnap.exists() && (compSnap.data() as any).ownerUid === u.uid;
        setIsOwner(owner);

        const snap = await getDoc(doc(db, "billingSettings", prof.companyCode));
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.profiles)) setProfiles(data.profiles);
        }
      } catch (e) {
        console.warn("billing settings load failed:", e);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router]);

  const saveProfiles = async (next: IssuerProfile[]) => {
    if (!profile?.companyCode || !user) return;
    setSaving(true);
    setSaveMsg("");
    try {
      await setDoc(doc(db, "billingSettings", profile.companyCode), {
        companyCode: profile.companyCode,
        profiles: next,
        updatedAt: Timestamp.now(),
        updatedBy: user.uid,
      });
      setProfiles(next);
      setSaveMsg("保存しました");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e) {
      console.warn("save failed:", e);
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_PROFILE });
    setModalOpen(true);
  };

  const openEdit = (p: IssuerProfile) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      companyName: p.companyName,
      corporateNumber: p.corporateNumber || "",
      postalCode: p.postalCode || "",
      address: p.address || "",
      tel: p.tel || "",
      bankName: p.bankName,
      branchName: p.branchName,
      accountType: p.accountType,
      accountNumber: p.accountNumber,
      accountHolder: p.accountHolder,
      isDefault: p.isDefault || false,
    });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.companyName.trim() || !form.bankName.trim() || !form.branchName.trim() || !form.accountNumber.trim() || !form.accountHolder.trim()) {
      alert("必須項目を入力してください");
      return;
    }

    let next: IssuerProfile[];
    if (editingId) {
      next = profiles.map((p) => (p.id === editingId ? { ...form, id: editingId } : p));
    } else {
      next = [...profiles, { ...form, id: genId() }];
    }

    // デフォルトフラグ管理
    if (form.isDefault) {
      const targetId = editingId || next[next.length - 1].id;
      next = next.map((p) => ({ ...p, isDefault: p.id === targetId }));
    }

    saveProfiles(next);
    setModalOpen(false);
  };

  const handleDelete = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    saveProfiles(next);
    setDeleteConfirm(null);
  };

  const setDefault = (id: string) => {
    const next = profiles.map((p) => ({ ...p, isDefault: p.id === id }));
    saveProfiles(next);
  };

  if (loading) {
    return (
      <AppShell title="請求設定" subtitle="読み込み中...">
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-2xl font-extrabold text-orange-900">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="請求設定" subtitle="発行元・振込先情報">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-extrabold text-slate-900">発行元プロファイル</div>
              <div className="mt-1 text-sm font-bold text-slate-500">
                請求書PDFに表示する発行元情報と振込先口座を管理します。
              </div>
            </div>
            {isOwner && (
              <button
                onClick={openCreate}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 transition"
              >
                追加
              </button>
            )}
          </div>

          {profiles.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <div className="text-sm font-bold text-slate-500">
                プロファイルがまだありません。
              </div>
              <div className="mt-1 text-xs font-bold text-slate-400">
                「追加」ボタンから発行元情報を登録してください。
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-slate-900">{p.name}</span>
                        {p.isDefault && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-extrabold text-orange-700">
                            デフォルト
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">{p.companyName}</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
                        {p.corporateNumber && <div>法人番号: {p.corporateNumber}</div>}
                        {p.postalCode && <div>〒{p.postalCode}</div>}
                        {p.address && <div>{p.address}</div>}
                        {p.tel && <div>TEL: {p.tel}</div>}
                        <div>{p.bankName} {p.branchName}</div>
                        <div>{p.accountType} {p.accountNumber}</div>
                        <div>名義: {p.accountHolder}</div>
                      </div>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!p.isDefault && (
                          <button
                            onClick={() => setDefault(p.id)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                          >
                            デフォルトに設定
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                        >
                          編集
                        </button>
                        {deleteConfirm === p.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="rounded-md bg-red-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-red-700"
                            >
                              削除する
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                            >
                              キャンセル
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(p.id)}
                            className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {saveMsg && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-bold text-green-700">
              {saveMsg}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end">
            <Link
              href="/settings"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              戻る
            </Link>
          </div>
        </div>
      </div>

      {/* モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="text-lg font-extrabold text-slate-900">
              {editingId ? "プロファイル編集" : "プロファイル追加"}
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600">プロファイル名 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例: メインプロファイル"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">社名 *</label>
                <input
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                  placeholder="例: 株式会社サンプル"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">法人番号</label>
                <input
                  value={form.corporateNumber}
                  onChange={(e) => setForm((f) => ({ ...f, corporateNumber: e.target.value }))}
                  placeholder="例: 1234567890123"
                  maxLength={13}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">郵便番号</label>
                  <input
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    placeholder="000-0000"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">電話番号</label>
                  <input
                    value={form.tel}
                    onChange={(e) => setForm((f) => ({ ...f, tel: e.target.value }))}
                    placeholder="03-0000-0000"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">住所</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="東京都..."
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="border-t border-slate-200 pt-3 mt-3">
                <div className="text-xs font-extrabold text-slate-700 mb-2">振込先口座情報</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">銀行名 *</label>
                  <input
                    value={form.bankName}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="例: 三菱UFJ銀行"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">支店名 *</label>
                  <input
                    value={form.branchName}
                    onChange={(e) => setForm((f) => ({ ...f, branchName: e.target.value }))}
                    placeholder="例: 渋谷支店"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600">口座種別 *</label>
                  <select
                    value={form.accountType}
                    onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value as "普通" | "当座" }))}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    <option value="普通">普通</option>
                    <option value="当座">当座</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600">口座番号 *</label>
                  <input
                    value={form.accountNumber}
                    onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                    placeholder="1234567"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600">口座名義 *</label>
                <input
                  value={form.accountHolder}
                  onChange={(e) => setForm((f) => ({ ...f, accountHolder: e.target.value }))}
                  placeholder="カ）サンプル"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={form.isDefault || false}
                  onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
                />
                <label className="text-xs font-bold text-slate-600">デフォルトプロファイルとして設定</label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-orange-700 disabled:bg-orange-400 transition"
              >
                {saving ? "保存中..." : editingId ? "更新" : "追加"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
