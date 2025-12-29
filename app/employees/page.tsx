"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged, User, sendPasswordResetEmail } from "firebase/auth";
import { collection, query, where, getDocs, addDoc, doc, getDoc, deleteDoc, updateDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "../AppShell";

// ランダムパスワード生成関数
const generateRandomPassword = (length: number = 12): string => {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
};

type MemberProfile = {
  uid: string;
  displayName?: string | null;
  companyName?: string | null;
  email?: string | null;
  companyCode: string;
  calendarLinked?: boolean;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  employmentType: "正社員" | "契約社員" | "パート" | "アルバイト" | "業務委託";
  joinDate: string;
  color?: string; // カレンダー表示用の色
  allowCalendarSync?: boolean; // Googleカレンダー連携を許可するか
  authUid?: string; // Firebase AuthenticationのUID
  password?: string; // 初期パスワード（管理者が参照用）
  companyCode?: string;
  createdBy: string;
  createdAt?: Timestamp;
};

// 社員カラーパレット
const EMPLOYEE_COLORS = [
  { name: "ブルー", value: "#3B82F6", light: "#DBEAFE", border: "#2563EB" },
  { name: "グリーン", value: "#10B981", light: "#D1FAE5", border: "#059669" },
  { name: "パープル", value: "#8B5CF6", light: "#EDE9FE", border: "#7C3AED" },
  { name: "ピンク", value: "#EC4899", light: "#FCE7F3", border: "#DB2777" },
  { name: "オレンジ", value: "#F97316", light: "#FFEDD5", border: "#EA580C" },
  { name: "レッド", value: "#EF4444", light: "#FEE2E2", border: "#DC2626" },
  { name: "イエロー", value: "#EAB308", light: "#FEF9C3", border: "#CA8A04" },
  { name: "シアン", value: "#06B6D4", light: "#CFFAFE", border: "#0891B2" },
  { name: "インディゴ", value: "#6366F1", light: "#E0E7FF", border: "#4F46E5" },
  { name: "ティール", value: "#14B8A6", light: "#CCFBF1", border: "#0D9488" },
];

export default function EmployeesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    employmentType: "正社員" as Employee["employmentType"],
    joinDate: new Date().toISOString().split("T")[0],
    color: EMPLOYEE_COLORS[0].value,
    allowCalendarSync: true,
  });

  // パスワード表示用
  const [generatedPassword, setGeneratedPassword] = useState<string>("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [createdEmployeeEmail, setCreatedEmployeeEmail] = useState<string>("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  const router = useRouter();

  const loadEmployees = async (uid: string, companyCode?: string) => {
    const merged: Employee[] = [];

    // まず companyCode で検索（通常ルート）
    if (companyCode) {
      console.log("社員管理: companyCodeで検索:", companyCode);
      const snapByCompany = await getDocs(
        query(collection(db, "employees"), where("companyCode", "==", companyCode)),
      );
      merged.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    }

    // companyCode未設定の過去データ救済 / companyCode不整合の救済として createdBy も併用
    console.log("社員管理: createdByで検索(フォールバック/併用):", uid);
    const snapByCreator = await getDocs(
      query(collection(db, "employees"), where("createdBy", "==", uid)),
    );
    merged.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));

    // id で重複排除
    const byId = new Map<string, Employee>();
    for (const e of merged) byId.set(e.id, e);
    const items = Array.from(byId.values());

    console.log("社員管理: 読み込んだ社員数:", items.length);
    console.log("社員管理: 社員データ:", items);
    setEmployees(items);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        router.push("/login");
        return;
      }

      const profSnap = await getDoc(doc(db, "profiles", u.uid));
      if (profSnap.exists()) {
        const data = profSnap.data() as MemberProfile;
        setProfile(data);
        await loadEmployees(u.uid, data.companyCode);
      } else {
        await loadEmployees(u.uid);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      if (editingEmployee) {
        // 更新
        await updateDoc(doc(db, "employees", editingEmployee.id), {
          name: formData.name,
          email: formData.email,
          employmentType: formData.employmentType,
          joinDate: formData.joinDate,
          color: formData.color,
          allowCalendarSync: formData.allowCalendarSync,
        });
        setEmployees(prev =>
          prev.map(emp =>
            emp.id === editingEmployee.id
              ? { ...emp, ...formData }
              : emp
          )
        );
        
        // フォームリセット
        setFormData({
          name: "",
          email: "",
          employmentType: "正社員",
          joinDate: new Date().toISOString().split("T")[0],
          color: EMPLOYEE_COLORS[0].value,
          allowCalendarSync: true,
        });
        setShowForm(false);
        setEditingEmployee(null);
      } else {
        // 新規作成
        // ランダムパスワードを生成
        const password = generateRandomPassword(12);
        
        // Firebase Authenticationにユーザーを作成
        const authResponse = await fetch("/api/create-user", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: formData.email,
            password: password,
            displayName: formData.name,
          }),
        });

        const authData = await authResponse.json();

        if (!authResponse.ok) {
          throw new Error(authData.error || "認証アカウントの作成に失敗しました");
        }

        // 社員情報を保存（Firebase AuthenticationのUIDとパスワードも保存）
        const employeeData = {
          ...formData,
          authUid: authData.uid, // Firebase AuthenticationのUID
          password: password, // 初期パスワード（管理者参照用）
          companyCode: profile?.companyCode || "",
          createdBy: user.uid,
          createdAt: Timestamp.now(),
        };
        console.log("社員管理: 保存する社員データ:", employeeData);
        const docRef = await addDoc(collection(db, "employees"), employeeData);
        console.log("社員管理: 社員を保存しました。docRef.id:", docRef.id);
        setEmployees(prev => [
          { 
            id: docRef.id, 
            ...formData,
            color: formData.color,
            authUid: authData.uid,
            password: password,
            companyCode: profile?.companyCode || "",
            createdBy: user.uid
          },
          ...prev,
        ]);

        // パスワードを表示
        setGeneratedPassword(password);
        setCreatedEmployeeEmail(formData.email);
        setShowPasswordModal(true);

        // フォームリセット
        setFormData({
          name: "",
          email: "",
          employmentType: "正社員",
          joinDate: new Date().toISOString().split("T")[0],
          color: EMPLOYEE_COLORS[0].value,
          allowCalendarSync: true,
        });
        setShowForm(false);
        setEditingEmployee(null);
      }
    } catch (error) {
      console.error("Error saving employee:", error);
      alert("社員情報の保存に失敗しました");
    }
  };

  const handleEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      name: employee.name,
      email: employee.email,
      employmentType: employee.employmentType,
      joinDate: employee.joinDate,
      color: employee.color || EMPLOYEE_COLORS[0].value,
      allowCalendarSync: employee.allowCalendarSync ?? true,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この社員を削除してもよろしいですか？")) return;

    try {
      await deleteDoc(doc(db, "employees", id));
      setEmployees(prev => prev.filter(emp => emp.id !== id));
    } catch (error) {
      console.error("Error deleting employee:", error);
      alert("社員の削除に失敗しました");
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingEmployee(null);
    setFormData({
      name: "",
      email: "",
      employmentType: "正社員",
      joinDate: new Date().toISOString().split("T")[0],
      color: EMPLOYEE_COLORS[0].value,
      allowCalendarSync: true,
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("クリップボードにコピーしました！");
  };

  const togglePasswordVisibility = (employeeId: string) => {
    setVisiblePasswords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(employeeId)) {
        newSet.delete(employeeId);
      } else {
        newSet.add(employeeId);
      }
      return newSet;
    });
  };

  const handleSendPasswordResetEmail = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      alert(`${email} にパスワードリセットメールを送信しました。`);
    } catch (error) {
      console.error("Error sending password reset email:", error);
      alert("パスワードリセットメールの送信に失敗しました。");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-emerald-100">
        <div className="text-2xl font-bold text-emerald-900">読み込み中...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <AppShell
      title="社員"
      subtitle="Employees"
      headerRight={
        <Link href="/calendar" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
          カレンダー
        </Link>
      }
    >
      <div className="mx-auto max-w-7xl">
        {/* Header Section */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-emerald-950">👥 社員管理</h1>
            <p className="text-emerald-700">
              {profile?.companyCode 
                ? `会社コード: ${profile.companyCode}` 
                : "社員の追加・編集・削除ができます"}
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-6 py-3 font-bold text-emerald-950 shadow-lg transition hover:scale-105"
            >
              + 社員を追加
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="mb-6 rounded-2xl border-2 border-emerald-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-emerald-950">
                {editingEmployee ? "社員情報を編集" : "新しい社員を追加"}
              </h2>
              <button
                onClick={handleCancel}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                title="閉じる"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-emerald-900">
                    名前 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="山田 太郎"
                    required
                    className="w-full rounded-lg border-2 border-emerald-200 bg-white px-4 py-2 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-emerald-900">
                    メールアドレス <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="yamada@example.com"
                    required
                    className="w-full rounded-lg border-2 border-emerald-200 bg-white px-4 py-2 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-emerald-900">
                    雇用形態 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.employmentType}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        employmentType: e.target.value as Employee["employmentType"],
                      }))
                    }
                    className="w-full rounded-lg border-2 border-emerald-200 bg-white px-4 py-2 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  >
                    <option value="正社員">正社員</option>
                    <option value="契約社員">契約社員</option>
                    <option value="パート">パート</option>
                    <option value="アルバイト">アルバイト</option>
                    <option value="業務委託">業務委託</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold text-emerald-900">
                    入社日 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.joinDate}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, joinDate: e.target.value }))
                    }
                    required
                    className="w-full rounded-lg border-2 border-emerald-200 bg-white px-4 py-2 text-emerald-950 placeholder:text-emerald-400 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-emerald-900">
                  カレンダー表示色 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-5 gap-3">
                  {EMPLOYEE_COLORS.map((colorOption) => (
                    <button
                      key={colorOption.value}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, color: colorOption.value }))}
                      className={`group relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition hover:scale-105 ${
                        formData.color === colorOption.value
                          ? "border-emerald-500 bg-emerald-50 shadow-lg"
                          : "border-gray-200 hover:border-emerald-300"
                      }`}
                    >
                      <div
                        className="h-8 w-8 rounded-full shadow-md"
                        style={{ backgroundColor: colorOption.value }}
                      ></div>
                      <span className="text-xs font-medium text-gray-700">{colorOption.name}</span>
                      {formData.color === colorOption.value && (
                        <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/30 p-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.allowCalendarSync}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, allowCalendarSync: e.target.checked }))
                      }
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded border-2 border-emerald-300 checked:border-emerald-600 checked:bg-emerald-600 focus:ring-2 focus:ring-emerald-200 transition"
                    />
                    <svg
                      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M3 6L5 8L9 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-emerald-900">
                      📅 Googleカレンダー連携を許可
                    </span>
                    <p className="text-xs text-emerald-700 mt-1">
                      この社員がGoogleアカウントと連携してカレンダーデータを同期できるようにします
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg border-2 border-gray-300 px-6 py-2 font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-6 py-2 font-bold text-emerald-950 shadow-lg transition hover:scale-105"
                >
                  {editingEmployee ? "更新" : "追加"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Employees List */}
        <div className="rounded-2xl border-2 border-emerald-200 bg-white p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-bold text-emerald-950">
            社員一覧 ({employees.length}人)
          </h2>
          
          {employees.length === 0 ? (
            <div className="py-12 text-center text-emerald-600">
              まだ社員が登録されていません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-emerald-200 bg-emerald-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      名前
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      メールアドレス
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      雇用形態
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      認証状態
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      パスワード
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      カレンダー連携
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-emerald-900">
                      入社日
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-emerald-900">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr
                      key={employee.id}
                      className="border-b border-emerald-100 transition hover:bg-emerald-50/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-6 w-6 rounded-full border-2 border-white shadow-md"
                            style={{ backgroundColor: employee.color || EMPLOYEE_COLORS[0].value }}
                          ></div>
                          <span className="font-semibold text-emerald-950">{employee.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-emerald-700">{employee.email}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                          {employee.employmentType}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {employee.authUid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            認証済み
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            未認証
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {employee.password ? (
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-gray-100 px-2 py-1 text-xs font-mono text-gray-900">
                              {visiblePasswords.has(employee.id) ? employee.password : '••••••••'}
                            </code>
                            <button
                              onClick={() => togglePasswordVisibility(employee.id)}
                              className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                              title={visiblePasswords.has(employee.id) ? "非表示" : "表示"}
                            >
                              {visiblePasswords.has(employee.id) ? (
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              )}
                            </button>
                            <button
                              onClick={() => copyToClipboard(employee.password!)}
                              className="rounded p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                              title="コピー"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {employee.allowCalendarSync !== false ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                            </svg>
                            許可
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                            </svg>
                            不許可
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-emerald-700">
                        {new Date(employee.joinDate).toLocaleDateString("ja-JP")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleSendPasswordResetEmail(employee.email)}
                          className="mr-2 rounded-lg border-2 border-blue-500 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                          title="パスワードリセットメールを送信"
                        >
                          🔑 リセット
                        </button>
                        <button
                          onClick={() => handleEdit(employee)}
                          className="mr-2 rounded-lg border-2 border-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(employee.id)}
                          className="rounded-lg border-2 border-red-500 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Password Display Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-500 text-3xl text-emerald-950">
                  ✅
                </div>
              </div>
              <h2 className="mb-2 text-2xl font-bold text-emerald-950">社員を追加しました</h2>
              <p className="text-sm text-emerald-700">以下のログイン情報を社員に共有してください</p>
            </div>

            <div className="mb-6 space-y-4">
              {/* Email */}
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
                <p className="mb-1 text-xs font-semibold text-emerald-700">メールアドレス</p>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-sm font-semibold text-emerald-950">{createdEmployeeEmail}</p>
                  <button
                    onClick={() => copyToClipboard(createdEmployeeEmail)}
                    className="rounded-lg bg-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-300"
                  >
                    コピー
                  </button>
                </div>
              </div>

              {/* Password */}
              <div className="rounded-xl border-2 border-green-200 bg-green-50 p-4">
                <p className="mb-1 text-xs font-semibold text-green-700">初期パスワード</p>
                <div className="flex items-center justify-between">
                  <p className="break-all font-mono text-sm font-semibold text-green-950">{generatedPassword}</p>
                  <button
                    onClick={() => copyToClipboard(generatedPassword)}
                    className="ml-2 rounded-lg bg-green-200 px-3 py-1 text-xs font-semibold text-green-900 transition hover:bg-green-300"
                  >
                    コピー
                  </button>
                </div>
              </div>

              {/* Copy Both */}
              <button
                onClick={() => copyToClipboard(`メール: ${createdEmployeeEmail}\nパスワード: ${generatedPassword}`)}
                className="w-full rounded-lg border-2 border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50"
              >
                📋 両方をコピー
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-emerald-50 p-4 text-xs text-emerald-800">
              ⚠️ <strong>重要:</strong> このパスワードは一度しか表示されません。必ずメモしてから閉じてください。
              <br />
              <br />
              社員は
              <Link href="/employee-login" className="font-bold text-blue-600 underline">
                社員用ログインページ
              </Link>
              から、このメールアドレスとパスワードで直接ログインできます。
            </div>

            <button
              onClick={() => {
                setShowPasswordModal(false);
                setGeneratedPassword("");
                setCreatedEmployeeEmail("");
              }}
              className="w-full rounded-lg bg-gradient-to-r from-emerald-400 to-emerald-500 px-4 py-3 font-bold text-emerald-950 shadow-lg transition hover:scale-105"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}

