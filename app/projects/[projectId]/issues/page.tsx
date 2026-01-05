"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { auth, db } from "../../../../lib/firebase";
import { ensureProfile } from "../../../../lib/ensureProfile";
import type { Issue } from "../../../../lib/backlog";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../../../../lib/backlog";
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

type Deal = {
  id: string;
  companyCode: string;
  title: string;
  key?: string;
  customerId?: string;
};

type Customer = {
  id: string;
  name: string;
};

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getCategoryFromIssue(i: Issue) {
  // MVP: labelsの先頭をカテゴリ扱い
  return (i.labels && i.labels[0]) ? String(i.labels[0]) : "";
}

export default function ProjectIssuesPage() {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Deal | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // filters
  const [statusFilter, setStatusFilter] = useState<"ALL" | "NOT_DONE" | Issue["status"]>("NOT_DONE");
  const [assigneeFilter, setAssigneeFilter] = useState<string>(""); // authUid
  const [priorityFilter, setPriorityFilter] = useState<string>(""); // IssuePriority
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");

  const [page, setPage] = useState(1);
  const pageSize = 20;

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
          setLoading(false);
          router.push("/login");
          return;
        }
        setProfile(prof);

        // deal（案件）
        const dSnap = await getDoc(doc(db, "deals", projectId));
        if (!dSnap.exists()) {
          setLoading(false);
          router.push("/projects");
          return;
        }
        const deal = { ...(dSnap.data() as Deal), id: projectId };
        setProject(deal);

        // customer（社名）
        if (deal.customerId) {
          try {
            const cSnap = await getDoc(doc(db, "customers", deal.customerId));
            setCustomer(cSnap.exists() ? ({ id: deal.customerId, ...(cSnap.data() as any) } as Customer) : null);
          } catch {
            setCustomer(null);
          }
        } else {
          setCustomer(null);
        }

        // employees (company + createdBy fallback)
        const mergedEmp: Employee[] = [];
        if (prof.companyCode) {
          const snapByCompany = await getDocs(query(collection(db, "employees"), where("companyCode", "==", prof.companyCode)));
          mergedEmp.push(...snapByCompany.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        }
        // companyCode が無い過去データ救済
        if (!prof.companyCode) {
          const snapByCreator = await getDocs(query(collection(db, "employees"), where("createdBy", "==", u.uid)));
          mergedEmp.push(...snapByCreator.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
        }
        const empById = new Map<string, Employee>();
        for (const e of mergedEmp) empById.set(e.id, e);
        const empItems = Array.from(empById.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setEmployees(empItems);

        // issues (index回避で companyCode だけ→projectIdでフィルタ)
        if (prof.companyCode) {
          const snap = await getDocs(query(collection(db, "issues"), where("companyCode", "==", prof.companyCode)));
          const items = snap.docs
            .map(d => ({ id: d.id, ...d.data() } as Issue))
            .filter(i => i.projectId === projectId);
          items.sort((a, b) => (a.issueKey || "").localeCompare(b.issueKey || ""));
          setIssues(items);
        } else {
          setIssues([]);
        }
      } catch (e) {
        console.warn("ProjectIssuesPage init failed:", e);
        // ここで /login に飛ばすと「ログイン済み→/dashboard」ループになりやすいので、画面側で扱う
        setIssues([]);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, projectId]);

  const assigneeName = (uid?: string | null) => {
    if (!uid) return "";
    if (uid === user?.uid) return profile?.displayName || user?.email?.split("@")[0] || "私";
    return employees.find(e => e.authUid === uid)?.name || "";
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) {
      const c = getCategoryFromIssue(i);
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [issues]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const out = issues.filter(i => {
      if (statusFilter === "NOT_DONE" && i.status === "DONE") return false;
      if (statusFilter !== "ALL" && statusFilter !== "NOT_DONE" && i.status !== statusFilter) return false;
      if (assigneeFilter && (i.assigneeUid || "") !== assigneeFilter) return false;
      if (priorityFilter && i.priority !== priorityFilter) return false;
      if (categoryFilter && getCategoryFromIssue(i) !== categoryFilter) return false;
      if (k) {
        const hay = `${i.issueKey} ${i.title} ${i.description || ""} ${(i.labels || []).join(" ")}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
    return out;
  }, [issues, statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, assigneeFilter, priorityFilter, categoryFilter, keyword]);

  if (loading) {
    return (
      <AppShell title="課題" subtitle="読み込み中...">
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="text-sm font-bold text-slate-600">読み込み中...</div>
        </div>
      </AppShell>
    );
  }

  if (!user || !profile) return null;

  return (
    <AppShell
      title={`${project?.key || ""} ${project?.title || ""}`.trim() || "課題"}
      subtitle="課題一覧"
      projectId={projectId}
      headerRight={
        <Link
          href={`/issue/new?projectId=${encodeURIComponent(projectId)}`}
          className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 transition"
        >
          課題を追加
        </Link>
      }
    >
      <div className="px-0 py-1">
          {/* Search bar like Backlog */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-extrabold text-slate-900">検索条件</div>
                <button className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-extrabold text-white">
                  シンプルな検索
                </button>
                <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700">
                  高度な検索
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700">
                  短いURL
                </button>
                <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700">
                  検索条件を保存
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-extrabold text-slate-700">
              <button
                onClick={() => setStatusFilter("ALL")}
                className={clsx("rounded-full px-3 py-1.5", statusFilter === "ALL" ? "bg-orange-600 text-white" : "bg-slate-100")}
              >
                すべて
              </button>
              {ISSUE_STATUSES.map(s => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={clsx("rounded-full px-3 py-1.5", statusFilter === s.value ? "bg-orange-600 text-white" : "bg-slate-100")}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={() => setStatusFilter("NOT_DONE")}
                className={clsx("rounded-full px-3 py-1.5", statusFilter === "NOT_DONE" ? "bg-orange-600 text-white" : "bg-slate-100")}
              >
                完了以外
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <div className="text-xs font-extrabold text-slate-500">カテゴリ</div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                >
                  <option value="">すべて</option>
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <div className="text-xs font-extrabold text-slate-500">担当者</div>
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                >
                  <option value="">すべて</option>
                  <option value={user.uid}>私</option>
                  {employees.filter(e => !!e.authUid && e.authUid !== user.uid).map(e => (
                    <option key={e.id} value={e.authUid}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <div className="text-xs font-extrabold text-slate-500">キーワード</div>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="キーワードを入力"
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                />
              </div>

              <div className="md:col-span-3">
                <div className="text-xs font-extrabold text-slate-500">優先度</div>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800"
                >
                  <option value="">すべて</option>
                  {ISSUE_PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* List header */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-700">
              全 {total} 件中 {total === 0 ? 0 : pageStart + 1} 〜 {Math.min(total, pageStart + pageSize)} 件を表示
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700">
                まとめて操作
              </button>
              <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700">
                一括登録
              </button>
              <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700">
                表示設定
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-slate-50 text-xs font-extrabold text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left">社名</th>
                      <th className="px-4 py-3 text-left">案件名</th>
                      <th className="px-4 py-3 text-left">件名</th>
                      <th className="px-4 py-3 text-left">担当(リーダー)</th>
                      <th className="px-4 py-3 text-left">サブリーダー</th>
                      <th className="px-4 py-3 text-left">状態</th>
                      <th className="px-4 py-3 text-left">カテゴリ</th>
                      <th className="px-4 py-3 text-left">優先度</th>
                      <th className="px-4 py-3 text-left">発生バージョン</th>
                      <th className="px-4 py-3 text-left">開始日</th>
                      <th className="px-4 py-3 text-left">期限日</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-sm font-bold text-slate-500">
                        該当する課題がありません
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((i) => {
                      const st = ISSUE_STATUSES.find(s => s.value === i.status)?.label || i.status;
                      const pr = ISSUE_PRIORITIES.find(p => p.value === i.priority)?.label || i.priority;
                      const cat = getCategoryFromIssue(i);
                      return (
                        <tr key={i.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-700">{customer?.name || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">{project?.title || "-"}</td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            <Link href={`/issue/${i.id}`} className="hover:underline">
                              <span className="mr-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-700">
                                {i.issueKey}
                              </span>
                              <span>{i.title}</span>
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{assigneeName(i.assigneeUid) || "-"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{assigneeName(i.subAssigneeUid) || "-"}</td>
                          <td className="px-4 py-3">
                            <span className={clsx(
                              "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold",
                              i.status === "DONE" ? "bg-orange-100 text-orange-700" :
                              i.status === "IN_PROGRESS" ? "bg-sky-100 text-sky-700" :
                              "bg-rose-100 text-rose-700",
                            )}>
                              {st}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{cat || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">{pr}</td>
                          <td className="px-4 py-3 text-slate-400">-</td>
                          <td className="px-4 py-3 text-slate-700">{i.startDate || "-"}</td>
                          <td className="px-4 py-3 text-slate-700">{i.dueDate || "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <button
              disabled={pageSafe <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className={clsx(
                "rounded-md border px-3 py-2 text-xs font-extrabold",
                pageSafe <= 1 ? "border-slate-200 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              前へ
            </button>
            <div className="flex items-center gap-2">
              {Array.from({ length: Math.min(9, totalPages) }).map((_, idx) => {
                const n = idx + 1;
                return (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={clsx(
                      "h-8 w-8 rounded-full text-xs font-extrabold",
                      n === pageSafe ? "bg-orange-600 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    {n}
                  </button>
                );
              })}
              {totalPages > 9 ? <span className="text-xs font-bold text-slate-500">…</span> : null}
            </div>
            <button
              disabled={pageSafe >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className={clsx(
                "rounded-md border px-3 py-2 text-xs font-extrabold",
                pageSafe >= totalPages ? "border-slate-200 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              次へ
            </button>
          </div>
      </div>
    </AppShell>
  );
}


