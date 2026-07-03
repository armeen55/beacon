"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OutreachLead, OutreachPipelineRow, OutreachStatus } from "@/domains/outreach/types";
import {
  mineOutreachLeadsAction,
  draftOutreachPitchAction,
  draftOutreachFollowupAction,
  editOutreachDraftAction,
  setOutreachStatusAction,
  sendOutreachPitchAction,
} from "./outreach-actions";

/**
 * OutreachSection (BEACON_500 item 57, 2026-07-02) - the get-cited/link-reclaim
 * pitch pipeline, moved to /diagnostics/competitor-intel (FP10b) when the
 * customer-facing /competitors shell was retired in favor of /prompts. Mine
 * leads from existing evidence -> draft a pitch per lead -> review/edit -> the
 * operator clicks Send (never automatic) -> track status by hand
 * (replied/won/dead) -> queue a follow-up draft for a silent-7-day row (also
 * never auto-sent).
 */

const STATUS_LABEL: Record<OutreachStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent",
  replied: "Replied",
  won: "Won",
  dead: "Dead",
};

const STATUS_CLS: Record<OutreachStatus, string> = {
  draft: "bg-gray-100 text-gray-600 ring-gray-200",
  ready: "bg-sky-50 text-sky-700 ring-sky-200",
  sent: "bg-amber-50 text-amber-700 ring-amber-200",
  replied: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  won: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  dead: "bg-gray-100 text-gray-400 ring-gray-200",
};

const LEAD_SOURCE_LABEL: Record<string, string> = {
  wiki_gap: "Wikipedia gap",
  keyword_gap_competitor: "Competitor keyword",
  profound_citation: "AI citation",
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000));
}

