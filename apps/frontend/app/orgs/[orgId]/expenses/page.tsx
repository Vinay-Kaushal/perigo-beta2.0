"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Check, Clock, MoreHorizontal, Pencil, Plus, Receipt, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useApi, useOrg } from "@/lib/hooks";
import type { Expense, ExpenseStatus, ExpenseSummary, Paginated } from "@/lib/types";
import { Page, PageHeader } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Dot, type BadgeTone } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from "@/components/ui/dropdown";
import { EmptyState, InlineAlert, Skeleton } from "@/components/ui/feedback";
import { StatTile } from "@/components/charts/stat-tile";
import { ColumnChart } from "@/components/charts/column-chart";
import { BarList } from "@/components/charts/bar-list";
import { cn, money, shortDate } from "@/lib/utils";

const STATUS: Record<ExpenseStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

function ExpenseDialog({ orgId, currency, expense, open, onOpenChange, onSaved }: { orgId: string; currency: string; expense: Expense | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const { data: categories } = useApi<string[]>(open ? `/organisations/${orgId}/expenses/categories` : null);
  const [form, setForm] = useState({ title: "", amount: "", category: "", date: format(new Date(), "yyyy-MM-dd"), notes: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever the dialog opens for a different expense.
  useEffect(() => {
    const key = expense?.id ?? "new";
    if (!open) return setLoadedFor(null);
    if (loadedFor === key) return;
    setLoadedFor(key);
    setError(null);
    setForm(
      expense
        ? { title: expense.title, amount: String(expense.amount), category: expense.category, date: format(new Date(expense.date), "yyyy-MM-dd"), notes: expense.notes ?? "" }
        : { title: "", amount: "", category: "", date: format(new Date(), "yyyy-MM-dd"), notes: "" }
    );
  }, [open, expense, loadedFor]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { title: form.title, amount: Number(form.amount), category: form.category, date: new Date(`${form.date}T12:00:00`).toISOString(), notes: form.notes || null };
    try {
      if (expense) await api.patch(`/organisations/${orgId}/expenses/${expense.id}`, body);
      else await api.post(`/organisations/${orgId}/expenses`, body);
      toast.success(expense ? (expense.status === "REJECTED" ? "Expense resubmitted for approval" : "Expense updated") : "Expense submitted for approval");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={expense ? "Edit expense" : "Submit an expense"}
      description={expense?.status === "REJECTED" ? `Rejected: ${expense.reviewNote}. Saving resubmits it.` : "An owner or admin reviews every expense before it counts toward budgets."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={busy}>
            {expense ? "Save" : "Submit"}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Description" htmlFor="e-title" className="sm:col-span-2">
          <Input id="e-title" required autoFocus maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Client lunch" />
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="e-amount">
          <Input id="e-amount" type="number" inputMode="decimal" required min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Date" htmlFor="e-date">
          <Input id="e-date" type="date" required max={format(new Date(), "yyyy-MM-dd")} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Category" htmlFor="e-cat" className="sm:col-span-2">
          <Input id="e-cat" required list="expense-categories" maxLength={60} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Travel, Software, Meals…" />
          <datalist id="expense-categories">{categories?.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Notes" htmlFor="e-notes" className="sm:col-span-2">
          <Textarea id="e-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {error && (
          <InlineAlert tone="danger" className="sm:col-span-2">
            {error}
          </InlineAlert>
        )}
      </form>
    </Dialog>
  );
}

function ExpensesInner() {
  const { orgId } = useParams<{ orgId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { org, isAdmin, isOwner } = useOrg(orgId);
  const currency = org?.currency ?? "USD";
  const [tab, setTab] = useState(params.get("tab") ?? "all");
  const [category, setCategory] = useState("");
  const statusFilter = { approvals: "PENDING", approved: "APPROVED", rejected: "REJECTED" }[tab] ?? "";
  const listKey = `/organisations/${orgId}/expenses?pageSize=100${statusFilter ? `&status=${statusFilter}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}${tab === "mine" ? "&mine=true" : ""}`;
  const { data: list, isLoading, mutate: reloadList } = useApi<Paginated<Expense>>(listKey);
  const { data: summary, mutate: reloadSummary } = useApi<ExpenseSummary>(`/organisations/${orgId}/expenses/summary`);
  const { data: categories } = useApi<string[]>(`/organisations/${orgId}/expenses/categories`);
  const [dialog, setDialog] = useState<{ open: boolean; expense: Expense | null }>({ open: false, expense: null });
  const [review, setReview] = useState<{ expense: Expense; decision: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const reload = () => Promise.all([reloadList(), reloadSummary()]);
  const canReview = (e: Expense) => isAdmin && e.status === "PENDING" && (e.createdBy.id !== user?.id || isOwner);

  return (
    <Page wide>
      <PageHeader
        eyebrow={org?.name}
        title="Expenses"
        description={summary?.scope === "organisation" ? "All submitted spend across the organisation, with approvals." : "Expenses you've submitted and their approval status."}
        actions={
          <Button onClick={() => setDialog({ open: true, expense: null })}>
            <Plus size={15} /> Submit expense
          </Button>
        }
      />

      {!summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[106px]" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Approved this month" value={money(summary.thisMonth, currency)} icon={Wallet} />
            <StatTile label="Approved (6 months)" value={money(summary.byMonth.reduce((s, m) => s + m.total, 0), currency)} icon={Receipt} />
            <StatTile label="Awaiting approval" value={summary.pending.count} icon={Clock} tone={summary.pending.count ? "warning" : "default"} hint={money(summary.pending.total, currency)} />
            <StatTile label="Top category" value={summary.byCategory[0]?.category ?? "—"} hint={summary.byCategory[0] ? money(summary.byCategory[0].total, currency) : "No approved spend yet"} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Approved spend by month" description="Last 6 months" />
              <div className="p-4">
                <ColumnChart
                  ariaLabel="Approved spend by month"
                  format={(v) => money(v, currency, true)}
                  data={summary.byMonth.map((m) => ({ key: m.month, label: format(new Date(`${m.month}-15`), "MMM"), value: m.total }))}
                />
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="By category" description="Approved, all time" />
              <div className="p-4">
                <BarList
                  ariaLabel="Approved spend by category"
                  emptyLabel="No approved expenses yet"
                  format={(v) => money(v, currency, true)}
                  items={summary.byCategory.slice(0, 7).map((c) => ({ key: c.category, label: c.category, value: c.total, hint: `${c.count} expenses · ${money(c.total, currency)}` }))}
                />
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 pt-2">
              <Tabs value={tab} onValueChange={(v) => (setTab(v), router.replace(`/orgs/${orgId}/expenses${v === "all" ? "" : `?tab=${v}`}`))}>
                <TabsList className="border-b-0">
                  <TabsTrigger value="all">{isAdmin ? "All" : "My expenses"}</TabsTrigger>
                  {isAdmin && (
                    <TabsTrigger value="approvals" count={summary.pending.count}>
                      Approval queue
                    </TabsTrigger>
                  )}
                  {isAdmin && <TabsTrigger value="mine">Mine</TabsTrigger>}
                  <TabsTrigger value="approved">Approved</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected</TabsTrigger>
                </TabsList>
              </Tabs>
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="mb-2 h-8 w-auto">
                <option value="">All categories</option>
                {categories?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] table-fixed text-left">
                <colgroup>
                  <col />
                  <col className="w-[180px]" />
                  <col className="w-[130px]" />
                  <col className="w-[110px]" />
                  <col className="w-[120px]" />
                  <col className="w-[230px]" />
                </colgroup>
                <thead className="border-b border-border bg-surface-muted/60 text-2xs uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Expense</th>
                    <th className="px-3 py-2.5 font-medium">Submitted by</th>
                    <th className="px-3 py-2.5 font-medium">Date</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className="p-4">
                        <Skeleton className="h-24" />
                      </td>
                    </tr>
                  )}
                  {list?.items.map((e) => {
                    const mine = e.createdBy.id === user?.id;
                    const editable = e.status !== "APPROVED" && (mine || isAdmin);
                    const deletable = isAdmin || (mine && e.status !== "APPROVED");
                    return (
                      <tr key={e.id} className="hover:bg-surface-hover">
                        <td className="px-4 py-2.5">
                          <p className="truncate text-[13px] font-medium text-ink">{e.title}</p>
                          <p className="truncate text-xs text-ink-faint">
                            {e.category}
                            {e.notes ? ` · ${e.notes}` : ""}
                          </p>
                          {e.status === "REJECTED" && e.reviewNote && <p className="truncate text-xs text-danger">Rejected: {e.reviewNote}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2 text-[13px] text-ink">
                            <Avatar name={e.createdBy.name} src={e.createdBy.avatarUrl} size={20} /> <span className="max-w-[130px] truncate">{e.createdBy.name}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[13px] text-ink-muted">{shortDate(e.date)}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS[e.status].tone} title={e.reviewedBy ? `by ${e.reviewedBy.name}` : undefined}>
                            <Dot />
                            {STATUS[e.status].label}
                          </Badge>
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-[13px] font-semibold text-ink">{money(e.amount, e.currency)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canReview(e) && (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => setReview({ expense: e, decision: "reject" })}>
                                  <X size={13} /> Reject
                                </Button>
                                <Button size="sm" onClick={() => setReview({ expense: e, decision: "approve" })}>
                                  <Check size={13} /> Approve
                                </Button>
                              </>
                            )}
                            {(editable || deletable) && (
                              <DropdownMenu>
                                <DropdownTrigger asChild>
                                  <Button variant="ghost" size="icon" aria-label="Expense actions">
                                    <MoreHorizontal size={15} />
                                  </Button>
                                </DropdownTrigger>
                                <DropdownContent>
                                  {editable && (
                                    <DropdownItem onSelect={() => setDialog({ open: true, expense: e })}>
                                      <Pencil size={14} /> Edit
                                    </DropdownItem>
                                  )}
                                  {deletable && (
                                    <DropdownItem destructive onSelect={() => setDeleteTarget(e)}>
                                      <Trash2 size={14} /> Delete
                                    </DropdownItem>
                                  )}
                                </DropdownContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list && list.items.length === 0 && <EmptyState icon={Receipt} title={tab === "approvals" ? "Nothing waiting for approval" : "No expenses here"} />}
          </Card>
        </div>
      )}

      <ExpenseDialog orgId={orgId} currency={currency} expense={dialog.expense} open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onSaved={reload} />

      <ConfirmDialog
        open={!!review}
        onOpenChange={(o) => !o && (setReview(null), setNote(""))}
        destructive={review?.decision === "reject"}
        title={review?.decision === "approve" ? "Approve expense?" : "Reject expense?"}
        description={review ? `${review.expense.title} — ${money(review.expense.amount, review.expense.currency)} from ${review.expense.createdBy.name}` : undefined}
        confirmLabel={review?.decision === "approve" ? "Approve" : "Reject"}
        onConfirm={async () => {
          if (!review) return;
          if (review.decision === "reject" && !note.trim()) {
            toast.error("Add a reason so the submitter knows what to fix");
            throw new Error("reason required");
          }
          try {
            await api.post(`/organisations/${orgId}/expenses/${review.expense.id}/${review.decision}`, { note: note || undefined });
            toast.success(review.decision === "approve" ? "Expense approved" : "Expense rejected");
            setNote("");
            await reload();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      >
        <Field label={review?.decision === "reject" ? "Reason (required)" : "Note (optional)"} htmlFor="review-note">
          <Textarea id="review-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={cn(review?.decision === "reject" && "border-danger/40")} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        destructive
        title="Delete expense?"
        description={deleteTarget ? `${deleteTarget.title} — ${money(deleteTarget.amount, deleteTarget.currency)}` : undefined}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await api.delete(`/organisations/${orgId}/expenses/${deleteTarget!.id}`);
            toast.success("Expense deleted");
            await reload();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </Page>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense>
      <ExpensesInner />
    </Suspense>
  );
}
