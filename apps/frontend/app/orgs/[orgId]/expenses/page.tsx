"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Organisation, Expense, ExpenseSummary } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { OrgTabs } from "@/components/org-tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { Plus, Receipt, Trash2 } from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  Food: "#FB923C",
  Supplies: "#818CF8",
  Rent: "#F87171",
  Utilities: "#4ADE80",
  Marketing: "#F472B6",
  Other: "#94A3B8",
};

function money(n: number | string, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(n));
}

export default function ExpensesPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const [org, setOrg] = useState<Organisation | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    try {
      const [orgRes, expensesRes, summaryRes] = await Promise.all([
        api.get<Organisation>(`/organisations/${orgId}`),
        api.get<Expense[]>(`/organisations/${orgId}/expenses`),
        api.get<ExpenseSummary>(`/organisations/${orgId}/expenses/summary`),
      ]);
      setOrg(orgRes);
      setExpenses(expensesRes);
      setSummary(summaryRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load expenses");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function removeExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    try {
      await api.delete(`/organisations/${orgId}/expenses/${id}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete expense");
    }
  }

  const maxCategoryTotal = Math.max(1, ...(summary?.byCategory.map((c) => Number(c.total)) ?? [0]));

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: org?.name ?? "…", href: `/orgs/${orgId}` }, { label: "Expenses" }]} />
      <OrgTabs orgId={orgId} />

      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-faint">Total spend</p>
            <p className="text-2xl font-medium text-ink">{money(summary?.total ?? 0)}</p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus size={15} /> Add expense
          </Button>
        </div>

        {error && <p className="text-sm text-urgent">{error}</p>}

        {summary && summary.byCategory.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-ink">By category</h2>
            <div className="space-y-2.5">
              {summary.byCategory.map((c) => (
                <div key={c.category}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-ink-muted">{c.category}</span>
                    <span className="text-ink-faint">{money(c.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${(Number(c.total) / maxCategoryTotal) * 100}%`,
                        backgroundColor: CATEGORY_COLORS[c.category] ?? "#818CF8",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div>
          <h2 className="mb-3 text-sm font-medium text-ink">All expenses</h2>
          {expenses.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <Receipt className="text-ink-faint" size={26} />
              <p className="text-sm text-ink-muted">No expenses logged yet.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {expenses.map((e) => (
                <Card key={e.id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm text-ink">{e.title}</p>
                    <p className="text-xs text-ink-faint">
                      {e.category} · {new Date(e.date).toLocaleDateString()} · added by {e.createdBy.name}
                    </p>
                    {e.notes && <p className="mt-1 text-xs text-ink-muted">{e.notes}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-ink">{money(e.amount, e.currency)}</span>
                    <button
                      onClick={() => removeExpense(e.id)}
                      className="rounded p-1.5 text-ink-faint hover:bg-surface hover:text-urgent"
                      aria-label="Delete expense"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <AddExpenseDialog
        orgId={orgId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

const CATEGORIES = ["Food", "Supplies", "Rent", "Utilities", "Marketing", "Other"];

function AddExpenseDialog({
  orgId,
  open,
  onClose,
  onCreated,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/organisations/${orgId}/expenses`, {
        title,
        amount: Number(amount),
        category,
        date,
        notes: notes || undefined,
      });
      setTitle("");
      setAmount("");
      setNotes("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <h2 className="text-sm font-medium text-ink">Add expense</h2>

        <div className="space-y-1.5">
          <Label htmlFor="exp-title">Title</Label>
          <Input id="exp-title" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="exp-amount">Amount</Label>
            <Input
              id="exp-amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-date">Date</Label>
            <Input id="exp-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exp-category">Category</Label>
          <select
            id="exp-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded border border-border bg-surface px-2.5 text-sm text-ink focus-visible:border-accent"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exp-notes">Notes (optional)</Label>
          <Input id="exp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className="text-sm text-urgent">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !title.trim() || !amount}>
            {submitting ? "Saving…" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
