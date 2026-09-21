import {
  AlignHorizontalJustifyCenter,
  Anchor,
  Blend,
  Box,
  Boxes,
  Calculator,
  Circle,
  CircleDashed,
  CircleDot,
  Columns3,
  Combine,
  Component,
  Cone,
  Crosshair,
  Cuboid,
  Cylinder,
  Diameter,
  Drill,
  Eye,
  FileInput,
  FileOutput,
  FilePlus2,
  FileText,
  Flame,
  FolderOpen,
  Frame,
  Grid2x2,
  Grid3x3,
  Group,
  Image,
  Layers,
  ListChecks,
  Link2,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  Move,
  MoveHorizontal,
  MoveVertical,
  Percent,
  Printer,
  Puzzle,
  Repeat,
  Rotate3d,
  RotateCw,
  Route,
  Ruler,
  Save,
  SaveAll,
  Scan,
  Scissors,
  Shapes,
  Slice,
  Spline,
  Square,
  SquareDashed,
  Tangent,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Waves,
  Weight,
  Wrench,
  ZoomIn,
} from "lucide-react";

import type { RibbonTab } from "@/types/ui";

/**
 * Declarative description of the whole command surface.
 *
 * Nothing here is wired to behaviour yet — Step 1 renders the chrome only. Later steps
 * attach handlers keyed by `id`, which keeps the ribbon layout and the command
 * implementations independent of one another.
 */
