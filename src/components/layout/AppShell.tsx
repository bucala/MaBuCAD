import { Group, Panel, Separator } from "react-resizable-panels";

import { FeatureContextMenu } from "@/components/FeatureContextMenu";
import { DocumentTabs } from "@/components/document/DocumentTabs";
import { DrawingSheet } from "@/components/drawing/DrawingSheet";
import { MenuBar } from "@/components/menubar/MenuBar";
import { Ribbon } from "@/components/ribbon/Ribbon";
import { ManagerPanel } from "@/components/manager/ManagerPanel";
import { StatusBar } from "@/components/statusbar/StatusBar";
import { Viewport } from "@/components/viewport/Viewport";
import { useDocumentStore } from "@/state/documentStore";

import styles from "./AppShell.module.css";

/**
 * Top-level application chrome: menu strip, ribbon, the open-document tab strip, the
 * active document's own workspace, and the status bar.
 *
 * The workspace itself branches on the active document's kind: a Part (or the
 * still-unimplemented Assembly) gets the 3D Feature Manager/viewport split every version
 * of this app before multi-document support had; a Drawing has no feature tree or solid
 * of its own to show (see `types/document.ts`'s `DrawingSheetData`) and gets the 2D sheet
 * instead.
 */
export function AppShell() {
  const kind = useDocumentStore((state) => state.document.kind);

  return (
    <div className={styles.shell}>
      <MenuBar />
      <Ribbon />
      <DocumentTabs />

      <div className={styles.body}>
        {kind === "drawing" ? (
          <DrawingSheet />
        ) : (
          <Group orientation="horizontal" id="main-split" className={styles.group}>
            <Panel
              id="manager"
              className={styles.managerPanel}
              defaultSize="300px"
              minSize="240px"
              maxSize="46%"
              collapsible
              collapsedSize="0px"
              groupResizeBehavior="preserve-pixel-size"
            >
              <ManagerPanel />
            </Panel>

            <Separator className={styles.separator} aria-label="Resize the manager panel" />

            <Panel id="viewport" className={styles.viewportPanel} minSize="30%">
              <Viewport />
            </Panel>
          </Group>
        )}
      </div>

      <StatusBar />

      {/* Opened from either the 3D viewport (a plane or the modelled solid) or a
          right-clicked row in the Feature Manager tree — see its own doc comment. */}
      <FeatureContextMenu />
    </div>
  );
}
