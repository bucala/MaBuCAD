import { Box, PenTool, Plus, X, type LucideIcon } from "lucide-react";

import { useDocumentStore } from "@/state/documentStore";
import { useWorkspaceStore } from "@/state/workspaceStore";
import type { DocumentKind } from "@/types/document";
import { useTranslation } from "@/i18n/useTranslation";

import styles from "./DocumentTabs.module.css";

const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  part: Box,
  assembly: Box,
  drawing: PenTool,
};

/**
 * The open-document tab strip — one tab per `workspaceStore.ts` session.
 *
 * The active tab's own label/dirty-dot read live from `documentStore` (so renaming the
 * document or making an edit updates it immediately); every other tab reads its own cold
 * snapshot from `session`, which is exactly as current as it was the moment the user last
 * switched away from it — correct, since nothing can edit a tab that isn't active.
 */
export function DocumentTabs() {
  const sessions = useWorkspaceStore((state) => state.sessions);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const switchTo = useWorkspaceStore((state) => state.switchTo);
  const closeDocument = useWorkspaceStore((state) => state.closeDocument);
  const openNewDocumentDialog = useDocumentStore((state) => state.openNewDocumentDialog);
  const activeName = useDocumentStore((state) => state.document.name);
  const activeIsDirty = useDocumentStore((state) => state.past.length > 0);
  const { t } = useTranslation();

  return (
    <div className={styles.strip} role="tablist" aria-label={t("tabs.aria-label", "Open documents")}>
      <div className={styles.tabList}>
        {sessions.map((session) => {
          const isActive = session.id === activeId;
          const name = isActive ? activeName : session.document.name;
          const dirty = isActive ? activeIsDirty : session.past.length > 0;
          const Icon = KIND_ICON[session.kind];

          return (
            <div
              key={session.id}
              role="tab"
              aria-selected={isActive}
              className={styles.tab}
              data-active={isActive || undefined}
              onClick={() => switchTo(session.id)}
              onAuxClick={(event) => {
                // Middle-click closes, matching every tabbed browser/editor.
                if (event.button === 1) closeDocument(session.id);
              }}
            >
              <Icon size={13} strokeWidth={1.75} className={styles.tabIcon} aria-hidden="true" />
              <span className={styles.tabLabel}>{name}</span>
              {dirty && <span className={styles.dirtyDot} aria-hidden="true" />}
              <button
                type="button"
                className={styles.closeButton}
                aria-label={t("tabs.close", "Close {{name}}").replace("{{name}}", name)}
                onClick={(event) => {
                  event.stopPropagation();
                  closeDocument(session.id);
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.newTabButton}
        title={t("tabs.new", "New document")}
        aria-label={t("tabs.new", "New document")}
        onClick={openNewDocumentDialog}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
