import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import type { Prisma, TicketAttachment, User } from "db/client";
import { prisma } from "../lib/prisma";
import { env } from "../lib/env";
import { publicUser } from "../lib/selects";
import { badRequest, conflict, forbidden, HttpError, notFound, param } from "../lib/http";
import { publishOrgEvent } from "../lib/eventBus";
import { ALLOWED_EXTENSIONS, contentDisposition, fileTypeFor, sanitizeFileName } from "../lib/fileTypes";
import { storage } from "../lib/storage";
import { currentUser } from "../middleware/auth";
import { isOrgAdmin } from "../middleware/access";
import { audit } from "../services/audit";
import { loadTicket } from "./ticket.controller";

export const attachmentInclude = { include: { uploader: publicUser } } satisfies { include: Prisma.TicketAttachmentInclude };

type AttachmentRow = TicketAttachment & { uploader: Pick<User, "id" | "name" | "email" | "avatarUrl"> | null };

/** storageKey is internal and never leaves the server. */
export function serialiseAttachment(a: AttachmentRow) {
  return {
    id: a.id,
    ticketId: a.ticketId,
    commentId: a.commentId,
    fileName: a.fileName,
    contentType: a.contentType,
    size: a.size,
    isImage: fileTypeFor(a.fileName)?.inline ?? false,
    createdAt: a.createdAt,
    uploader: a.uploader,
  };
}

const CLOSED = ["CLOSED", "CANCELLED"];
const SNIFF_BYTES = 16;

/**
 * Raw-body upload: the request body is the file itself, the name comes from the
 * X-File-Name header (URI-encoded). The type is derived from the extension and
 * verified against the leading bytes; size is enforced while streaming.
 */
export async function uploadAttachment(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket } = await loadTicket(req);
  const { ATTACHMENT_MAX_BYTES: maxBytes, ATTACHMENTS_PER_TICKET_MAX: maxFiles } = env();

  if (CLOSED.includes(ticket.status)) throw conflict("Reopen the ticket before adding files");

  let rawName: string;
  try {
    rawName = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
  } catch {
    throw badRequest("Invalid X-File-Name header");
  }
  if (!rawName.trim()) throw badRequest("X-File-Name header is required");
  const fileName = sanitizeFileName(rawName);
  const type = fileTypeFor(fileName);
  if (!type) {
    throw new HttpError(415, `That file type isn't allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`, "UNSUPPORTED_FILE_TYPE");
  }

  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.setHeader("Connection", "close");
    throw new HttpError(413, `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB`, "FILE_TOO_LARGE");
  }
  if (Number.isFinite(declared) && declared === 0) throw badRequest("The file is empty");

  const existing = await prisma.ticketAttachment.count({ where: { ticketId: ticket.id } });
  if (existing >= maxFiles) throw conflict(`A ticket can have at most ${maxFiles} attachments`);

  const storageKey = randomUUID();
  let head = Buffer.alloc(0);
  let received = 0;
  let verified = false;
  const inspect = (chunk: Buffer) => {
    received += chunk.length;
    if (received > maxBytes) throw new HttpError(413, `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB`, "FILE_TOO_LARGE");
    if (!verified) {
      head = Buffer.concat([head, chunk]).subarray(0, SNIFF_BYTES * 4);
      if (head.length >= SNIFF_BYTES) {
        if (!type.matches(head)) throw new HttpError(415, "The file's contents don't match its extension", "FILE_TYPE_MISMATCH");
        verified = true;
      }
    }
  };

  let size: number;
  try {
    size = await storage().put(storageKey, req as AsyncIterable<Buffer>, inspect);
  } catch (err) {
    if (err instanceof HttpError) res.setHeader("Connection", "close");
    throw err;
  }
  // Files shorter than the sniff window are verified once fully received.
  if (size === 0 || (!verified && !type.matches(head))) {
    await storage().delete(storageKey);
    throw size === 0 ? badRequest("The file is empty") : new HttpError(415, "The file's contents don't match its extension", "FILE_TYPE_MISMATCH");
  }

  let attachment: AttachmentRow;
  try {
    attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketAttachment.create({
        data: { ticketId: ticket.id, uploaderId: user.id, fileName, contentType: type.contentType, size, storageKey },
        ...attachmentInclude,
      });
      await tx.ticketEvent.create({
        data: { ticketId: ticket.id, actorId: user.id, type: "ATTACHMENT_ADDED", metadata: { attachmentId: created.id, fileName } },
      });
      await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
      return created;
    });
  } catch (err) {
    await storage().delete(storageKey); // never leave orphaned bytes behind
    throw err;
  }

  await publishOrgEvent(ticket.organisationId, "TICKET_UPDATED", user.id, { id: ticket.id, number: ticket.number });
  res.status(201).json(serialiseAttachment(attachment));
}

async function loadAttachment(req: Request) {
  const { ticket, membership } = await loadTicket(req);
  const attachment = await prisma.ticketAttachment.findFirst({
    where: { id: param(req, "attachmentId"), ticketId: ticket.id },
    ...attachmentInclude,
  });
  if (!attachment) throw notFound("Attachment not found");
  return { ticket, membership, attachment };
}

export async function downloadAttachment(req: Request, res: Response) {
  const { attachment } = await loadAttachment(req);
  const inline = req.query.inline === "1" && (fileTypeFor(attachment.fileName)?.inline ?? false);

  let stream;
  try {
    stream = await storage().get(attachment.storageKey);
  } catch {
    throw notFound("This file is no longer available");
  }

  res.setHeader("Content-Type", attachment.contentType);
  res.setHeader("Content-Length", String(attachment.size));
  res.setHeader("Content-Disposition", contentDisposition(inline ? "inline" : "attachment", attachment.fileName));
  // Even if a browser renders it, uploaded content runs with no scripts and no origin.
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  stream.on("error", (err) => {
    console.error(`[attachments] stream failed for ${attachment.id}`, err);
    res.destroy(err);
  });
  stream.pipe(res);
}

export async function deleteAttachment(req: Request, res: Response) {
  const user = currentUser(req);
  const { ticket, membership, attachment } = await loadAttachment(req);
  const isUploader = attachment.uploaderId === user.id;
  if (!isUploader && !isOrgAdmin(membership.role)) throw forbidden("Only the uploader or an admin can remove this file");

  await prisma.$transaction([
    prisma.ticketAttachment.delete({ where: { id: attachment.id } }),
    prisma.ticketEvent.create({
      data: { ticketId: ticket.id, actorId: user.id, type: "ATTACHMENT_REMOVED", metadata: { fileName: attachment.fileName } },
    }),
  ]);
  await storage().delete(attachment.storageKey);
  if (!isUploader) {
    await audit(req, {
      organisationId: ticket.organisationId,
      action: "attachment.deleted",
      targetType: "ticket",
      targetId: ticket.id,
      metadata: { fileName: attachment.fileName, uploaderId: attachment.uploaderId },
    });
  }
  await publishOrgEvent(ticket.organisationId, "TICKET_UPDATED", user.id, { id: ticket.id, number: ticket.number });
  res.status(204).send();
}
