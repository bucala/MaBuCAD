import { useEffect, useRef } from "react";

import { resolveClose, useCloseConfirmation } from "@/commands/closeDocuments";
import { useTranslation } from "@/i18n/useTranslation";

import styles from "./CloseDocumentsDialog.module.css";
import actionStyles from "./NewDocumentDialog.module.css";

export function CloseDocumentsDialog() {
  const { target, documents, busy, error } = useCloseConfirmation();
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    element.showModal();
    cancel.current?.focus();
    return () => element.close();
  }, [open]);

  if (!target) return null;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="close-documents-title"
      aria-describedby={documents.length > 0 ? "close-documents-description" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        void resolveClose("cancel");
      }}
    >
      <header className={actionStyles.header}>
        <h2 className={actionStyles.title} id="close-documents-title">
          {t("close.title", "Save changes before closing?")}
        </h2>
      </header>
      <div className={styles.content}>
        {documents.length > 0 && (
          <>
            <p id="close-documents-description">
              {documents.length === 1
                ? t("close.unsaved-one", "This document has unsaved changes.")
                : t("close.unsaved", "These documents have unsaved changes.")}
            </p>
            <ul className={styles.documents}>
              {documents.map(({ id, name }) => <li key={id}>{name}</li>)}
            </ul>
          </>
        )}
        {busy === "save" && <p role="status">{t("close.saving", "Saving…")}</p>}
        {error === "save" && <p role="alert">{t("close.save-incomplete", "Some changes are still unsaved. You can retry or cancel closing.")}</p>}
        {error === "close" && <p role="alert">{t("close.failed", "The window could not be closed. Try again.")}</p>}
      </div>
      <footer className={actionStyles.footer}>
        <button
          ref={cancel}
          type="button"
          className={actionStyles.footerButton}
          disabled={busy !== null}
          onClick={() => void resolveClose("cancel")}
        >
          {t("newdoc.cancel", "Cancel")}
        </button>
        <div className={actionStyles.footerSpacer} />
        <button
          type="button"
          className={actionStyles.footerButton}
          disabled={busy !== null}
          onClick={() => void resolveClose("discard")}
        >
          {t("close.discard", "Close without saving")}
        </button>
        <button
          type="button"
          className={actionStyles.primaryButton}
          disabled={busy !== null}
          onClick={() => void resolveClose("save")}
        >
          {target.kind === "window" && documents.length > 1
            ? t("close.save-all", "Save all and close")
            : t("close.save", "Save and close")}
        </button>
      </footer>
    </dialog>
  );
}
