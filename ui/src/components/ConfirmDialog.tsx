import { useEffect, useRef } from "react";

export function ConfirmDialog({ message, confirmLabel, onResult }: { message: string; confirmLabel: string; onResult: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onResult(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResult]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onResult(false); }}>
      <div className="modal modal-small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
        <p id="confirm-msg" className="modal-message" style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{message}</p>
        <div className="modal-footer">
          <button type="button" className="btn" ref={cancelRef} onClick={() => onResult(false)}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={() => onResult(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
