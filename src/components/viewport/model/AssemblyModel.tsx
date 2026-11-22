import { useEffect, useMemo } from "react";
import { PivotControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";

import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { useSceneAccentColor } from "@/hooks/useSceneAccentColor";
import type { MeshData } from "@/kernel/rebuild";
import { selectComponentNow, useActiveComponentGeometry, useSelectedComponentId } from "@/state/assemblyStore";
import { useDocumentStore } from "@/state/documentStore";
import { useSettingsStore } from "@/state/settingsStore";
import type { AssemblyComponent, ComponentTransform } from "@/types/document";

import { useClickGuard } from "../controls/useClickGuard";

/**
 * Renders the active Assembly: one mesh per loaded, unsuppressed component, placed by its
 * own transform. A left click selects a component; the selected one, unless grounded, gets
 * a move/rotate gizmo whose whole drag is a single undo step (`beginDragEdit`).
 */
export function AssemblyModel() {
  const components = useDocumentStore((state) => state.document.assembly?.components);
  const geometry = useActiveComponentGeometry();
  const selectedId = useSelectedComponentId();
  if (!components) return null;

  return (
    <>
      {components.map((component) => {
        const mesh = geometry[component.id]?.mesh;
        if (component.suppressed || !mesh) return null;
        return (
          <PlacedComponent
            key={component.id}
            component={component}
            mesh={mesh}
            selected={component.id === selectedId}
          />
        );
      })}
    </>
  );
}

export function transformToMatrix({ position, quaternion }: ComponentTransform): Matrix4 {
  return new Matrix4().compose(new Vector3(...position), new Quaternion(...quaternion), new Vector3(1, 1, 1));
}

export function matrixToTransform(matrix: Matrix4): ComponentTransform {
  const position = new Vector3();
  const quaternion = new Quaternion();
  matrix.decompose(position, quaternion, new Vector3());
  quaternion.normalize();
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  };
}

function PlacedComponent({
  component,
  mesh,
  selected,
}: {
  component: AssemblyComponent;
  mesh: MeshData;
  selected: boolean;
}) {
  const matrix = useMemo(() => transformToMatrix(component.transform), [component.transform]);
  const body = <ComponentMesh componentId={component.id} mesh={mesh} selected={selected} />;

  if (!selected || component.grounded) {
    return (
      <group position={component.transform.position} quaternion={component.transform.quaternion}>
        {body}
      </group>
    );
  }

  return (
    <PivotControls
      matrix={matrix}
      autoTransform={false}
      fixed
      scale={90}
      depthTest={false}
      disableScaling
      annotations={false}
      onDragStart={() => useDocumentStore.getState().beginDragEdit()}
      onDrag={(local) => useDocumentStore.getState().setComponentTransform(component.id, matrixToTransform(local))}
      onDragEnd={() => useDocumentStore.getState().endDragEdit()}
    >
      {body}
    </PivotControls>
  );
}

function ComponentMesh({ componentId, mesh, selected }: { componentId: string; mesh: MeshData; selected: boolean }) {
  const isDark = useIsDarkTheme();
  const accent = useSceneAccentColor();
  const modelColor = useSettingsStore((state) => state.modelColor);
  const edgeColor = useSettingsStore((state) => state.modelEdgeColor);
  const isPick = useClickGuard();

  const { body, edges } = useMemo(() => {
    const bodyGeometry = new BufferGeometry();
    bodyGeometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    bodyGeometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
    bodyGeometry.setIndex(new BufferAttribute(mesh.indices, 1));
    bodyGeometry.computeBoundingSphere();
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute("position", new BufferAttribute(mesh.edges, 3));
    edgeGeometry.computeBoundingSphere();
    return { body: bodyGeometry, edges: edgeGeometry };
  }, [mesh]);

  useEffect(
    () => () => {
      body.dispose();
      edges.dispose();
    },
    [body, edges],
  );

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!isPick(event)) return;
    event.stopPropagation();
    selectComponentNow(componentId);
  };

  return (
    <>
      <mesh geometry={body} onClick={handleClick} userData={{ componentId }}>
        <meshStandardMaterial
          color={selected ? accent : (modelColor ?? (isDark ? "#b8c4d0" : "#c9d4e0"))}
          metalness={0.12}
          roughness={0.55}
        />
      </mesh>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color={edgeColor ?? (isDark ? "#1b1f24" : "#2b3138")} />
      </lineSegments>
    </>
  );
}
