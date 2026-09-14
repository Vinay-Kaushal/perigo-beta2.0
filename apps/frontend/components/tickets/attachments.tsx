"use client";

import { useRef, useState } from "react";
import { Download, File, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, Trash2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { ACCEPT_ATTRIBUTE, attachmentUrl, formatBytes, uploadFile, validateFile } from "@/lib/files";
import type { TicketAttachment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn, relativeTime } from "@/lib/utils";

function iconFor(a: Pick<TicketAttachment, "fileName" | "isImage">) {
  if (a.isImage) return FileImage;
  if (/\.(csv|xlsx)$/i.test(a.fileName)) return FileSpreadsheet;
  if (/\.(pdf|txt|md|log|docx|json)$/i.test(a.fileName)) return FileText;
  return File;
}

export function AttachmentChip({
  orgId,
  ticketRef,
  attachment,
  onDelete,
}: {
  orgId: string;
  ticketRef: number;
  attachment: TicketAttachment;
  onDelete?: () => void;
}) {
  const Icon = iconFor(attachment);
  const href = attachmentUrl(orgId, ticketRef, attachment.id);
  return (
    <div className="group flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface p-2">
      {attachment.isImage ? (
        <a href={attachmentUrl(orgId, ticketRef, attachment.id, true)} target="_blank" rel="noopener noreferrer" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachmentUrl(orgId, ticketRef, attachment.id, true)} alt={attachment.fileName} className="h-10 w-10 rounded object-cover" loading="lazy" />
        </a>
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-surface-muted text-ink-faint">
          <Icon size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a href={href} className="block truncate text-[13px] font-medium text-ink hover:text-accent-ink" title={attachment.fileName}>
          {attachment.fileName}
        </a>
        <p className="truncate text-2xs text-ink-faint">
          {formatBytes(attachment.size)}
          {attachment.uploader && ` · ${attachment.uploader.name}`} · {relativeTime(attachment.createdAt)}
        </p>
      </div>
      <a href={href} aria-label={`Download ${attachment.fileName}`} className="rounded p-1.5 text-ink-faint hover:bg-surface-hover hover:text-ink">
        <Download size={14} />
      </a>
      {onDelete && (
        <button onClick={onDelete} aria-label={`Delete ${attachment.fileName}`} className="rounded p-1.5 text-ink-faint hover:bg-danger/10 hover:text-danger">
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export interface PendingUpload {
  key: string;
  name: string;
  progress: number;
}

/** Uploads files to a ticket with progress; calls onUploaded for each success. */
export function useTicketUploads(orgId: string, ticketRef: number, onUploaded: (a: TicketAttachment) => void) {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const problem = validateFile(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name, progress: 0 }]);
      try {
        const created = await uploadFile<TicketAttachment>(`/organisations/${orgId}/tickets/${ticketRef}/attachments`, file, (progress) =>
          setPending((p) => p.map((u) => (u.key === key ? { ...u, progress } : u)))
        );
        onUploaded(created);
      } catch (err) {
        toast.error(errorMessage(err, `Couldn't upload ${file.name}`));
      } finally {
        setPending((p) => p.filter((u) => u.key !== key));
      }
    }
  }

  return { pending, upload, busy: pending.length > 0 };
}

export function UploadProgress({ pending }: { pending: PendingUpload[] }) {
  if (!pending.length) return null;
  return (
    <ul className="space-y-1.5" aria-live="polite">
      {pending.map((u) => (
        <li key={u.key} className="flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 size={12} className="animate-spin" />
          <span className="min-w-0 flex-1 truncate">{u.name}</span>
          <span className="h-1 w-24 overflow-hidden rounded-full bg-surface-muted">
            <span className="block h-1 rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Button + drop zone for adding files. */
export function FileDropzone({ onFiles, disabled, compact }: { onFiles: (files: FileList) => void; disabled?: boolean; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      accept={ACCEPT_ATTRIBUTE}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        if (e.target.files?.length) onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
  if (compact) {
    return (
      <>
        {picker}
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => input.current?.click()} aria-label="Attach files">
          <Paperclip size={14} /> Attach
        </Button>
      </>
    );
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong px-4 py-5 text-center text-[13px] text-ink-muted transition-colors",
        over && "border-accent bg-accent-soft/40",
        disabled && "opacity-60"
      )}
    >
      {picker}
      <UploadCloud size={18} className="text-ink-faint" />
      <p>
        Drop files here or{" "}
        <button type="button" disabled={disabled} className="font-medium text-accent-ink hover:underline" onClick={() => input.current?.click()}>
          browse
        </button>
      </p>
      <p className="text-2xs text-ink-faint">Images, PDF, Office, text or zip · up to 10 MB</p>
    </div>
  );
}

export function PendingAttachmentChip({ attachment, onRemove }: { attachment: TicketAttachment; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-surface-muted py-0.5 pl-2 pr-1 text-xs text-ink">
      <Paperclip size={11} className="shrink-0 text-ink-faint" />
      <span className="truncate">{attachment.fileName}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.fileName}`} className="rounded-full p-0.5 text-ink-faint hover:bg-surface-hover hover:text-ink">
        <X size={11} />
      </button>
    </span>
  );
}
