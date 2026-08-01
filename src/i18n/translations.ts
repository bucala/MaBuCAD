/**
 * Flat key → string dictionaries, one per translated language.
 *
 * There is deliberately no `en` dictionary here: English is the language every component
 * already writes its literal strings in, so `t(key, englishText)` uses that literal text
 * itself as the English translation and only consults this file for an override. Keys
 * mostly reuse existing ids that already uniquely identify a piece of UI — a ribbon
 * command's `id` (`"feature.extrude"`), a ribbon tab's or group's `id` — so translating
 * the ribbon needed no new keys invented, just this dictionary and three small render-site
 * edits (`Ribbon.tsx`, `RibbonGroup.tsx`, `RibbonButton.tsx`).
 *
 * Scope for this pass: the ribbon (every tab, group and command label), the menu bar,
 * the status bar, the Settings dialog's tab strip, and the New Document dialog — the
 * "chrome" a user sees in every session regardless of what they're modelling. Hover
 * tooltips (`description` on a ribbon command) and the deep per-feature property panel
 * are still English-only; translating those is real further work, not a placeholder.
 */
export const sk: Record<string, string> = {
  // ---------------------------------------------------------------------- ribbon tabs
  home: "Domov",
  sketch: "Náčrt",
  features: "Prvky",
  assembly: "Zostava",
  drawing: "Výkres",
  inspect: "Kontrola",

  // -------------------------------------------------------------------- ribbon groups
  "home-document": "Dokument",
  "home-clipboard": "Úpravy",
  "home-interchange": "Výmena dát",
  "home-view": "Zobrazenie",
  "sketch-mode": "Náčrt",
  "sketch-entities": "Prvky náčrtu",
  "sketch-relations": "Geometrické väzby",
  "sketch-dimensions": "Kóty",
  "sketch-tools": "Nástroje náčrtu",
  "features-additive": "Pridať materiál",
  "features-subtractive": "Odobrať materiál",
  "features-dressup": "Úpravy tvaru",
  "features-pattern": "Pole / Zrkadlenie",
  "features-reference": "Referenčná geometria",
  "assembly-components": "Komponenty",
  "assembly-mates": "Väzby",
  "assembly-arrange": "Usporiadanie",
  "assembly-analysis": "Vyhodnotenie",
  "drawing-sheet": "Hárok",
  "drawing-views": "Pohľady",
  "drawing-annotation": "Popisy",
  "drawing-tables": "Tabuľky",
  "inspect-measure": "Meranie",
  "inspect-check": "Kontrola",
  "inspect-relations": "Väzby",
  "inspect-display": "Zobrazenie",

  // ------------------------------------------------------------------ ribbon commands
  "doc.new": "Nový",
  "doc.open": "Otvoriť",
  "doc.save": "Uložiť",
  "doc.print": "Tlačiť",

  "edit.undo": "Späť",
  "edit.redo": "Znova",
  "edit.delete": "Odstrániť",

  "file.import": "Importovať",
  "file.export-step": "Exportovať STEP",
  "file.export-stl": "Exportovať STL",
  "file.export-iges": "Exportovať IGES",

  "view.zoom-fit": "Priblížiť na celok",
  "view.display-mode": "Štýl zobrazenia",
  "view.hide-show": "Skryť / Zobraziť",
  "view.constraints": "Väzby",

  "sketch.new": "Náčrt",
  "sketch.exit": "Ukončiť náčrt",
  "sketch.select": "Vybrať",
  "sketch.line": "Čiara",
  "sketch.rectangle": "Obdĺžnik",
  "sketch.circle": "Kružnica",
  "sketch.arc": "Oblúk",
  "sketch.spline": "Krivka",
  "sketch.construction": "Konštrukčná čiara",
  "sketch.point": "Bod",
  "sketch.text": "Text",
  "sketch.trim": "Orezať",
  "sketch.offset": "Odsadiť",
  "sketch.mirror": "Zrkadliť",
  "sketch.pattern": "Pole",

  "relation.horizontal": "Horizontálne",
  "relation.vertical": "Vertikálne",
  "relation.parallel": "Rovnobežnosť",
  "relation.perpendicular": "Kolmosť",
  "relation.tangent": "Dotyčnica",
  "relation.coincident": "Zhodnosť",
  "relation.concentric": "Súosovosť",
  "relation.equal": "Rovnaké",
  "relation.fix": "Pevné",

  "dimension.smart": "Inteligentná kóta",
  "dimension.ordinate": "Súradnicová kóta",
  "dimension.horizontal-ordinate": "Horizontálna súradnicová kóta",
  "dimension.vertical-ordinate": "Vertikálna súradnicová kóta",

  "feature.extrude": "Vytiahnutie",
  "feature.revolve": "Rotácia",
  "feature.sweep": "Ťahanie",
  "feature.loft": "Nafukovanie",
  "feature.boundary": "Hraničná plocha",
  "feature.cut-extrude": "Vysunuté orezanie",
  "feature.hole-wizard": "Sprievodca dierou",
  "feature.cut-revolve": "Rotačné orezanie",
  "feature.cut-sweep": "Ťahané orezanie",
  "feature.fillet": "Zaoblenie",
  "feature.chamfer": "Skosenie",
  "feature.shell": "Škrupina",
  "feature.draft": "Úkos",
  "feature.rib": "Rebro",
  "feature.linear-pattern": "Lineárne pole",
  "feature.circular-pattern": "Kruhové pole",
  "feature.mirror": "Zrkadliť",

  "reference.plane": "Rovina",
  "reference.axis": "Os",
  "reference.point": "Bod",
  "reference.csys": "Súradnicový systém",

  "assembly.insert": "Vložiť komponent",
  "assembly.new-part": "Nový diel",
  "assembly.replace": "Nahradiť",
  "mate.coincident": "Zhodnosť",
  "mate.concentric": "Súosovosť",
  "mate.parallel": "Rovnobežnosť",
  "mate.distance": "Vzdialenosť",
  "mate.angle": "Uhol",
  "mate.lock": "Uzamknúť",
  "assembly.move": "Presunúť komponent",
  "assembly.rotate": "Otočiť komponent",
  "assembly.exploded": "Rozpadnutý pohľad",
  "assembly.interference": "Kolízia",
  "assembly.clearance": "Vôľa",

  "drawing.new": "Nový výkres",
  "drawing.sheet-format": "Formát hárku",
  "drawing.model-view": "Pohľad na model",
  "drawing.projected": "Premietnutý pohľad",
  "drawing.section": "Rez",
  "drawing.detail": "Detail",
  "annotation.smart-dimension": "Inteligentná kóta",
  "annotation.ordinate": "Súradnicová kóta",
  "annotation.note": "Poznámka",
  "annotation.datum": "Referenčný prvok",
  "annotation.gdt": "Geometrická tolerancia",
  "annotation.surface-finish": "Drsnosť povrchu",
  "table.bom": "Kusovník",
  "table.hole": "Tabuľka dier",

  "inspect.measure": "Merať",
  "inspect.mass": "Hmotnostné vlastnosti",
  "inspect.section": "Prierezové vlastnosti",
  "inspect.geometry": "Kontrola geometrie",
  "inspect.curvature": "Krivosť",
  "inspect.draft-analysis": "Analýza úkosu",
  "inspect.parent-child": "Nadradený / Podradený",
  "inspect.equations": "Rovnice",
  "inspect.sensors": "Senzory",
  "inspect.appearance": "Vzhľad",

  // ------------------------------------------------------------------------ menu bar
  "menu.file": "Súbor",
  "menu.edit": "Úpravy",
  "menu.view": "Zobrazenie",
  "menu.insert": "Vložiť",
  "menu.tools": "Nástroje",
  "menu.window": "Okno",
  "menu.help": "Pomocník",
  "menu.options": "Možnosti",

  // ---------------------------------------------------------------------- status bar
  "status.fully-defined": "Plne definované",
  "status.under-defined": "Nedostatočne definované",
  "status.over-defined": "Predefinované",
  "status.no-sketch": "Žiadny aktívny náčrt",
  "status.dof": "SVOB",
  "status.editing-part": "Úprava dielu",
  "status.feature-one": "prvok",
  "status.feature-many": "prvky",

  // ------------------------------------------------------------- settings dialog tabs
  "settings.tab.general": "Všeobecné",
  "settings.tab.colours": "Farby",
  "settings.tab.display": "Zobrazenie",
  "settings.tab.sketch": "Náčrt",
  "settings.tab.file": "Súbor",
  "settings.title": "Možnosti aplikácie",
  "settings.language": "Jazyk",

  // ---------------------------------------------------------------- new document dialog
  "newdoc.title": "Nový dokument",
  "newdoc.part": "Diel",
  "newdoc.part.description": "Jedno 3D teleso vytvorené z náčrtov a prvkov.",
  "newdoc.assembly": "Zostava",
  "newdoc.assembly.description": "Spojenie viacerých dielov väzbami. Pripravujeme.",
  "newdoc.drawing": "Výkres",
  "newdoc.drawing.description": "2D pohľady a kóty dielu alebo zostavy. Pripravujeme.",
  "newdoc.coming-soon": "Pripravujeme",
  "newdoc.cancel": "Zrušiť",
  "newdoc.create-part": "Vytvoriť diel",
};
