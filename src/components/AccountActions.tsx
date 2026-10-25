"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw } from "lucide-react";
import { AccountForm, type EditableAccount } from "./AccountForm";
import { ApiError, apiRequest } from "./api";

export function AccountActions({ account, today }: { account: EditableAccount & { archivedAt?: string | null }; today: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() {
    dialog.current?.close();
    setEditing(false);
  }

  function remove() {
    if (!window.confirm(`Delete account “${account.name}”? This is permanent. Accounts with transaction history cannot be deleted.`)) return;
    setError(null);
    start(async () => {
      try {
        await apiRequest("DELETE", `/accounts/${account.id}`, undefined, { "If-Match": String(account.version) });
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not delete the account. Please retry.");
      }
    });
  }

  function toggleArchive() {
    const archived = !!account.archivedAt;
    if (!window.confirm(`${archived ? "Restore" : "Archive"} “${account.name}”? ${archived ? "It will be available for new transactions." : "History and balances stay intact; it will be unavailable for new transactions."}`)) return;
    setError(null);
    start(async () => {
      try {
        await apiRequest("PATCH", `/accounts/${account.id}`, { expectedVersion: account.version, archived: !archived });
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not update the account.");
      }
    });
  }

  return (
    <>
      <div className="account-actions">
        <button type="button" className="secondary" disabled={pending} onClick={() => { setEditing(true); dialog.current?.showModal(); }}>Edit</button>
        <button type="button" className="secondary" disabled={pending} onClick={toggleArchive}>{account.archivedAt ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{account.archivedAt ? "Restore" : "Archive"}</button>
        <button type="button" className="secondary danger" disabled={pending} onClick={remove}>{pending ? "Deleting…" : "Delete"}</button>
      </div>
      {error ? <div role="alert" className="error">{error}</div> : null}
      <dialog ref={dialog} className="account-dialog" aria-label={`Edit ${account.name}`} onCancel={close}>
        <button type="button" className="secondary" onClick={close}>Close</button>
        {editing ? <AccountForm key={`${account.id}-${account.version}`} today={today} existing={account} onSaved={close} /> : null}
      </dialog>
    </>
  );
}