export const RIBBON_TABS: RibbonTab[] = [
  {
    id: "home",
    label: "Home",
    groups: [
      {
        id: "home-document",
        label: "Document",
        items: [
          { id: "doc.new", label: "New", icon: FilePlus2, size: "large", description: "Create a new part, assembly or drawing" },
          { id: "doc.open", label: "Open", icon: FolderOpen, size: "small", description: "Open an existing document" },
          { id: "doc.save", label: "Save", icon: Save, size: "small", description: "Save the active document" },
          { id: "doc.save-as", label: "Save As", icon: SaveAll, size: "small", description: "Save the active document to a new location" },
          { id: "doc.print", label: "Print", icon: Printer, size: "small", description: "Print the current 3D view" },
        ],
      },
      {
        id: "home-clipboard",
        label: "Edit",
        items: [
          { id: "edit.undo", label: "Undo", icon: Undo2, size: "small", description: "Undo the last action" },
          { id: "edit.redo", label: "Redo", icon: Repeat, size: "small", description: "Redo the last undone action" },
          { id: "edit.delete", label: "Delete", icon: Trash2, size: "small", description: "Delete the selection" },
        ],
      },
      {
        id: "home-interchange",
        label: "Interchange",
        items: [
          { id: "file.import", label: "Import", icon: FileInput, size: "large", description: "Import a STEP or STL body into the document" },
          { id: "file.export-step", label: "Export STEP", icon: FileOutput, size: "small", description: "Exact B-Rep solid, keeps surfaces for re-import" },
          { id: "file.export-stl", label: "Export STL", icon: FileOutput, size: "small", description: "Triangulated mesh for 3D printing and manufacturing hand-off" },
          {
            id: "file.export-iges",
            label: "Export IGES",
            icon: FileOutput,
            size: "small",
            description: "Unavailable: the bundled OpenCASCADE build has no IGES support compiled in",
          },
        ],
      },
      {
        id: "home-view",
        label: "View",
        items: [
          { id: "view.zoom-fit", label: "Zoom to Fit", icon: ZoomIn, size: "small", description: "Frame the whole model in the viewport" },
          { id: "view.display-mode", label: "Display Style", icon: Eye, size: "small", description: "Shaded, shaded with edges, wireframe" },
          { id: "view.hide-show", label: "Hide / Show", icon: Layers, size: "small", description: "Toggle visibility of the selected plane, origin or body" },
          { id: "view.constraints", label: "Constraints", icon: ListChecks, size: "small", description: "Toggle horizontal/vertical/parallel/... constraint glyphs in the sketch" },
        ],
      },
    ],
  },
  {
    id: "sketch",
    label: "Sketch",
    groups: [
      {
        id: "sketch-mode",
        label: "Sketch",
        items: [
          { id: "sketch.new", label: "Sketch", icon: SquareDashed, size: "large", description: "Create a sketch on a plane or planar face" },
          { id: "sketch.exit", label: "Exit Sketch", icon: Scan, size: "small", description: "Leave sketch mode and rebuild" },
          { id: "sketch.select", label: "Select", icon: MousePointer2, size: "small", description: "Select sketch entities" },
        ],
      },
      {
        id: "sketch-entities",
        label: "Sketch Entities",
        items: [
          { id: "sketch.line", label: "Line", icon: Minus, size: "large", description: "Draw a line or a chain of lines" },
          { id: "sketch.rectangle", label: "Rectangle", icon: Square, size: "large", description: "Draw a corner or centre rectangle" },
          { id: "sketch.circle", label: "Circle", icon: Circle, size: "large", description: "Draw a circle from centre and radius" },
          { id: "sketch.arc", label: "Arc", icon: CircleDashed, size: "small", description: "Draw a centrepoint, tangent or 3-point arc" },
          { id: "sketch.spline", label: "Spline", icon: Spline, size: "small", description: "Draw a B-spline through control points" },
          { id: "sketch.construction", label: "Construction Line", icon: Route, size: "small", description: "Draw reference geometry excluded from profiles" },
          { id: "sketch.point", label: "Point", icon: CircleDot, size: "small", description: "Place a sketch point" },
        ],
      },
      {
        id: "sketch-relations",
        label: "Geometric Relations",
        items: [
          { id: "relation.horizontal", label: "Horizontal", icon: MoveHorizontal, size: "small", description: "Constrain entities parallel to the sketch X axis" },
          { id: "relation.vertical", label: "Vertical", icon: MoveVertical, size: "small", description: "Constrain entities parallel to the sketch Y axis" },
          { id: "relation.parallel", label: "Parallel", icon: Columns3, size: "small", description: "Constrain two lines parallel" },
          { id: "relation.perpendicular", label: "Perpendicular", icon: Grid2x2, size: "small", description: "Constrain two lines at 90 degrees" },
          { id: "relation.tangent", label: "Tangent", icon: Tangent, size: "small", description: "Constrain a curve tangent to another entity" },
          { id: "relation.coincident", label: "Coincident", icon: Anchor, size: "small", description: "Make points or a point and a curve coincide" },
          { id: "relation.concentric", label: "Concentric", icon: Diameter, size: "small", description: "Share a centre between arcs and circles" },
          { id: "relation.equal", label: "Equal", icon: AlignHorizontalJustifyCenter, size: "small", description: "Force equal length or equal radius" },
          { id: "relation.fix", label: "Fix", icon: Lock, size: "small", description: "Pin an entity to the sketch coordinate system" },
        ],
      },
      {
        id: "sketch-dimensions",
        label: "Dimensions",
        items: [
          { id: "dimension.smart", label: "Smart Dimension", icon: Ruler, size: "large", description: "Infer linear, angular, radial or diameter dimensions from the selection" },
          { id: "dimension.ordinate", label: "Ordinate", icon: Grid3x3, size: "large", description: "Chain dimensions measured from a single zero datum" },
          { id: "dimension.horizontal-ordinate", label: "Horizontal Ordinate", icon: MoveHorizontal, size: "small", description: "Ordinate dimensions along the X datum" },
          { id: "dimension.vertical-ordinate", label: "Vertical Ordinate", icon: MoveVertical, size: "small", description: "Ordinate dimensions along the Y datum" },
        ],
      },
      {
        id: "sketch-tools",
        label: "Sketch Tools",
        items: [
          { id: "sketch.trim", label: "Trim", icon: Scissors, size: "small", description: "Trim entities back to their nearest intersection" },
          { id: "sketch.offset", label: "Offset", icon: Combine, size: "small", description: "Offset selected entities by a distance" },
          { id: "sketch.mirror", label: "Mirror", icon: Blend, size: "small", description: "Mirror entities about a construction line" },
          { id: "sketch.pattern", label: "Pattern", icon: Grid3x3, size: "small", description: "Linear or circular sketch pattern" },
        ],
      },
    ],
  },
  {
    id: "features",
    label: "Features",
    groups: [
      {
        id: "features-additive",
        label: "Add Material",
        items: [
          { id: "feature.extrude", label: "Extruded Boss", icon: Box, size: "large", description: "Extrude a sketch profile into a solid" },
          { id: "feature.revolve", label: "Revolved Boss", icon: RotateCw, size: "large", description: "Revolve a profile about an axis" },
          { id: "feature.sweep", label: "Swept Boss", icon: Waves, size: "large", description: "Sweep a profile along a path" },
          { id: "feature.loft", label: "Lofted Boss", icon: Cone, size: "large", description: "Blend between two or more profiles" },
        ],
      },
      {
        id: "features-subtractive",
        label: "Remove Material",
        items: [
          { id: "feature.cut-extrude", label: "Extruded Cut", icon: Slice, size: "large", description: "Remove material by extruding a profile" },
          { id: "feature.hole-wizard", label: "Hole Wizard", icon: Drill, size: "large", description: "Standards-based counterbore, countersink and tapped holes" },
          { id: "feature.cut-revolve", label: "Revolved Cut", icon: Cylinder, size: "small", description: "Remove material by revolving a profile" },
          { id: "feature.cut-sweep", label: "Swept Cut", icon: Route, size: "small", description: "Remove material along a path" },
        ],
      },
      {
        id: "features-dressup",
        label: "Dress-up",
        items: [
          { id: "feature.fillet", label: "Fillet", icon: CircleDashed, size: "large", description: "Round edges with a constant radius" },
          { id: "feature.chamfer", label: "Chamfer", icon: Triangle, size: "large", description: "Bevel edges by a fixed distance" },
          { id: "feature.shell", label: "Shell", icon: Cuboid, size: "large", description: "Hollow a solid, removing faces along a chosen axis" },
          { id: "feature.draft", label: "Draft", icon: Percent, size: "small", description: "Apply a draft angle for moulded parts" },
          { id: "feature.rib", label: "Rib", icon: Columns3, size: "small", description: "Add a stiffening rib from an open profile" },
        ],
      },
      {
        id: "features-pattern",
        label: "Pattern / Mirror",
        items: [
          { id: "feature.linear-pattern", label: "Linear Pattern", icon: Grid3x3, size: "small", description: "Repeat features along one or two directions" },
          { id: "feature.circular-pattern", label: "Circular Pattern", icon: Rotate3d, size: "small", description: "Repeat features about an axis" },
          { id: "feature.mirror", label: "Mirror", icon: Blend, size: "small", description: "Mirror features about a plane" },
        ],
      },
      {
        id: "features-reference",
        label: "Reference Geometry",
        items: [
          { id: "reference.plane", label: "Plane", icon: SquareDashed, size: "small", description: "Create a reference plane" },
          { id: "reference.axis", label: "Axis", icon: Minus, size: "small", description: "Create a reference axis" },
          { id: "reference.point", label: "Point", icon: Crosshair, size: "small", description: "Create a reference point" },
          { id: "reference.csys", label: "Coordinate System", icon: Rotate3d, size: "small", description: "Create a local coordinate system" },
        ],
      },
    ],
  },
  {
    id: "assembly",
    label: "Assembly",
    groups: [
      {
        id: "assembly-components",
        label: "Components",
        items: [
          { id: "assembly.insert", label: "Insert Component", icon: Puzzle, size: "large", description: "Place an existing part or sub-assembly" },
          { id: "assembly.new-part", label: "New Part", icon: Component, size: "small", description: "Create a part in the context of the assembly" },
          { id: "assembly.replace", label: "Replace", icon: Repeat, size: "small", description: "Swap a component while keeping its mates" },
        ],
      },
      {
        id: "assembly-mates",
        label: "Mates",
        items: [
          { id: "mate.coincident", label: "Coincident", icon: Anchor, size: "large", description: "Make faces, edges or vertices touch" },
          { id: "mate.concentric", label: "Concentric", icon: Diameter, size: "large", description: "Align cylindrical faces on a common axis" },
          { id: "mate.parallel", label: "Parallel", icon: Columns3, size: "small", description: "Keep two faces or edges parallel" },
          { id: "mate.distance", label: "Distance", icon: Ruler, size: "small", description: "Hold a fixed offset between entities" },
          { id: "mate.angle", label: "Angle", icon: Triangle, size: "small", description: "Hold a fixed angle between entities" },
          { id: "mate.lock", label: "Lock", icon: Lock, size: "small", description: "Fully fix a component relative to another" },
        ],
      },
      {
        id: "assembly-arrange",
        label: "Arrange",
        items: [
          { id: "assembly.move", label: "Move Component", icon: Move, size: "small", description: "Drag a component within its remaining freedom" },
          { id: "assembly.rotate", label: "Rotate Component", icon: Rotate3d, size: "small", description: "Rotate a component within its remaining freedom" },
          { id: "assembly.exploded", label: "Exploded View", icon: Boxes, size: "small", description: "Author an exploded presentation" },
        ],
      },
      {
        id: "assembly-analysis",
        label: "Evaluate",
        items: [
          { id: "assembly.interference", label: "Interference", icon: Combine, size: "small", description: "Detect clashes between components" },
          { id: "assembly.clearance", label: "Clearance", icon: Ruler, size: "small", description: "Verify minimum clearances" },
        ],
      },
    ],
  },
  {
    id: "drawing",
    label: "Drawing",
    groups: [
      {
        id: "drawing-sheet",
        label: "Sheet",
        items: [
          { id: "drawing.new", label: "New Drawing", icon: FileText, size: "large", description: "Create a drawing from the active model" },
          { id: "drawing.sheet-format", label: "Sheet Format", icon: Frame, size: "small", description: "Choose sheet size and title block" },
          { id: "drawing.edit-background", label: "Edit Background", icon: Image, size: "small", description: "Edit the sheet's border/background template" },
          { id: "drawing.update-views", label: "Update Views", icon: RotateCw, size: "small", description: "Re-project every view from the referenced part's current geometry" },
        ],
      },
      {
        id: "drawing-views",
        label: "Views",
        items: [
          { id: "drawing.model-view", label: "Model View", icon: Box, size: "large", description: "Place a standard orthographic view" },
          { id: "drawing.projected", label: "Projected", icon: Grid2x2, size: "small", description: "Project a view from an existing one" },
          { id: "drawing.section", label: "Section", icon: Slice, size: "small", description: "Create a section view from a cutting line" },
          { id: "drawing.detail", label: "Detail", icon: ZoomIn, size: "small", description: "Create an enlarged detail view" },
        ],
      },
      {
        id: "drawing-annotation",
        label: "Annotation",
        items: [
          { id: "annotation.smart-dimension", label: "Smart Dimension", icon: Ruler, size: "large", description: "Dimension drawing geometry" },
          { id: "annotation.ordinate", label: "Ordinate", icon: Grid3x3, size: "large", description: "Ordinate dimensions from a single datum" },
          { id: "annotation.note", label: "Note", icon: Type, size: "small", description: "Place a note with optional leader" },
          { id: "annotation.hole-callout", label: "Hole Callout", icon: CircleDot, size: "small", description: "Create a standards-aware callout from a projected Hole Wizard circle" },
          { id: "annotation.datum", label: "Datum Feature", icon: Anchor, size: "small", description: "Place a datum feature symbol" },
          { id: "annotation.gdt", label: "Geometric Tolerance", icon: Shapes, size: "small", description: "Place a feature control frame" },
          { id: "annotation.surface-finish", label: "Surface Finish", icon: Waves, size: "small", description: "Place a surface finish symbol" },
          { id: "annotation.weld", label: "Weld Symbol", icon: Flame, size: "small", description: "Place a weld symbol" },
        ],
      },
      {
        id: "drawing-tables",
        label: "Tables",
        items: [
          { id: "table.bom", label: "Bill of Materials", icon: Columns3, size: "small", description: "Insert a BOM table" },
          { id: "table.hole", label: "Hole Table", icon: Grid3x3, size: "small", description: "Insert an ordinate-referenced hole table" },
        ],
      },
    ],
  },
  {
    id: "inspect",
    label: "Inspect",
    groups: [
      {
        id: "inspect-measure",
        label: "Measure",
        items: [
          { id: "inspect.measure", label: "Measure", icon: Ruler, size: "large", description: "Measure a picked face/edge, and the distance between two picks" },
          { id: "inspect.mass", label: "Mass Properties", icon: Weight, size: "large", description: "Volume, surface area and centre of mass" },
          { id: "inspect.section", label: "Section Properties", icon: Slice, size: "small", description: "Area and centroid of a picked face" },
        ],
      },
      {
        id: "inspect-check",
        label: "Check",
        items: [
          { id: "inspect.geometry", label: "Check Geometry", icon: Wrench, size: "small", description: "Flag any face or edge with zero area/length" },
          { id: "inspect.draft-analysis", label: "Draft Analysis", icon: Percent, size: "small", description: "Colour faces by draft angle" },
        ],
      },
      {
        id: "inspect-relations",
        label: "Relations",
        items: [
          { id: "inspect.parent-child", label: "Parent / Child", icon: Link2, size: "small", description: "Show dependencies of a feature" },
          { id: "inspect.equations", label: "Equations", icon: Calculator, size: "small", description: "Drive sketch dimensions with global variables" },
          { id: "inspect.sensors", label: "Sensors", icon: Magnet, size: "small", description: "Monitor properties and alert on changes" },
        ],
      },
      {
        id: "inspect-display",
        label: "Display",
        items: [
          { id: "inspect.appearance", label: "Appearance", icon: Group, size: "small", description: "Paint faces with a colour override" },
        ],
      },
    ],
  },
];
