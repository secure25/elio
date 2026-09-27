"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sliders,
  Users,
  FolderOpen,
  MapPin,
  ChevronDown,
  Search,
  FileText,
  ChevronRight,
  ArrowLeft,
  MoreHorizontal,
  CheckCircle,
  Clock,
  Trash2,
  X,
  CheckCircle2,
  Plus,
  Brain,
} from "lucide-react";

interface Memory {
  id: string;
  content: string;
  category: string;
  source: string | null;
  created_at: number;
  updated_at: number;
}

interface MemoryItem {
  id: string;
  title: string;
  date: string;
  source: string;
  description: string;
  sourceQuote: string;
  confidence: number;
  lastConfirmedDate: string;
  lastConfirmedTime: string;
  tags: string[];
}

interface Shelf {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  items: MemoryItem[];
}

const SHELF_DEFINITIONS = [
  { id: "preferences", title: "Preferences", subtitle: "Your habits, preferences and recurring choices.", icon: Sliders },
  { id: "people", title: "People", subtitle: "Colleagues, contacts and important individuals.", icon: Users },
  { id: "projects", title: "Projects", subtitle: "Work, initiatives and ongoing efforts.", icon: FolderOpen },
  { id: "places", title: "Places", subtitle: "Locations, travel and where you go.", icon: MapPin },
  { id: "general", title: "General Context", subtitle: "Important facts and system insights.", icon: Brain },
];

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [collapsedShelves, setCollapsedShelves] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [newMemory, setNewMemory] = useState("");
  const [newCategory, setNewCategory] = useState("preferences");
  const [toast, setToast] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  // Mobile: the detail inspector is a full-screen sheet the user opens deliberately.
  const [detailOpen, setDetailOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memories");
      if (!res.ok) return;
      const data = await res.json();
      const list: Memory[] = data.memories || [];
      setMemories(list);

      // Distribute into shelves
      const grouped = SHELF_DEFINITIONS.map((def) => {
        const matching = list.filter((m) => {
          const cat = (m.category || "general").toLowerCase();
          if (def.id === "preferences") return cat.includes("pref");
          if (def.id === "people") return cat.includes("peop") || cat.includes("person") || cat.includes("contact");
          if (def.id === "projects") return cat.includes("proj") || cat.includes("work");
          if (def.id === "places") return cat.includes("place") || cat.includes("loc");
          if (def.id === "general") {
            return !cat.includes("pref") && !cat.includes("peop") && !cat.includes("person") && !cat.includes("proj") && !cat.includes("place");
          }
          return false;
        });

        const items: MemoryItem[] = matching.map((m) => ({
          id: m.id,
          title: m.content.length > 50 ? m.content.slice(0, 50) + "..." : m.content,
          date: new Date(m.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
          source: m.source || "from chat",
          description: m.content,
          sourceQuote: m.content,
          confidence: 95,
          lastConfirmedDate: new Date(m.updated_at || m.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
          lastConfirmedTime: new Date(m.updated_at || m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          tags: [def.title, m.category || "General"],
        }));

        return {
          ...def,
          items,
        };
      });

      setShelves(grouped);

      // Select first memory if none selected
      const allItems = grouped.flatMap((g) => g.items);
      setSelectedMemory((prev) => {
        if (prev && allItems.some((i) => i.id === prev.id)) return prev;
        return allItems.length > 0 ? allItems[0] : null;
      });
    } catch (e) {
      console.error("Failed to load memories", e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleShelf = (id: string) => {
    setCollapsedShelves((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const removeMemory = async (id: string, title: string) => {
    try {
      await fetch(`/api/memories?match=${encodeURIComponent(title)}`, { method: "DELETE" });
      showToast(`Removed from memory`);
      load();
    } catch (e) {
      console.error("Failed to delete memory", e);
    }
  };

  const addFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.trim()) return;
    try {
      // POST as new memory fact
      await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newMemory.trim(),
          category: newCategory,
        }),
      });
      setNewMemory("");
      showToast("Fact saved to memory vault");
      load();
    } catch {
      showToast("Failed to save memory");
    }
  };

  const totalMemoriesCount = shelves.reduce((acc, s) => acc + s.items.length, 0);

  // Filter shelves and items
  const filteredShelves = shelves
    .map((shelf) => {
      if (categoryFilter !== "all" && shelf.id !== categoryFilter) {
        return { ...shelf, items: [] };
      }
      if (!searchQuery.trim()) return shelf;

      const q = searchQuery.toLowerCase();
      const filteredItems = shelf.items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
      return { ...shelf, items: filteredItems };
    })
    .filter((s) => s.items.length > 0);

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] text-[var(--text)] overflow-hidden font-sans relative">
      {/* Toast Notification */}
      {toast && (
        <div className="absolute top-4 right-8 z-50 bg-[#2D382C] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 animate-fade-in border border-[#445443]">
          <CheckCircle2 size={15} className="text-[#84C783]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Search Bar */}
      <div className="h-14 border-b border-[var(--border)] px-4 md:px-8 flex items-center justify-between shrink-0 bg-[var(--bg)]">
        <div className="flex items-center gap-3 w-80">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memory..."
            className="w-full bg-transparent text-xs text-[var(--text)] placeholder-[var(--muted)] outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-[var(--muted)]">
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div
            onClick={() => showToast("Elio memory active")}
            className="flex items-center gap-2 pl-2 border-l border-[var(--border)] cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[#354035] text-white text-xs font-medium flex items-center justify-center">
              OM
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-medium text-[var(--text)] leading-tight">Elio</div>
              <div className="text-[10px] text-[var(--muted)] leading-tight">Context store</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Main Shelves Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-6 md:pb-6">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-editorial font-medium text-[var(--text)] mb-1">
                What Elio remembers
              </h1>
              <p className="text-xs text-[var(--muted)]">
                Preferences, facts, and context learned over time to personalize your agent.
              </p>
            </div>

            {/* Category Filter Dropdown */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] focus:outline-none cursor-pointer"
            >
              <option value="all">All memories ({totalMemoriesCount})</option>
              <option value="preferences">Preferences</option>
              <option value="people">People</option>
              <option value="projects">Projects</option>
              <option value="places">Places</option>
              <option value="general">General</option>
            </select>
          </div>

          {/* Add Fact Form */}
          <form onSubmit={addFact} className="mb-8 flex gap-2">
            <input
              type="text"
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              placeholder="Add a new fact for Elio to remember..."
              className="flex-1 bg-[var(--panel)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors shadow-xs"
            />
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="bg-[var(--panel)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none cursor-pointer shadow-xs"
            >
              <option value="preferences">Preferences</option>
              <option value="people">People</option>
              <option value="projects">Projects</option>
              <option value="places">Places</option>
              <option value="general">General</option>
            </select>
            <button
              type="submit"
              className="btn-moss px-4 py-2 text-xs font-medium rounded-xl flex items-center gap-1.5 shrink-0"
            >
              <Plus size={14} />
              <span>Remember</span>
            </button>
          </form>

          {/* Empty State */}
          {totalMemoriesCount === 0 && (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-[#EBF0EB] text-[var(--accent)] flex items-center justify-center mx-auto mb-4">
                <Brain className="w-6 h-6" />
              </div>
              <h3 className="font-editorial text-xl font-medium text-[var(--text)] mb-2">
                No memories recorded yet
              </h3>
              <p className="text-xs text-[var(--muted)] max-w-md mx-auto leading-relaxed">
                Elio learns your preferences, project details, and important contacts as you chat. You can also add facts manually using the input above.
              </p>
            </div>
          )}

          {/* Shelves List */}
          <div className="space-y-6 pb-12">
            {filteredShelves.map((shelf) => {
              const ShelfIcon = shelf.icon;
              const isCollapsed = collapsedShelves[shelf.id];
              return (
                <div key={shelf.id} className="border border-[var(--border)] rounded-2xl bg-[var(--panel)] overflow-hidden shadow-xs">
                  <button
                    onClick={() => toggleShelf(shelf.id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-[#F2EFE9] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#EAE7DF] text-[#4A4740] flex items-center justify-center shrink-0">
                        <ShelfIcon size={16} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-editorial text-base font-bold text-[var(--text)]">
                            {shelf.title}
                          </h3>
                          <span className="text-[10px] px-1.5 py-0.2 bg-[#E5DFD4] rounded-full text-[#4A4740] font-medium">
                            {shelf.items.length}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--muted)]">{shelf.subtitle}</p>
                      </div>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-[var(--muted)] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                      {shelf.items.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => { setSelectedMemory(item); setDetailOpen(true); }}
                          className={`p-3.5 px-4 flex items-center justify-between hover:bg-[#F2EFE9] transition-colors cursor-pointer group ${
                            selectedMemory?.id === item.id ? "bg-[#ECE8DF]" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText size={15} className="text-[var(--muted)] shrink-0 group-hover:text-[var(--accent)]" />
                            <span className="text-xs font-medium text-[var(--text)] truncate">
                              {item.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] shrink-0">
                            <span>
                              {item.date} · {item.source}
                            </span>
                            <ChevronRight size={14} className="text-[var(--muted)] group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Detail Inspector Panel — mobile: full-screen sheet */}
        <aside
          className={`${
            detailOpen
              ? "fixed inset-0 z-[70] md:z-auto"
              : "hidden md:flex"
          } bg-[var(--bg)] md:static md:w-[360px] md:shrink-0 border-l border-[var(--border)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:flex-col md:justify-between overflow-y-auto relative`}
        >
          <button
            onClick={() => setDetailOpen(false)}
            className="md:hidden absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--panel)] bg-[var(--bg)]/80"
            aria-label="Close memory details"
          >
            <X size={22} />
          </button>
          {selectedMemory ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] font-semibold tracking-wider text-[var(--muted)] uppercase">
                  Memory Detail
                </div>
                <button
                  onClick={() => removeMemory(selectedMemory.id, selectedMemory.title)}
                  className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--action)] transition-colors"
                  title="Remove from memory"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <h2 className="font-editorial text-2xl font-bold text-[var(--text)] mb-3 leading-snug">
                {selectedMemory.title}
              </h2>

              <p className="text-xs text-[var(--muted)] leading-relaxed mb-6 bg-[var(--panel)] p-3 rounded-xl border border-[var(--border)]">
                {selectedMemory.description}
              </p>

              {/* Metadata rows */}
              <div className="space-y-4 text-xs mb-6">
                <div>
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <FileText size={12} />
                    <span>Source</span>
                  </div>
                  <div className="text-[var(--text)] font-medium">Chat with Elio</div>
                  <div className="text-[11px] text-[var(--muted)] italic mt-0.5">
                    "{selectedMemory.sourceQuote}"
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <CheckCircle size={12} />
                    <span>Confidence</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-[#E8E4DA] h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-[var(--accent)] h-full rounded-full"
                        style={{ width: `${selectedMemory.confidence}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[var(--muted)]">{selectedMemory.confidence}%</span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <Clock size={12} />
                    <span>Last Confirmed</span>
                  </div>
                  <div className="text-[var(--text)] font-medium">
                    {selectedMemory.lastConfirmedDate} at {selectedMemory.lastConfirmedTime}
                  </div>
                </div>
              </div>

              {/* Tags */}
              <div>
                <div className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                  Related Context
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMemory.tags.map((tag) => (
                    <span key={tag} className="chip chip-moss text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-xs text-[var(--muted)] italic">
                Select a memory from the shelf to inspect its source, confidence score, and timestamps.
              </p>
            </div>
          )}

          {/* Delete Action Button */}
          {selectedMemory && (
            <div className="pt-4 border-t border-[var(--border)] mt-6">
              <button
                onClick={() => removeMemory(selectedMemory.id, selectedMemory.title)}
                className="w-full btn btn-deny py-2.5 text-xs font-medium justify-center flex items-center gap-2"
              >
                <Trash2 size={14} />
                <span>Remove from memory</span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