function PitchRow({ row, onChanged }: { row: OutreachPipelineRow; onChanged: () => void }) {
  const [subject, setSubject] = useState(row.pitchSubject);
  const [body, setBody] = useState(row.pitchBody);
  const [email, setEmail] = useState(row.contactEmail ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const editable = row.status === "draft" || row.status === "ready";

  function save() {
    setMsg(null);
    start(async () => {
      const r = await editOutreachDraftAction(row.id, { pitchSubject: subject, pitchBody: body, contactEmail: email || null });
      setMsg(r.ok ? "Saved." : "Could not save.");
      if (r.ok) onChanged();
    });
  }

  function send() {
    setMsg(null);
    start(async () => {
      const r = await sendOutreachPitchAction(row.id);
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setMsg("Sent.");
      onChanged();
    });
  }

  function setStatus(status: Exclude<OutreachStatus, "sent">) {
    start(async () => {
      const r = await setOutreachStatusAction(row.id, status);
      if (r.ok) onChanged();
    });
  }

  function followup() {
    setMsg(null);
    start(async () => {
      const r = await draftOutreachFollowupAction(row);
      setMsg(r.ok ? "Follow-up drafted below. Review it, then click Send yourself." : r.reason);
      if (r.ok) onChanged();
    });
  }

  const eligible = row.status === "sent" && row.sentAt != null && daysSince(row.sentAt) >= 7;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-900">{row.targetDomain}</span>
          <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
            {LEAD_SOURCE_LABEL[row.leadSource] ?? row.leadSource}
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_CLS[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </div>
      <a href={row.targetUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-gray-500 underline-offset-2 hover:underline">
        {row.targetUrl}
      </a>

      {editable ? (
        <div className="space-y-1.5">
          <input
            className="w-full rounded border border-gray-200 px-2 py-1 text-[12px]"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
          <textarea
            className="w-full rounded border border-gray-200 px-2 py-1 text-[12px]"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Pitch body"
          />
          <input
            className="w-full rounded border border-gray-200 px-2 py-1 text-[12px]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Contact email (required to send)"
            type="email"
          />
        </div>
      ) : (
        <div className="rounded bg-gray-50 p-2 text-[12px] text-gray-700">
          <p className="font-medium">{row.pitchSubject}</p>
          <p className="mt-1 whitespace-pre-wrap text-gray-600">{row.pitchBody}</p>
          {row.contactEmail ? <p className="mt-1 text-[11px] text-gray-400">To: {row.contactEmail}</p> : null}
          {row.sentAt ? <p className="mt-1 text-[11px] text-gray-400">Sent {daysSince(row.sentAt)} days ago.</p> : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {editable ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Save edits
            </button>
            <button
              type="button"
              disabled={pending || !email.trim()}
              onClick={send}
              title={email.trim() ? "Send this pitch now - this action sends a real email." : "Add a contact email first."}
              className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Send
            </button>
          </>
        ) : null}
        {row.status === "sent" ? (
          <>
            <button type="button" disabled={pending} onClick={() => setStatus("replied")} className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
              Mark replied
            </button>
            <button type="button" disabled={pending} onClick={() => setStatus("won")} className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
              Mark won
            </button>
            <button type="button" disabled={pending} onClick={() => setStatus("dead")} className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50">
              Mark dead
            </button>
            {eligible ? (
              <button type="button" disabled={pending} onClick={followup} className="rounded-md border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50">
                Draft a follow-up
              </button>
            ) : null}
          </>
        ) : null}
        {row.status === "replied" ? (
          <>
            <button type="button" disabled={pending} onClick={() => setStatus("won")} className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50">
              Mark won
            </button>
            <button type="button" disabled={pending} onClick={() => setStatus("dead")} className="rounded-md border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50">
              Mark dead
            </button>
          </>
        ) : null}
      </div>
      {msg ? <p className="text-[11px] text-gray-500">{msg}</p> : null}
    </div>
  );
}

export function OutreachSection({ initialRows }: { initialRows: OutreachPipelineRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [leads, setLeads] = useState<OutreachLead[]>([]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const trackedIds = new Set(rows.map((r) => r.id));

  function mine() {
    setMsg(null);
    start(async () => {
      const r = await mineOutreachLeadsAction();
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setLeads(r.leads);
      setMsg(r.message);
    });
  }

  function draftFor(lead: OutreachLead) {
    setMsg(null);
    start(async () => {
      const r = await draftOutreachPitchAction(lead);
      if (!r.ok) {
        setMsg(r.reason);
        return;
      }
      setRows((prev) => [r.row, ...prev.filter((x) => x.id !== r.row.id)]);
      setMsg(`Drafted a pitch for ${lead.targetDomain}. Review it below.`);
      router.refresh();
    });
  }

  function refresh() {
    router.refresh();
  }

  const active = rows.filter((r) => r.status !== "dead");
  const dead = rows.filter((r) => r.status === "dead");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Get cited, then close the loop</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            I mine outreach leads from your Wikipedia gaps, competitor keywords, and AI citations, draft a pitch, and
            track it until it is sent, replied to, or won. I never send an email without your click.
          </p>
        </div>
        <button
          type="button"
          onClick={mine}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
        >
          {pending ? "Working…" : "Find outreach leads"}
        </button>
      </div>
      {msg ? <p className="text-[11px] text-gray-500">{msg}</p> : null}

      {leads.length > 0 ? (
        <div className="grid gap-2">
          {leads.map((lead) => (
            <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-gray-900">{lead.targetDomain}</span>
                  <span className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-gray-200">
                    {LEAD_SOURCE_LABEL[lead.leadSource] ?? lead.leadSource}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">{lead.evidence}</p>
              </div>
              {trackedIds.has(lead.id) ? (
                <span className="shrink-0 text-[11px] text-gray-400">Already tracked</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => draftFor(lead)}
                  className="shrink-0 rounded-md border border-indigo-200 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  Draft a pitch
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {active.length > 0 ? (
        <div className="grid gap-2">
          {active.map((row) => (
            <PitchRow key={row.id} row={row} onChanged={refresh} />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center text-[12px] text-gray-500">
          No outreach pitches yet. Click Find outreach leads to mine your existing data.
        </p>
      ) : null}

      {dead.length > 0 ? (
        <p className="text-[11px] text-gray-400">{dead.length} pitch{dead.length === 1 ? "" : "es"} marked dead.</p>
      ) : null}
    </section>
  );
}
