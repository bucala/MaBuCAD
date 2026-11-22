import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Box3, Matrix4, Sphere, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useAssemblyStore } from "@/state/assemblyStore";
import { useDocumentStore } from "@/state/documentStore";
import { useGeometryStore } from "@/state/geometryStore";
import { useViewportStore } from "@/state/viewportStore";
import { useWorkspaceStore } from "@/state/workspaceStore";

import { transformToMatrix } from "../model/AssemblyModel";

import { DEFAULT_CAMERA_POSITION, DOCUMENT_SCALE } from "../constants";

/** How much of the viewport's smaller dimension the fitted model should span. */
const FIT_FRACTION = 0.7;

/**
 * Reframes the camera on "Zoom to Fit", invoked from the ribbon — outside the r3f tree,
 * so it can only reach the camera via this store flag rather than calling into it
 * directly the way `CadControls.tsx` does from inside the `Canvas`.
 *
 * Renders nothing; it exists purely to run the effect below.
 */
export function ZoomToFit() {
  const request = useViewportStore((state) => state.zoomFitRequest);
  const mesh = useGeometryStore((state) => state.mesh);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    // The initial render also satisfies `request !== 0`'s negation trivially — skip it
    // explicitly so the camera doesn't jump on mount, only on an actual button press.
    if (request === 0) return;

    let center = new Vector3(0, 0, 0);
    let radius = DOCUMENT_SCALE * 0.6;

    // `mesh.positions` is already in world space — every feature builds through its own
    // sketch plane's real placement (`kernel/rebuild.ts`'s `replicadPlaneFor`). An
    // Assembly instead contributes each loaded component's mesh through its own transform.
    const worldBox = new Box3();
    const point = new Vector3();
    const addPositions = (positions: Float32Array, matrix?: Matrix4) => {
      for (let i = 0; i < positions.length; i += 3) {
        point.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
        if (matrix) point.applyMatrix4(matrix);
        worldBox.expandByPoint(point);
      }
    };

    const { document } = useDocumentStore.getState();
    if (document.assembly) {
      const tabId = useWorkspaceStore.getState().activeId;
      const loaded = useAssemblyStore.getState().tabs[tabId] ?? {};
      for (const component of document.assembly.components) {
        const componentMesh = loaded[component.id]?.mesh;
        if (component.suppressed || !componentMesh) continue;
        addPositions(componentMesh.positions, transformToMatrix(component.transform));
      }
    } else if (mesh) {
      addPositions(mesh.positions);
    }

    if (!worldBox.isEmpty()) {
      const sphere = new Sphere();
      worldBox.getBoundingSphere(sphere);
      center = sphere.center;
      radius = Math.max(sphere.radius, 1e-3);
    }

    const target = controls?.target ?? new Vector3(0, 0, 0);
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() < 1e-6) {
      direction.set(...DEFAULT_CAMERA_POSITION);
    }
    direction.normalize();

    controls?.target.copy(center);

    if (camera.type === "PerspectiveCamera" && "fov" in camera) {
      const fov = (camera.fov * Math.PI) / 180;
      const distance = radius / Math.sin(fov / 2) / FIT_FRACTION;
      camera.position.copy(center).addScaledVector(direction, distance);
    } else if (camera.type === "OrthographicCamera" && "zoom" in camera) {
      camera.zoom = (Math.min(size.width, size.height) * FIT_FRACTION) / (radius * 2);
      // Distance still matters for the near/far clipping planes, even though an
      // orthographic projection's apparent size only depends on `zoom`.
      camera.position.copy(center).addScaledVector(direction, DOCUMENT_SCALE * 3);
    }

    camera.updateProjectionMatrix();
    controls?.update();
    invalidate();
    // Only the request counter should re-trigger this — camera/controls/mesh are read at
    // the moment the button is pressed, not watched for their own changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return null;
}
