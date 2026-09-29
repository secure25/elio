"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Search,
  ChevronDown,
  Bell,
  MoreVertical,
  CheckSquare,
  Edit2,
  Trash2,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  FileText,
  Sparkles,
  X,
  Check,
  Calendar,
  Clock,
  User,
} from "lucide-react";

interface ServerTask {
  id: string;
  conversation_id: string | null;
  goal: string;
  status: "pending" | "running" | "waiting_approval" | "done" | "failed" | "cancelled";
  plan: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskItem {
  id: string;
  title: string;
  desc: string;
  ownerName: string;
  ownerInitials: string;
  ownerRole: string;
  dueDay: string;
  dueTime: string;
  status: "in-progress" | "queued" | "waiting" | "completed";
  statusLabel: string;
  filterBucket: "today" | "week" | "waiting" | "completed";
  completed: boolean;
  plan?: string | null;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [filter, setFilter] = useState<"today" | "week" | "waiting" | "completed">("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [taskDetailModal, setTaskDetailModal] = useState<TaskItem | null>(null);
  // Mobile: the context panel is a full-screen sheet the user opens deliberately.
  const [detailOpen, setDetailOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Group collapses
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    "in-progress": false,
    queued: false,
    waiting: false,
    completed: false,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/tasks");
        if (!res.ok) return;
        const data = await res.json();
        const stList: ServerTask[] = data.tasks || [];

        const mapped: TaskItem[] = stList.map((st) => {
          const isToday = new Date(st.created_at).toDateString() === new Date().toDateString();
          let status: TaskItem["status"] = "queued";
          let statusLabel = "Queued";
          let filterBucket: TaskItem["filterBucket"] = isToday ? "today" : "week";
          let completed = false;

          if (st.status === "running") {
            status = "in-progress";
            statusLabel = "In progress";
          } else if (st.status === "waiting_approval") {
            status = "waiting";
            statusLabel = "Needs approval";
            filterBucket = "waiting";
          } else if (st.status === "done") {
            status = "completed";
            statusLabel = "Completed";
            filterBucket = "completed";
            completed = true;
          }

          return {
            id: st.id,
            title: st.goal,
            desc: st.plan ? (st.plan.length > 90 ? st.plan.slice(0, 90) + "..." : st.plan) : "Elio background task",
            ownerName: "Elio",
            ownerInitials: "E",
            ownerRole: "Agent",
            dueDay: isToday ? "Today" : new Date(st.created_at).toLocaleDateString([], { month: "short", day: "numeric" }),
            dueTime: new Date(st.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
            status,
            statusLabel,
            filterBucket,
            completed,
            plan: st.plan,
          };
        });

        setTasks(mapped);
        setSelectedTaskId((prev) => {
          if (prev && mapped.some((t) => t.id === prev)) return prev;
          return mapped.length > 0 ? mapped[0].id : null;
        });
      } catch (e) {
        console.error("Failed to fetch tasks", e);
      }
    };

    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const toggleTaskCompletion = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          const isDone = !t.completed;
          showToast(isDone ? `Marked "${t.title}" completed` : `Reopened "${t.title}"`);
          return {
            ...t,
            completed: isDone,
            status: isDone ? "completed" : "in-progress",
            statusLabel: isDone ? "Completed" : "In progress",
          };
        }
        return t;
      })
    );
  };

  const deleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (selectedTaskId === taskId) {
      const remaining = tasks.filter((t) => t.id !== taskId);
      setSelectedTaskId(remaining.length > 0 ? remaining[0].id : null);
    }
    setActiveMenuId(null);
    showToast("Task removed from active view");
  };

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        task.title.toLowerCase().includes(q) ||
        task.desc.toLowerCase().includes(q) ||
        task.ownerName.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    if (filter === "today") return task.filterBucket === "today" || task.status === "in-progress";
    if (filter === "week") return task.filterBucket === "week" || task.filterBucket === "today";
    if (filter === "waiting") return task.status === "waiting";
    if (filter === "completed") return task.completed || task.status === "completed";
    return true;
  });

  const countToday = tasks.filter((t) => t.filterBucket === "today" || t.status === "in-progress").length;
  const countWeek = tasks.filter((t) => t.filterBucket === "week" || t.filterBucket === "today").length;
  const countWaiting = tasks.filter((t) => t.status === "waiting").length;
  const countCompleted = tasks.filter((t) => t.completed || t.status === "completed").length;

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || tasks[0] || null;

  // Helper to render a task row
  const renderTaskRow = (task: TaskItem, statusChipClass: string) => (
    <div
      key={task.id}
      onClick={() => { setSelectedTaskId(task.id); setDetailOpen(true); }}
      className={`p-3 rounded-xl hover:bg-[#F2EFE9] transition-colors group cursor-pointer md:grid md:grid-cols-12 md:items-center ${
        selectedTaskId === task.id ? "bg-[#ECE8DF]" : ""
      }`}
    >
      <div className="flex items-start gap-3 md:col-span-6">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={() => toggleTaskCompletion(task.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 rounded accent-[var(--accent)] cursor-pointer"
        />
        <div>
          <h4
            className={`text-xs font-semibold text-[var(--text)] ${
              task.completed ? "line-through opacity-60" : ""
            }`}
          >
            {task.title}
          </h4>
          <p className="text-[11px] text-[var(--muted)]">{task.desc}</p>
        </div>
      </div>

      <div className="hidden md:flex col-span-2 items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[#354035] text-white font-medium text-[10px] flex items-center justify-center">
          {task.ownerInitials}
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--text)] leading-tight">
            {task.ownerName}
          </div>
          <div className="text-[10px] text-[var(--muted)]">{task.ownerRole}</div>
        </div>
      </div>

      <div className="hidden md:block col-span-2 text-xs">
        <span className="text-[var(--text)]">{task.dueDay}</span>
        <span className="text-[var(--muted)] text-[11px] ml-1.5">{task.dueTime}</span>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1.5 relative md:col-span-2 md:pt-0 md:justify-end md:pr-1">
        <span className={`chip ${statusChipClass} text-[10px] flex items-center gap-1.5`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            task.status === "in-progress" ? "bg-[var(--ok)]" :
            task.status === "waiting" ? "bg-[var(--action)]" :
            task.status === "completed" ? "bg-[var(--ok)]" :
            "bg-[var(--muted)]"
          }`} />
          <span>{task.statusLabel}</span>
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setActiveMenuId(activeMenuId === task.id ? null : task.id);
          }}
          className="text-[var(--muted)] p-1 hover:text-[var(--text)] transition-colors"
        >
          <MoreVertical size={14} />
        </button>

        {activeMenuId === task.id && (
          <div className="absolute right-0 top-7 w-36 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl z-20 py-1 text-xs">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTaskDetailModal(task);
                setActiveMenuId(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#F2EFE9] flex items-center gap-2"
            >
              <Edit2 size={12} />
              <span>Inspect task</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteTask(task.id);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#F2EFE9] text-[var(--action)] flex items-center gap-2"
            >
              <Trash2 size={12} />
              <span>Delete task</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Task Detail Inspector Modal */}
      {taskDetailModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setTaskDetailModal(null)}
              className="absolute top-4 right-4 p-1 rounded-full text-[var(--muted)] hover:text-[var(--text)]"
            >
              <X size={16} />
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
              <span>Task Detail</span>
            </div>
            <h3 className="font-editorial text-2xl font-bold text-[var(--text)] mb-2">
              {taskDetailModal.title}
            </h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed mb-4">
              {taskDetailModal.desc}
            </p>

            <div className="bg-[var(--bg)] p-4 rounded-xl border border-[var(--border)] space-y-2 mb-4 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Status:</span>
                <span className="font-medium text-[var(--text)]">{taskDetailModal.statusLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Assigned To:</span>
                <span className="font-medium text-[var(--text)]">{taskDetailModal.ownerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Created:</span>
                <span className="font-medium text-[var(--text)]">
                  {taskDetailModal.dueDay} at {taskDetailModal.dueTime}
                </span>
              </div>
            </div>

            {taskDetailModal.plan && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-[var(--text)] mb-1">Execution Plan</h4>
                <div className="bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)] text-xs text-[var(--text)] font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
                  {taskDetailModal.plan}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  toggleTaskCompletion(taskDetailModal.id);
                  setTaskDetailModal(null);
                }}
                className="btn btn-approve text-xs py-2 px-4"
              >
                <Check size={13} />
                <span>{taskDetailModal.completed ? "Mark Incomplete" : "Mark Completed"}</span>
              </button>
              <button
                onClick={() => setTaskDetailModal(null)}
                className="btn btn-secondary py-2 px-4 text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Search & Actions Bar */}
      <div className="h-14 border-b border-[var(--border)] px-4 md:px-8 flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-3 w-80">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full bg-transparent text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-[var(--muted)]">
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => showToast(`${countToday} tasks active`)}
            className="p-2 rounded-full hover:bg-[#EBE8DF] text-[var(--muted)] hover:text-[var(--text)] transition-colors relative"
          >
            <Bell size={16} />
            {countToday > 0 && (
              <span className="w-2 h-2 rounded-full bg-[var(--action)] absolute top-1.5 right-1.5" />
            )}
          </button>
          <div
            onClick={() => showToast("Elio Personal Agent active")}
            className="flex items-center gap-2 pl-2 border-l border-[var(--border)] cursor-pointer"
          >
            <Image
              src="/elio-icon.png"
              alt="Elio"
              width={28}
              height={28}
              className="rounded-lg shrink-0"
            />
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium text-[var(--text)] leading-tight">Elio</div>
              <div className="text-[10px] text-[var(--muted)] leading-tight">Personal agent</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace with Table + Right Context Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Central Tasks List */}
        <div className="flex-1 overflow-y-auto px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-6 md:pb-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-editorial font-medium text-[var(--text)] mb-1">
              Work in motion
            </h1>
            <p className="text-xs text-[var(--muted)]">The right tasks, in the right order.</p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => setFilter("today")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "today"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Today</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  filter === "today" ? "bg-white/20 text-white" : "text-[var(--muted)]"
                }`}
              >
                {countToday}
              </span>
            </button>

            <button
              onClick={() => setFilter("week")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "week"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>This week</span>
              <span className="text-[10px] text-[var(--muted)]">{countWeek}</span>
            </button>

            <button
              onClick={() => setFilter("waiting")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "waiting"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Needs approval</span>
              <span className="text-[10px] text-[var(--muted)]">{countWaiting}</span>
            </button>

            <button
              onClick={() => setFilter("completed")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === "completed"
                  ? "bg-[#435242] text-white"
                  : "bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              <span>Completed</span>
              <span className="text-[10px] text-[var(--muted)]">{countCompleted}</span>
            </button>
          </div>

          {/* Table Header (desktop — mobile rows carry their own meta) */}
          <div className="hidden md:grid grid-cols-12 text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider pb-3 border-b border-[var(--border)] px-3">
            <div className="col-span-6">Task</div>
            <div className="col-span-2">Assigned To</div>
            <div className="col-span-2">Created / Due</div>
            <div className="col-span-2 text-right pr-3">Status</div>
          </div>

          {/* Empty State */}
          {filteredTasks.length === 0 && (
            <div className="py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mx-auto mb-4">
                <CheckSquare className="w-6 h-6" />
              </div>
              <h3 className="font-editorial text-xl font-medium text-[var(--text)] mb-2">
                {searchQuery ? "No matching tasks found" : "No active tasks in motion"}
              </h3>
              <p className="text-xs text-[var(--muted)] max-w-sm mx-auto leading-relaxed">
                {searchQuery
                  ? "Try adjusting your search keywords or filter tab."
                  : "Tasks are created automatically as you give Elio goals in the chat. Ask it to research a topic, draft an email, or plan a schedule."}
              </p>
            </div>
          )}

          {/* Group: In Progress */}
          {filteredTasks.some((t) => t.status === "in-progress") && (
            <div className="mt-4">
              <button
                onClick={() => toggleGroup("in-progress")}
                className="w-full flex items-center gap-2 text-xs font-semibold text-[var(--text)] px-3 py-2 text-left hover:bg-[#F2EFE9] rounded-lg transition-colors cursor-pointer"
              >
                <ChevronDown
                  size={14}
                  className={`text-[var(--muted)] transition-transform ${
                    collapsedGroups["in-progress"] ? "-rotate-90" : ""
                  }`}
                />
                <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                <span>In progress</span>
                <span className="text-[11px] text-[var(--muted)] font-normal">
                  {filteredTasks.filter((t) => t.status === "in-progress").length}
                </span>
              </button>

              {!collapsedGroups["in-progress"] && (
                <div className="space-y-1 mt-1">
                  {filteredTasks
                    .filter((t) => t.status === "in-progress")
                    .map((task) => renderTaskRow(task, "chip-moss"))}
                </div>
              )}
            </div>
          )}

          {/* Group: Queued */}
          {filteredTasks.some((t) => t.status === "queued") && (
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <button
                onClick={() => toggleGroup("queued")}
                className="w-full flex items-center gap-2 text-xs font-semibold text-[var(--text)] px-3 py-2 text-left hover:bg-[#F2EFE9] rounded-lg transition-colors cursor-pointer"
              >
                <ChevronDown
                  size={14}
                  className={`text-[var(--muted)] transition-transform ${
                    collapsedGroups["queued"] ? "-rotate-90" : ""
                  }`}
                />
                <span className="w-2 h-2 rounded-full bg-[var(--muted)]" />
                <span>Queued</span>
                <span className="text-[11px] text-[var(--muted)] font-normal">
                  {filteredTasks.filter((t) => t.status === "queued").length}
                </span>
              </button>

              {!collapsedGroups["queued"] && (
                <div className="space-y-1 mt-1">
                  {filteredTasks
                    .filter((t) => t.status === "queued")
                    .map((task) => renderTaskRow(task, "chip-muted"))}
                </div>
              )}
            </div>
          )}

          {/* Group: Needs Approval */}
          {filteredTasks.some((t) => t.status === "waiting") && (
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <button
                onClick={() => toggleGroup("waiting")}
                className="w-full flex items-center gap-2 text-xs font-semibold text-[var(--text)] px-3 py-2 text-left hover:bg-[#F2EFE9] rounded-lg transition-colors cursor-pointer"
              >
                <ChevronDown
                  size={14}
                  className={`text-[var(--muted)] transition-transform ${
                    collapsedGroups["waiting"] ? "-rotate-90" : ""
                  }`}
                />
                <span className="w-2 h-2 rounded-full bg-[var(--action)]" />
                <span>Needs approval</span>
                <span className="text-[11px] text-[var(--muted)] font-normal">
                  {filteredTasks.filter((t) => t.status === "waiting").length}
                </span>
              </button>

              {!collapsedGroups["waiting"] && (
                <div className="space-y-1 mt-1">
                  {filteredTasks
                    .filter((t) => t.status === "waiting")
                    .map((task) => renderTaskRow(task, "chip-action"))}
                </div>
              )}
            </div>
          )}

          {/* Group: Completed */}
          {filteredTasks.some((t) => t.completed) && (
            <div className="mt-6 border-t border-[var(--border)] pt-4">
              <button
                onClick={() => toggleGroup("completed")}
                className="w-full flex items-center gap-2 text-xs font-semibold text-[var(--text)] px-3 py-2 text-left hover:bg-[#F2EFE9] rounded-lg transition-colors cursor-pointer"
              >
                <ChevronDown
                  size={14}
                  className={`text-[var(--muted)] transition-transform ${
                    collapsedGroups["completed"] ? "-rotate-90" : ""
                  }`}
                />
                <span className="w-2 h-2 rounded-full bg-[var(--ok)]" />
                <span>Completed</span>
                <span className="text-[11px] text-[var(--muted)] font-normal">
                  {filteredTasks.filter((t) => t.completed).length}
                </span>
              </button>

              {!collapsedGroups["completed"] && (
                <div className="space-y-1 mt-1">
                  {filteredTasks
                    .filter((t) => t.completed)
                    .map((task) => (
                      <div
                        key={task.id}
                        className="grid grid-cols-12 items-center p-3 rounded-xl bg-[#F6F4EE] opacity-70"
                      >
                        <div className="col-span-6 flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={() => toggleTaskCompletion(task.id)}
                            className="mt-1 rounded accent-[var(--accent)] cursor-pointer"
                          />
                          <div>
                            <h4 className="text-xs font-semibold text-[var(--text)] line-through">
                              {task.title}
                            </h4>
                            <p className="text-[11px] text-[var(--muted)]">{task.desc}</p>
                          </div>
                        </div>

                        <div className="col-span-2 text-xs text-[var(--muted)]">{task.ownerName}</div>
                        <div className="col-span-2 text-xs text-[var(--muted)]">Done</div>
                        <div className="col-span-2 text-right pr-4">
                          <span className="chip text-[10px]">Finished</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Context Panel — mobile: full-screen sheet; desktop: fixed sidebar */}
        <aside
          className={`${
            detailOpen
              ? "fixed inset-0 z-[70] md:z-auto"
              : "hidden md:flex"
          } bg-[var(--bg)] md:static md:w-[360px] md:shrink-0 border-l border-[var(--border)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:flex-col md:justify-between overflow-y-auto`}
        >
          <button
            onClick={() => setDetailOpen(false)}
            className="absolute top-4 right-4 w-11 h-11 flex items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--panel)] md:hidden"
            aria-label="Close task details"
          >
            <X size={22} />
          </button>
          {selectedTask ? (
            <div>
              <div className="mb-4">
                <h2 className="font-editorial text-xl font-semibold text-[var(--text)]">
                  Selected task
                </h2>
                <p className="text-xs text-[var(--muted)]">Focus inspection and plan execution.</p>
              </div>

              {/* Selected Priority Action Card */}
              <div className="panel p-5 bg-[var(--panel)] mb-6 rounded-xl border border-[var(--border)] shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[var(--action)] text-white text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <h3 className="text-xs font-semibold text-[var(--text)]">{selectedTask.title}</h3>
                  </div>
                  <ChevronRight size={15} className="text-[var(--muted)]" />
                </div>
                <div className="text-[11px] text-[var(--muted)] pl-8 mb-2">
                  Created {selectedTask.dueDay.toLowerCase()} · {selectedTask.ownerName}
                </div>
                <p className="text-xs text-[var(--muted)] pl-8 leading-relaxed mb-4">
                  {selectedTask.desc}
                </p>
                <div className="pl-8">
                  <button
                    onClick={() => setTaskDetailModal(selectedTask)}
                    className="btn btn-primary py-2 px-4 text-xs font-medium cursor-pointer"
                  >
                    Open task →
                  </button>
                </div>
              </div>

              {/* Execution Plan preview */}
              {selectedTask.plan && (
                <div className="mb-6">
                  <h4 className="font-editorial text-sm font-semibold text-[var(--text)] mb-3">
                    Structured Plan
                  </h4>
                  <div className="p-3 bg-[var(--panel)] rounded-xl border border-[var(--border)] text-xs text-[var(--text)] whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                    {selectedTask.plan}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-xs text-[var(--muted)] italic">
                No task selected. Select a task on the left or create one in Chat to inspect details.
              </p>
            </div>
          )}

          {/* Inspirational Quote Card */}
          <div className="panel p-4 bg-[var(--panel)] flex items-start gap-3 rounded-xl border border-[var(--border)]">
            <span className="text-base text-[var(--accent)] mt-0.5">🌱</span>
            <p className="text-xs text-[var(--text)] italic leading-relaxed">
              Small steps move <br />
              big plans forward.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
