import type { LucideIcon } from "lucide-react";

/**
 * Identifier of a ribbon command. Steps 2-5 register handlers against these ids
 * rather than editing ribbon markup, so the command surface and its behaviour
 * stay decoupled.
 */
export type CommandId = string;

export interface RibbonItem {
  id: CommandId;
  label: string;
  icon: LucideIcon;
  /** Large items get the tall icon-over-label treatment at the head of a group. */
  size: "large" | "small";
  /** Tooltip body. Falls back to the label when omitted. */
  description?: string;
  /**
   * Whether the command can be invoked, defaulting to true. Later steps set this from
   * context — a sketch tool is unavailable outside sketch mode, a mate is unavailable
   * in a part document — so the ribbon greys out what does not currently apply.
   */
  enabled?: boolean;
}

export interface RibbonGroup {
  id: string;
  label: string;
  items: RibbonItem[];
}

export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
}

/** Left panel tabs, mirroring the SolidWorks Feature/Property/Configuration manager split. */
export type ManagerTabId = "features" | "properties" | "configurations";

/** Unit systems offered in the status bar. */
export type UnitSystemId = "MMGS" | "CGS" | "MKS" | "IPS";

export interface UnitSystem {
  id: UnitSystemId;
  label: string;
  description: string;
}

/** Constraint state of the active sketch, reported in the status bar. */
export type SketchStatus = "fully-defined" | "under-defined" | "over-defined" | "no-sketch";

export interface FeatureNode {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Reference geometry that ships with every new document and cannot be deleted. */
  isDefault?: boolean;
  children?: FeatureNode[];
}
