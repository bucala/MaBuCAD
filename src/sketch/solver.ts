import {
  buildLayout,
  evaluateResiduals,
  packVariables,
  unpackVariables,
  type VariableLayout,
} from "./residuals";
import type { Sketch, SketchDiagnostics } from "./types";

const MAX_ITERATIONS = 60;
const CONVERGENCE_TOLERANCE = 1e-8;
/** Step used for the finite-difference Jacobian. */
const DERIVATIVE_STEP = 1e-7;
/** Levenberg-Marquardt damping, small enough not to bias a well-posed system. */
const DAMPING = 1e-9;
/** Singular value threshold when counting independent constraint rows. */
const RANK_TOLERANCE = 1e-7;

function norm(values: number[]): number {
  let total = 0;
  for (const value of values) total += value * value;
  return Math.sqrt(total);
}

/**
 * Jacobian by central differences.
 *
 * Analytic derivatives would be faster, but sketches here have tens of variables, and
 * finite differences keep every constraint's residual as the single source of truth —
 * adding a constraint type needs no matching derivative code to get wrong.
 */
function jacobian(
  sketch: Sketch,
  layout: VariableLayout,
  values: Float64Array,
  anchors: Map<string, { x: number; y: number }>,
  rows: number,
): number[][] {
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(layout.size).fill(0));
  const probe = Float64Array.from(values);

  for (let column = 0; column < layout.size; column += 1) {
    const original = probe[column];
    const step = DERIVATIVE_STEP * Math.max(1, Math.abs(original));

    probe[column] = original + step;
    const forward = evaluateResiduals(sketch, layout, probe, anchors);

    probe[column] = original - step;
    const backward = evaluateResiduals(sketch, layout, probe, anchors);

    probe[column] = original;

    for (let row = 0; row < rows; row += 1) {
      matrix[row][column] = (forward[row] - backward[row]) / (2 * step);
    }
  }

  return matrix;
}

/**
 * Solves the damped normal equations (JᵀJ + λI) dx = -JᵀF by Gaussian elimination with
 * partial pivoting.
 *
 * The damping is what lets an under-defined sketch solve at all: the system is
 * rank-deficient by design, and λ picks the smallest step that satisfies the constraints
 * rather than failing on a singular matrix.
 */
function solveNormalEquations(
  matrix: number[][],
  residuals: number[],
  size: number,
): Float64Array | null {
  const normal: number[][] = Array.from({ length: size }, () => new Array(size + 1).fill(0));

  for (let row = 0; row < size; row += 1) {
    for (let column = row; column < size; column += 1) {
      let sum = 0;
      for (let k = 0; k < matrix.length; k += 1) sum += matrix[k][row] * matrix[k][column];
      normal[row][column] = sum;
      normal[column][row] = sum;
    }
    normal[row][row] += DAMPING;

    let rhs = 0;
    for (let k = 0; k < matrix.length; k += 1) rhs += matrix[k][row] * residuals[k];
    normal[row][size] = -rhs;
  }

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(normal[row][pivot]) > Math.abs(normal[best][pivot])) best = row;
    }

    if (Math.abs(normal[best][pivot]) < 1e-14) continue;
    [normal[pivot], normal[best]] = [normal[best], normal[pivot]];

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = normal[row][pivot] / normal[pivot][pivot];
      if (factor === 0) continue;
      for (let column = pivot; column <= size; column += 1) {
        normal[row][column] -= factor * normal[pivot][column];
      }
    }
  }

  const step = new Float64Array(size);
  for (let row = 0; row < size; row += 1) {
    step[row] = Math.abs(normal[row][row]) < 1e-14 ? 0 : normal[row][size] / normal[row][row];
    if (!Number.isFinite(step[row])) return null;
  }

  return step;
}

/** Rank of the Jacobian by Gaussian elimination, used to count degrees of freedom. */
function matrixRank(matrix: number[][], columns: number): number {
  const working = matrix.map((row) => [...row]);
  let rank = 0;

  for (let column = 0; column < columns && rank < working.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < working.length; row += 1) {
      if (Math.abs(working[row][column]) > Math.abs(working[pivot][column])) pivot = row;
    }

    if (Math.abs(working[pivot][column]) < RANK_TOLERANCE) continue;
    [working[rank], working[pivot]] = [working[pivot], working[rank]];

    for (let row = 0; row < working.length; row += 1) {
      if (row === rank) continue;
      const factor = working[row][column] / working[rank][column];
      if (factor === 0) continue;
      for (let k = column; k < columns; k += 1) {
        working[row][k] -= factor * working[rank][k];
      }
    }

    rank += 1;
  }

  return rank;
}

