"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "../../../lib/firebase";
import { ensureProfile } from "../../../lib/ensureProfile";
import type { Issue, Project } from "../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, normalizeProjectKey } from "../../../lib/backlog";
import { logActivity, pushNotification } from "../../../lib/activity";
import { sendIssueWebhook } from "../../../lib/webhook";
import { ensureProperties, statusToValue } from "../../../lib/properties";
import type { Property } from "../../../lib/properties";
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

type Customer = {
  id: string;
  name: string;
  companyCode: string;
  createdBy: string;
};

type DealProject = Project & { customerId: string };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function toHoursText(minutes?: number | null) {
  if (!minutes || minutes <= 0) return "";
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
}

function fromHoursText(text: string) {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 60);
}

// 8文字のランダムなIDを生成
function generateShortId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function NewIssueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdParam = searchParams.get("projectId") || "";
  const customerIdParam = searchParams.get("customerId") || "";
  const statusParam = (searchParams.get("status") || "").toUpperCase();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [projects, setProjects] = useState<DealProject[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<DealProject | null>(null);
  const [issuesInProject, setIssuesInProject] = useState<Issue[]>([]);

  // 今日の日付と3日後の日付を YYYY-MM-DD 形式で取得
  const getDefaultDates = () => {
    const today = new Date();
    const threeDaysLater = new Date(today);
    threeDaysLater.setDate(today.getDate() + 3);
    
    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    return {
      startDate: formatDate(today),
      dueDate: formatDate(threeDaysLater),
    };
  };

  const defaultDates = useMemo(() => getDefaultDates(), []);

  // form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Issue["status"]>("TODO");
  const [priority, setPriority] = useState<Issue["priority"]>("MEDIUM");
  const [assigneeUids, setAssigneeUids] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaultDates.startDate);
  const [dueDate, setDueDate] = useState(defaultDates.dueDate);
  const [estimateHours, setEstimateHours] = useState("");
  const [category, setCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<{ value: string; label: string }[]>(ISSUE_STATUSES);
  const [labelsText, setLabelsText] = useState("");
  const [parentIssueId, setParentIssueId] = useState("");

  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const descRef = useRef<HTMLTextAreaElement | null>(null);

  const labelList = useMemo(() => {
    const raw = labelsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((l) => l !== category);
    const list = category ? [category, ...raw] : raw;
    return Array.from(new Set(list)).slice(0, 20);
  }, [category, labelsText]);

  const myDisplayName = useMemo(() => {
    return profile?.displayName || user?.email?.split("@")[0] || "ユーザー";
  }, [profile?.displayName, user?.email]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      const prof = (await ensureProfile(u)) as MemberProfile | null;
      if (!prof) {
        setLoading(false);
        router.push("/login");
        return;
      }
      setProfile(prof);

      // customers
      const mergedCustomers: Customer[] = [];
      if (prof.companyCode) {
        const snapByCompany = await getDocs(query(collection(db, "customers"), where("companyCode", "==", prof.companyCode)));
        mergedCustomers.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      } else {
        const snapByCreatorCustomers = await getDocs(query(collection(db, "customers"), where("createdBy", "==", u.uid)));
        mergedCustomers.push(...snapByCreatorCustomers.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      }
      const custById = new Map<string, Customer>();
      for (const c of mergedCustomers) custById.set(c.id, c);
      const customerItems = Array.from(custById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setCustomers(customerItems);

      // deals (案件) を取得: /projects に表示される案件一覧
      const mergedDeals: any[] = [];
      if (prof.companyCode) {
        const snapByCompany = await getDocs(query(collection(db, "deals"), where("companyCode", "==", prof.companyCode)));
        mergedDeals.push(...snapByCompany.docs.map((d) => ({ id: d.id, ...d.data() })));
      } else {
        const snapByCreator = await getDocs(query(collection(db, "deals"), where("createdBy", "==", u.uid)));
        mergedDeals.push(...snapByCreator.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      const byId = new Map<string, any>();
      for (const p of mergedDeals) byId.set(p.id, p);
      // deal を project として扱えるように name/key を生成
      const projItems = Array.from(byId.values()).map((d) => ({
        ...d,
        name: d.title || "無題",
        key: d.key || d.title?.slice(0, 5)?.toUpperCase() || "DEAL",
        issueSeq: d.issueSeq || 0,
      } as DealProject)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setProjects(projItems);

      // employees (for assignee)
      const mergedEmployees: Employee[] = [];
      if (prof.companyCode) {
        const snapEmpByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
        mergedEmployees.push(...snapEmpByCompany.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
      } else {
        const snapEmpByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
        mergedEmployees.push(...snapEmpByCreator.docs.map((d) => ({ id: d.id, ...d.data() } as Employee)));
      }
      const empById = new Map<string, Employee>();
      for (const e of mergedEmployees) empById.set(e.id, e);
      const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setEmployees(empItems);

      // properties (カテゴリ・ステータス)
      if (prof.companyCode) {
        const props = await ensureProperties(prof.companyCode);
        const catProp = props.find((p) => p.key === "category");
        if (catProp) setCategoryOptions(catProp.options);
        const statusProp = props.find((p) => p.key === "issueStatus");
        if (statusProp) {
          setStatusOptions(statusProp.options.map((label) => ({ value: statusToValue(label), label })));
        }
      }

      // initial customer / project
      let initialProjectId = "";
      if (projectIdParam && projItems.some((p) => p.id === projectIdParam)) {
        initialProjectId = projectIdParam;
      } else if (customerIdParam) {
        initialProjectId = projItems.find((p) => p.customerId === customerIdParam)?.id || "";
      } else {
        initialProjectId = projItems[0]?.id || "";
      }

      const initialProject = initialProjectId ? (projItems.find((p) => p.id === initialProjectId) || null) : null;
      const initialCustomerId =
        (initialProject?.customerId || "") ||
        (customerIdParam && customerItems.some((c) => c.id === customerIdParam) ? customerIdParam : "") ||
        customerItems[0]?.id ||
        "";

      setCustomerId(initialCustomerId);
      const firstDealInCustomer = initialCustomerId ? (projItems.find((p) => p.customerId === initialCustomerId)?.id || "") : "";
      setProjectId(initialProjectId && (!initialCustomerId || initialProject?.customerId === initialCustomerId) ? initialProjectId : (firstDealInCustomer || initialProjectId));

      setLoading(false);
    });
    return () => unsub();
  }, [router, projectIdParam, customerIdParam]);

  useEffect(() => {
    if (statusParam === "TODO" || statusParam === "IN_PROGRESS" || statusParam === "DONE") {
      setStatus(statusParam as Issue["status"]);
    }
  }, [statusParam]);

  useEffect(() => {
    const loadProjectAndIssues = async () => {
      if (!projectId) {
        setProject(null);
        setIssuesInProject([]);
        return;
      }
      const p = projects.find((pp) => pp.id === projectId) || null;
      setProject(p);
      if (!profile?.companyCode) {
        setIssuesInProject([]);
        return;
      }
      // companyでまとめて取って projectIdでフィルタ（index回避）
      const snap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", profile.companyCode)));
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Issue))
        .filter((i) => i.projectId === projectId);
      items.sort((a, b) => (a.issueKey || "").localeCompare(b.issueKey || ""));
      setIssuesInProject(items);
    };
    void loadProjectAndIssues();
  }, [projectId, projects, profile?.companyCode]);

  // 顧客変更で案件を絞る（案件側変更時は顧客も追従）
  useEffect(() => {
    if (!customerId) return;
    if (projectId) {
      const cur = projects.find((p) => p.id === projectId);
      if (cur && cur.customerId === customerId) return;
    }
    const next = projects.find((p) => p.customerId === customerId);
    setProjectId(next?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, projects]);

  const goDashboard = () => {
    router.push(`/dashboard${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
  };

  const insertAtCursor = (before: string, after = "") => {
    const el = descRef.current;
    if (!el) {
      setDescription((prev) => prev + before + after);
      return;
    }
    const start = el.selectionStart ?? description.length;
    const end = el.selectionEnd ?? description.length;
    const selected = description.slice(start, end);
    const next = description.slice(0, start) + before + selected + after + description.slice(end);
    setDescription(next);
    // restore selection
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + selected.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p?.customerId) setCustomerId(p.customerId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("projectId", id);
    if (p?.customerId) params.set("customerId", p.customerId);
    router.replace(`/issue/new?${params.toString()}`);
  };

  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    const nextDeal = projects.find((p) => p.customerId === id)?.id || "";
    setProjectId(nextDeal);
    const params = new URLSearchParams(searchParams.toString());
    params.set("customerId", id);
    if (nextDeal) params.set("projectId", nextDeal);
    router.replace(`/issue/new?${params.toString()}`);
  };

  const handleSubmit = async () => {
    if (!user || !profile) return;
    setError("");
    const t = title.trim();
    const companyCode = (profile.companyCode || "").trim();
    if (!companyCode) {
      setError("会社情報の読み込みに失敗しました。ページを再読み込みしてください。");
      return;
    }
    if (!customerId) {
      setError("顧客を選択してください");
      return;
    }
    if (!projectId) {
      setError("案件を選択してください");
      return;
    }
    if (!t) {
      setError("件名を入力してください");
      return;
    }
    if (!project?.key) {
      setError("プロジェクトキーが未設定です（プロジェクト設定を確認してください）");
      return;
    }

    setSaving(true);
    try {
      // 8文字のランダムなIDを生成
      const shortIssueId = generateShortId();
      
      // deals コレクションから案件を取得して issueSeq を更新
      const dealRef = doc(db, "deals", projectId);
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(dealRef);
        if (!snap.exists()) throw new Error("案件が見つかりません");
        const data = snap.data();
        const nextSeq = (data.issueSeq || 0) + 1;
        const dealKey = data.key || data.title?.slice(0, 5)?.toUpperCase() || "DEAL";
        tx.update(dealRef, { issueSeq: nextSeq, key: dealKey });
        const issueKey = `${normalizeProjectKey(dealKey)}-${nextSeq}`;
        // 8文字のカスタムIDを使用
        const issueRef = doc(db, "issues", shortIssueId);
        tx.set(issueRef, {
          id: shortIssueId,
          companyCode,
          customerId,
          projectId,
          issueKey,
          title: t,
          description: description.trim() || "",
          status,
          priority,
          assigneeUids: assigneeUids.length > 0 ? assigneeUids : null,
          assigneeUid: assigneeUids[0] || null,
          reporterUid: user.uid,
          labels: labelList,
          propertyValues: { category: category || "" },
          startDate: startDate || null,
          dueDate: dueDate || null,
          estimateMinutes: fromHoursText(estimateHours) || null,
          parentIssueId: parentIssueId || null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        return { issueId: shortIssueId, issueKey };
      });

      await logActivity({
        companyCode,
        actorUid: user.uid,
        type: "ISSUE_CREATED",
        projectId,
        issueId: result.issueId,
        entityId: result.issueId,
        message: `課題を作成: ${result.issueKey} ${t}`,
        link: `/issue/${result.issueId}`,
      });

      for (const uid of assigneeUids) {
        if (uid && uid !== user.uid) {
          await pushNotification({
            companyCode,
            recipientUid: uid,
            actorUid: user.uid,
            type: "ASSIGNED",
            title: `課題が割り当てられました: ${result.issueKey}`,
            body: t,
            link: `/issue/${result.issueId}`,
          });
        }
      }

      // Webhook通知（fire-and-forget）
      void sendIssueWebhook(companyCode, {
        issueKey: result.issueKey,
        title: t,
        status,
        priority,
        assigneeName: assigneeUids.length > 0
          ? assigneeUids.map((uid) => uid === user.uid ? myDisplayName : (employees.find((e) => e.authUid === uid)?.name ?? "")).filter(Boolean).join(", ")
          : undefined,
        reporterName: myDisplayName,
        projectName: project?.name,
        link: `/issue/${result.issueId}`,
      });

      // 作成した課題の詳細へ遷移
      router.push(`/issue/${result.issueId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "課題の作成に失敗しました";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="課題の追加" subtitle="読み込み中..." projectId={projectId}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title="課題の追加"
      subtitle={project ? project.name : ""}
      projectId={projectId}
    >
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-extrabold text-slate-900">課題の追加</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            {showPreview ? "編集" : "プレビュー"}
          </button>
        </div>
      </div>

      {/* Customer / Deal Selector */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-6">
            <div className="text-xs font-bold text-slate-600 mb-2">顧客 *</div>
            <select
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
            >
              <option value="">顧客を選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-6">
            <div className="text-xs font-bold text-slate-600 mb-2">案件 *</div>
            <select
              value={projectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:ring-1 focus:ring-orange-500"
              disabled={!customerId}
            >
              {!customerId ? <option value="">先に顧客を選択してください</option> : <option value="">案件を選択してください</option>}
              {projects
                .filter((p) => !customerId || p.customerId === customerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="text-xs font-extrabold text-slate-600">優先度</div>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Issue["priority"])}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                {ISSUE_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <div className="text-xs font-extrabold text-slate-600">カテゴリ</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
              >
                <option value="">未設定</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4 flex items-end justify-end gap-2">
              <button
                onClick={() => setParentIssueId("")}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                type="button"
              >
                親課題を設定する
              </button>
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-600">件名</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-orange-300 bg-orange-50/30 px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-orange-500"
                placeholder="件名"
              />
            </div>

            <div className="md:col-span-12">
              <div className="text-xs font-extrabold text-slate-600">課題の詳細（@ を入力してメンバーに通知：準備中）</div>
              <div className="mt-2 rounded-md border border-slate-200">
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
                    ref={descRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[260px] w-full resize-y px-3 py-3 text-sm text-slate-800 outline-none"
                    placeholder="ここに詳細を書いてください"
                  />
                ) : (
                  <div className="min-h-[260px] whitespace-pre-wrap px-3 py-3 text-sm text-slate-800">
                    {description.trim() ? description : "（プレビュー：内容がありません）"}
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-12 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">状態</div>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Issue["status"])}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">担当（複数選択可）</div>
                  <div className="mt-1 flex flex-wrap gap-2 rounded-md border border-slate-200 bg-white p-2 min-h-[42px]">
                    {assigneeUids.length === 0 && (
                      <span className="text-sm text-slate-400">未割当</span>
                    )}
                    {assigneeUids.map((uid) => {
                      const name = uid === user.uid ? myDisplayName : (employees.find((e) => e.authUid === uid)?.name ?? "不明");
                      return (
                        <span
                          key={uid}
                          className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => setAssigneeUids((prev) => prev.filter((u) => u !== uid))}
                            className="text-orange-500 hover:text-orange-700"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      const v = (e.target.value || "").trim();
                      if (!v) return;
                      setAssigneeUids((prev) => (prev.includes(v) ? prev : [...prev, v]));
                      e.target.value = "";
                    }}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    <option value="">＋ 担当を追加...</option>
                    {user && !assigneeUids.includes(user.uid) && (
                      <option value={user.uid}>{myDisplayName}</option>
                    )}
                    {employees
                      .filter((e) => !!e.authUid && e.authUid !== user?.uid && !assigneeUids.includes(e.authUid!))
                      .map((e) => (
                        <option key={e.id} value={e.authUid!}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">開始日</div>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">期限日</div>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">予定時間（hours）</div>
                  <input
                    value={estimateHours}
                    onChange={(e) => setEstimateHours(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder={toHoursText(60)}
                  />
                </div>

                <div className="md:col-span-6">
                  <div className="text-xs font-extrabold text-slate-600">ラベル（カンマ区切り）</div>
                  <input
                    value={labelsText}
                    onChange={(e) => setLabelsText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                    placeholder="例: フロント,急ぎ"
                  />
                  {labelList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {labelList.map((l) => (
                        <span key={l} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="md:col-span-12">
                  <div className="text-xs font-extrabold text-slate-600">親課題（任意）</div>
                  <select
                    value={parentIssueId}
                    onChange={(e) => setParentIssueId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                  >
                    <option value="">なし</option>
                    {issuesInProject.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.issueKey} {i.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={goDashboard}
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

export default function NewIssuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="text-2xl font-bold text-orange-800">読み込み中...</div>
        </div>
      }
    >
      <NewIssueInner />
    </Suspense>
  );
}


