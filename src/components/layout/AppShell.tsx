import { Group, Panel, Separator } from "react-resizable-panels";

import { FeatureContextMenu } from "@/components/FeatureContextMenu";
import { MenuBar } from "@/components/menubar/MenuBar";
import { Ribbon } from "@/components/ribbon/Ribbon";
import { ManagerPanel } from "@/components/manager/ManagerPanel";
import { StatusBar } from "@/components/statusbar/StatusBar";
import { Viewport } from "@/components/viewport/Viewport";

import styles from "./AppShell.module.css";

/**
 * Top-level application chrome: menu strip, ribbon, the resizable manager/viewport
 * split, and the status bar.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <MenuBar />
      <Ribbon />

      <div className={styles.body}>
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
      </div>

      <StatusBar />

      {/* Opened from either the 3D viewport (a plane or the modelled solid) or a
          right-clicked row in the Feature Manager tree — see its own doc comment. */}
      <FeatureContextMenu />
    </div>
  );
}