export interface SolveOutcome {
  sketch: Sketch;
  diagnostics: SketchDiagnostics;
}

/**
 * Solves a sketch's constraint system by damped Newton iteration.
 *
 * Returns the updated geometry together with diagnostics the status bar turns into
 * "Fully Defined" / "Under Defined" / "Over Defined". An under-defined sketch is not an
 * error: it solves fine and simply retains degrees of freedom.
 */
export function solveSketch(sketch: Sketch): SolveOutcome {
  const layout = buildLayout(sketch);
  const anchors = new Map(sketch.points.map((point) => [point.id, { x: point.x, y: point.y }]));

  let values = packVariables(sketch, layout);
  let residuals = evaluateResiduals(sketch, layout, values, anchors);

  if (residuals.length === 0 || layout.size === 0) {
    return {
      sketch,
      diagnostics: {
        dof: layout.size,
        converged: true,
        redundant: false,
        residualNorm: 0,
        iterations: 0,
      },
    };
  }

  let iterations = 0;
  let converged = norm(residuals) < CONVERGENCE_TOLERANCE;

  while (!converged && iterations < MAX_ITERATIONS) {
    const matrix = jacobian(sketch, layout, values, anchors, residuals.length);
    const step = solveNormalEquations(matrix, residuals, layout.size);
    if (!step) break;

    const candidate = Float64Array.from(values);
    for (let index = 0; index < layout.size; index += 1) candidate[index] += step[index];

    const candidateResiduals = evaluateResiduals(sketch, layout, candidate, anchors);
    if (!candidateResiduals.every(Number.isFinite)) break;

    values = candidate;
    residuals = candidateResiduals;
    iterations += 1;
    converged = norm(residuals) < CONVERGENCE_TOLERANCE;
  }

  const finalJacobian = jacobian(sketch, layout, values, anchors, residuals.length);
  const rank = matrixRank(finalJacobian, layout.size);

  return {
    sketch: unpackVariables(sketch, layout, values),
    diagnostics: {
      dof: Math.max(0, layout.size - rank),
      converged,
      // Fewer independent rows than equations means at least one constraint restates
      // another, which is what SolidWorks reports as over-defined.
      redundant: rank < residuals.length,
      residualNorm: norm(residuals),
      iterations,
    },
  };
}

/** Maps solver diagnostics onto the status shown in the status bar. */
export function sketchStatusFromDiagnostics(
  diagnostics: SketchDiagnostics,
): "fully-defined" | "under-defined" | "over-defined" {
  if (!diagnostics.converged || diagnostics.redundant) return "over-defined";
  return diagnostics.dof === 0 ? "fully-defined" : "under-defined";
}

/**
 * Which constraints/dimensions are actually responsible for an over-defined sketch —
 * "over-defined" alone (`redundant`/`!converged`) only says *that* something conflicts,
 * not *which* relation to delete to fix it, which is what a user actually needs to see
 * highlighted. Found by brute force: re-solve the sketch with each constraint/dimension
 * removed in turn, one at a time, and flag whichever removals actually clear the
 * over-defined state. Cheap enough to call only when the sketch is already flagged
 * over-defined (a rare, transient error state to begin with, not every solve), and
 * correct by construction — no need to reason about which Jacobian rows are linearly
 * dependent, just to check the same converged/redundant flags the status bar already uses.
 *
 * A minimal conflicting *pair* (each fixes it when removed alone) reports both — matching
 * what a user actually wants highlighted, since either one might be the one they meant to
 * keep and there's no way to guess which.
 */
export function findConflictingConstraints(sketch: Sketch): Set<string> {
  const baseline = solveSketch(sketch);
  if (baseline.diagnostics.converged && !baseline.diagnostics.redundant) return new Set();

  const isFixed = (diagnostics: SketchDiagnostics) => diagnostics.converged && !diagnostics.redundant;
  const offenders = new Set<string>();

  for (const constraint of sketch.constraints) {
    const without = { ...sketch, constraints: sketch.constraints.filter((c) => c.id !== constraint.id) };
    if (isFixed(solveSketch(without).diagnostics)) offenders.add(constraint.id);
  }
  for (const dimension of sketch.dimensions) {
    const without = { ...sketch, dimensions: sketch.dimensions.filter((d) => d.id !== dimension.id) };
    if (isFixed(solveSketch(without).diagnostics)) offenders.add(dimension.id);
  }

  return offenders;
}
