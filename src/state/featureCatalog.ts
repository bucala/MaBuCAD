import {
  Box,
  Circle,
  CircleDashed,
  Cone,
  Crosshair,
  Cuboid,
  Cylinder,
  Drill,
  FileInput,
  Grid3x3,
  Blend,
  Minus,
  Palette,
  Percent,
  Rotate3d,
  Route,
  RotateCw,
  Ruler,
  Slice,
  SquareDashed,
  Waves,
  Columns3,
  type LucideIcon,
} from "lucide-react";

import type { FeatureKind, FeatureParameters } from "@/types/document";

interface FeatureDefinition {
  /** Base name for auto-numbering, e.g. "Boss-Extrude" produces "Boss-Extrude1". */
  namePrefix: string;
  icon: LucideIcon;
  /** Shown in the property manager under the feature name. */
  description: string;
  defaultParameters: FeatureParameters;
}

/**
 * Per-kind metadata for features: how they are named, drawn in the tree and what
 * parameters they start with.
 *
 * Naming follows SolidWorks conventions, so an extruded boss becomes "Boss-Extrude1"
 * and an extruded cut becomes "Cut-Extrude1".
 */
export const FEATURE_CATALOG: Record<FeatureKind, FeatureDefinition> = {
  annotations: { namePrefix: "Annotations", icon: Ruler, description: "Document annotations", defaultParameters: {} },
  material: { namePrefix: "Material", icon: Palette, description: "Assigned material", defaultParameters: {} },
  plane: { namePrefix: "Plane", icon: SquareDashed, description: "Default reference plane", defaultParameters: {} },
  origin: { namePrefix: "Origin", icon: Crosshair, description: "Document origin", defaultParameters: {} },

  sketch: { namePrefix: "Sketch", icon: Circle, description: "2D profile on a plane or planar face", defaultParameters: {} },

  extrude: {
    namePrefix: "Boss-Extrude",
    icon: Box,
    description: "Extrudes a closed profile into a solid",
    defaultParameters: { depth: 10, endCondition: "blind", reversed: false, operation: "join" },
  },
  revolve: {
    namePrefix: "Revolve",
    icon: RotateCw,
    description: "Revolves a profile about an axis",
    defaultParameters: { angle: 360, operation: "join" },
  },
  sweep: {
    namePrefix: "Sweep",
    icon: Waves,
    description: "Sweeps a profile along a path",
    defaultParameters: {},
  },
  loft: {
    namePrefix: "Loft",
    icon: Cone,
    description: "Blends between two or more profiles",
    defaultParameters: {},
  },

  "cut-extrude": {
    namePrefix: "Cut-Extrude",
    icon: Slice,
    description: "Removes material by extruding a profile",
    defaultParameters: { depth: 10, endCondition: "blind", operation: "cut" },
  },
  "cut-revolve": {
    namePrefix: "Cut-Revolve",
    icon: Cylinder,
    description: "Removes material by revolving a profile",
    defaultParameters: { angle: 360, operation: "cut" },
  },
  "cut-sweep": {
    namePrefix: "Cut-Sweep",
    icon: Route,
    description: "Removes material along a path",
    defaultParameters: {},
  },
  hole: {
    namePrefix: "Hole",
    icon: Drill,
    description: "Standards-based hole",
    defaultParameters: { radius: 3, depth: 10, endCondition: "through-all", holeType: "simple" },
  },

  fillet: {
    namePrefix: "Fillet",
    icon: CircleDashed,
    description: "Rounds selected edges",
    defaultParameters: { radius: 2 },
  },
  chamfer: {
    namePrefix: "Chamfer",
    icon: Percent,
    description: "Bevels selected edges",
    defaultParameters: { distance: 1, angle: 45 },
  },
  shell: {
    namePrefix: "Shell",
    icon: Cuboid,
    description: "Hollows the solid, removing selected faces",
    defaultParameters: { thickness: 2 },
  },
  draft: {
    namePrefix: "Draft",
    icon: Percent,
    description: "Applies a draft angle for moulded parts",
    defaultParameters: { angle: 3 },
  },
  rib: {
    namePrefix: "Rib",
    icon: Columns3,
    description: "Adds a stiffening rib from an open profile",
    defaultParameters: { thickness: 2 },
  },

  "linear-pattern": {
    namePrefix: "LPattern",
    icon: Grid3x3,
    description: "Repeats features along a direction",
    defaultParameters: { count: 4, distance: 20, axis: "x" },
  },
  "circular-pattern": {
    namePrefix: "CirPattern",
    icon: Rotate3d,
    description: "Repeats features about an axis",
    defaultParameters: { count: 6, angle: 360, axis: "z" },
  },
  mirror: {
    namePrefix: "Mirror",
    icon: Blend,
    description: "Mirrors features about a plane",
    defaultParameters: { axis: "x" },
  },

  imported: {
    namePrefix: "Imported",
    icon: FileInput,
    description: "Body loaded from a STEP or STL file",
    defaultParameters: {},
  },

  "reference-plane": {
    namePrefix: "Plane",
    icon: SquareDashed,
    description: "User-created reference plane",
    defaultParameters: { distance: 10 },
  },
  "reference-axis": {
    namePrefix: "Axis",
    icon: Minus,
    description: "User-created reference axis",
    defaultParameters: { axis: "z" },
  },
  "reference-point": {
    namePrefix: "Point",
    icon: Crosshair,
    description: "User-created reference point",
    defaultParameters: { distance: 10, axis: "z" },
  },
  "reference-csys": {
    namePrefix: "CoordSys",
    icon: Rotate3d,
    description: "User-created local coordinate system",
    defaultParameters: {},
  },
};

export function featureIcon(kind: FeatureKind): LucideIcon {
  return FEATURE_CATALOG[kind].icon;
}
