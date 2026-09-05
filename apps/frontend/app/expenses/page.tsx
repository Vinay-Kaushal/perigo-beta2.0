"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Organisation, Expense, ExpenseSummary, Goal } from "@/lib/types";
import { TopBar } from "@/components/top-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Plus, Receipt, Trash2, Target } from "lucide-react";

function money(n: number | string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

const CATEGORIES = ["Food", "Supplies", "Rent", "Utilities", "Marketing", "Other"];

export default function GlobalExpensesPage() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);

  useEffect(() => {
    api.get<Organisation[]>("/organisations").then((res) => {
      setOrgs(res);
      if (res.length > 0) setOrgId(res[0].id);
    });
  }, []);

  async function refresh() {
    if (!orgId) return;
    try {
      const [expensesRes, summaryRes, goalsRes] = await Promise.all([
        api.get<Expense[]>(`/organisations/${orgId}/expenses`),
        api.get<ExpenseSummary>(`/organisations/${orgId}/expenses/summary`),
        api.get<Goal[]>(`/organisations/${orgId}/goals`),
      ]);
      setExpenses(expensesRes);
      setSummary(summaryRes);
      setGoals(goalsRes);
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
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  async function removeGoal(id: string) {
    if (!confirm("Delete this goal?")) return;
    try {
      await api.delete(`/organisations/${orgId}/goals/${id}`);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete goal");
    }
  }

  return (
    <div className="min-h-screen">
      <TopBar crumbs={[{ label: "Expenses" }]} />

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="org-select" className="shrink-0">
              Organisation
            </Label>
            <Select id="org-select" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-56">
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setGoalDialogOpen(true)}>
              <Target size={14} /> New goal
            </Button>
            <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
              <Plus size={14} /> Add expense
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-urgent">{error}</p>}
        {orgs.length === 0 && (
          <p className="text-sm text-ink-faint">You&apos;re not part of any organisation yet.</p>
        )}

        {summary && (
          <Card className="p-4">
            <p className="text-xs text-ink-faint">Total spend</p>
            <p className="text-2xl font-medium text-ink">{money(summary.total)}</p>
          </Card>
        )}

        {goals.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-medium text-ink">Spending goals</h2>
            <div className="space-y-4">
              {goals.map((g) => (
                <div key={g.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-ink">
                      {g.title} {g.category && <span className="text-ink-faint">· {g.category}</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-faint">
                        {money(g.progress.spent)} / {money(g.progress.target)}
                      </span>
                      <button onClick={() => removeGoal(g.id)} className="text-ink-faint hover:text-urgent">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface">
                    <div
                      className={`h-1.5 rounded-full ${g.progress.percent >= 100 ? "bg-urgent" : "bg-accent"}`}
                      style={{ width: `${g.progress.percent}%` }}
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
                      {e.category} · {new Date(e.date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-ink">{money(e.amount)}</span>
                    <button onClick={() => removeExpense(e.id)} className="text-ink-faint hover:text-urgent">
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
        open={expenseDialogOpen}
        onClose={() => setExpenseDialogOpen(false)}
        onCreated={() => {
          setExpenseDialogOpen(false);
          refresh();
        }}
      />
      <AddGoalDialog
        orgId={orgId}
        open={goalDialogOpen}
        onClose={() => setGoalDialogOpen(false)}
        onCreated={() => {
          setGoalDialogOpen(false);
          refresh();
        }}
      />
    </div>
  );
}

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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/organisations/${orgId}/expenses`, { title, amount: Number(amount), category, date });
      setTitle("");
      setAmount("");
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
          <Label htmlFor="ge-title">Title</Label>
          <Input id="ge-title" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ge-amount">Amount</Label>
            <Input id="ge-amount" type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ge-date">Date</Label>
            <Input id="ge-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-category">Category</Label>
          <Select id="ge-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        {error && <p className="text-sm text-urgent">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !title.trim() || !amount || !orgId}>
            {submitting ? "Saving…" : "Add"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddGoalDialog({
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
  const [targetAmount, setTargetAmount] = useState("");
  const [category, setCategory] = useState("");
  const [periodStart, setPeriodStart] = useState(() => new Date(new Date().setDate(1)).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/organisations/${orgId}/goals`, {
        title,
        targetAmount: Number(targetAmount),
        category: category || null,
        periodStart,
        periodEnd,
      });
      setTitle("");
      setTargetAmount("");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create goal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4 p-5">
        <h2 className="text-sm font-medium text-ink">New spending goal</h2>
        <div className="space-y-1.5">
          <Label htmlFor="g-title">Title</Label>
          <Input id="g-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stay under budget this month" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-target">Target amount</Label>
            <Input id="g-target" type="number" min="0" step="0.01" required value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-category">Category (optional)</Label>
            <Select id="g-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="g-start">Period start</Label>
            <Input id="g-start" type="date" required value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-end">Period end</Label>
            <Input id="g-end" type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-ink-faint">
          Progress is calculated automatically from expenses logged in this category and date range.
        </p>
        {error && <p className="text-sm text-urgent">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !title.trim() || !targetAmount || !orgId}>
            {submitting ? "Creating…" : "Create goal"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
