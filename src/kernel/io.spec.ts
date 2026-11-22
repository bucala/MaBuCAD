import { makeBaseBox } from "replicad";
import { describe, expect, it } from "vitest";

import type { Feature } from "@/types/document";

import { importModel, nameStepModel } from "./io";
import { initKernel } from "./occ";
import { rebuildDocument } from "./rebuild";

const STEP_FIXTURE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');
FILE_NAME('Open CASCADE Shape Model','2026-09-13T14:40:31',('Author'),(
    'Open CASCADE'),'Open CASCADE STEP processor 7.6','Open CASCADE 7.6'
  ,'Unknown');
ENDSEC;
DATA;
#7 = PRODUCT('Open CASCADE STEP translator 7.6 1',
  'Open CASCADE STEP translator 7.6 1','',(#8));
#10 = ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11,#15),#757);
#15 = MANIFOLD_SOLID_BREP('',#16);
#23 = CARTESIAN_POINT('',(-3.552713679007E-15,1.11022302469E-16,0.));
ENDSEC;
END-ISO-10303-21;
`;

describe("nameStepModel", () => {
  it("writes the document name into the STEP header, product and B-Rep labels", () => {
    const named = nameStepModel(STEP_FIXTURE, "Part2");

    expect(named).toContain("FILE_NAME('Part2','2026-09-13T14:40:31'");
    expect(named).toContain("#7 = PRODUCT('Part2',\n  'Part2','',(#8));");
    expect(named).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION('Part2',(#11,#15),#757)");
    expect(named).toContain("MANIFOLD_SOLID_BREP('Part2',#16)");
    expect(named).not.toContain("Open CASCADE Shape Model");
    expect(named).not.toContain("Open CASCADE STEP translator");
  });

  it("does not touch entity ids, references or numeric geometry", () => {
    const named = nameStepModel(STEP_FIXTURE, "Bracket");

    expect(named).toContain("#10 = ADVANCED_BREP_SHAPE_REPRESENTATION");
    expect(named).toContain("(#11,#15),#757");
    expect(named).toContain("#23 = CARTESIAN_POINT('',(-3.552713679007E-15,1.11022302469E-16,0.));");
    expect(named.split("\n")).toHaveLength(STEP_FIXTURE.split("\n").length);
  });

  it("encodes apostrophes, reverse solidi and Unicode as valid Part-21 strings", () => {
    const named = nameStepModel(STEP_FIXTURE, "Príruba č. O'Brien\\A $&");
    const encoded = "Pr\\X2\\00ED\\X0\\ruba \\X2\\010D\\X0\\. O''Brien\\\\A $&";

    expect(named).toContain(`FILE_NAME('${encoded}'`);
    expect(named).toContain(`PRODUCT('${encoded}',\n  '${encoded}'`);
  });

  it("uses a stable fallback for an empty document name", () => {
    const named = nameStepModel(STEP_FIXTURE, "   ");
    expect(named).toContain("FILE_NAME('Untitled'");
    expect(named).toContain("PRODUCT('Untitled',\n  'Untitled'");
  });

  it("fails visibly if a future writer no longer emits the required metadata records", () => {
    expect(() => nameStepModel(STEP_FIXTURE.replace("FILE_NAME", "FILE_TITLE"), "Part")).toThrow(
      /FILE_NAME/,
    );
    expect(() => nameStepModel(STEP_FIXTURE.replace("PRODUCT(", "ITEM("), "Part")).toThrow(
      /PRODUCT/,
    );
  });
});

it("rebuilds an STL import from the embedded B-Rep", async () => {
  await initKernel();
  const source = makeBaseBox(5, 8, 12);
  const bytes = await source.blobSTL({ binary: true }).arrayBuffer();
  source.delete();
  const importedBrep = await importModel("box.stl", bytes);
  const feature: Feature = {
    id: "stl-box", name: "box", kind: "imported", parameters: { importedBrep },
    isDefault: false, suppressed: false, parents: [],
  };
  const reopened = JSON.parse(JSON.stringify(feature)) as Feature;
  const result = await rebuildDocument([reopened], {});
  expect(result.errors).toEqual({});
  expect(result.mesh?.positions.length).toBeGreaterThan(0);
});
