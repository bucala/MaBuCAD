import {
  buildEntityMap,
  buildLayout,
  measuredDimensionValue,
  packVariables,
  residualSources,
  sourceResiduals,
  unpackVariables,
  type ResidualSource,
  type VariableLayout,
} from "./residuals";
import type { Sketch, SketchDiagnostics, SketchEntity } from "./types";

const MAX_ITERATIONS = 60;
const CONVERGENCE_TOLERANCE = 1e-8;
/** Step used for the finite-difference Jacobian. */
const DERIVATIVE_STEP = 1e-7;
/** Levenberg-Marquardt damping, small enough not to bias a well-posed system. */
const DAMPING = 1e-9;
/**
 * How many times a rejected Newton step is halved before the iteration gives up on it.
 * A damped Newton step can overshoot — its linear model is only locally valid — so a step
 * that *increases* the residual norm is retried at half, quarter, … scale rather than
 * accepted (the pre-backtracking behaviour) or thrown away after one try.
 */
const MAX_BACKTRACKING_STEPS = 5;
/** Pivot threshold when counting independent constraint rows, applied after each row is
 * normalised by its own largest entry — see `rankAndMobileColumns`. */
const RANK_TOLERANCE = 1e-7;
/** How large a null-space back-substitution component must be before a pinned variable
 * counts as co-moving with a free one — genuine couplings are O(1) on the row-normalised
 * reduced matrix, while finite-difference noise sits near `RANK_TOLERANCE`, so this is
 * one order above the noise and far below any real coupling. */
const MOBILITY_TOLERANCE = 1e-6;

function norm(values: number[]): number {
  let total = 0;
  for (const value of values) total += value * value;
  return Math.sqrt(total);
}

/**
 * Jacobian by central differences, exploiting each residual block's sparse dependencies.
 *
 * A constraint's equations only read a handful of the sketch's variables, so instead of
 * perturbing a full variable at a time — the dense build pays 2n+1 *whole* residual
 * evaluations per iteration and touches every row×column cell, which is quadratic in the
 * sketch and dominates once sketches reach hundreds of variables — each block recomputes
 * only its own rows and only along the variables its own equations read. Rows stay at zero
 * off their block's own `variables`, and a free variable that no block references keeps its
 * entire column zero (dense probing would have found the same zeros, just at full cost).
 *
 * The `jacobian.spec.ts` consistency suite is the guarantee that this sparse build produces
 * the same matrix as a dense full-vector perturbation on every constraint/dimension kind —
 * including the `fix`-on-circle/arc radius rows — so a drift in the dependency tables in
 * `residuals.ts` fails loudly instead of silently producing a wrong solver.
 *
 * Exported only so that suit can call the exact same function the solver uses; no other
 * caller imports it.
 */
export function jacobian(
  sources: ResidualSource[],
  layout: VariableLayout,
  values: Float64Array,
  rows: number,
): number[][] {
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(layout.size).fill(0));
  const probe = Float64Array.from(values);

  for (const source of sources) {
    const start = source.rowStart;
    const evaluate = source.evaluate;

    for (const column of source.variables) {
      const original = probe[column];
      const step = DERIVATIVE_STEP * Math.max(1, Math.abs(original));

      probe[column] = original + step;
      const forward = evaluate(probe);

      probe[column] = original - step;
      const backward = evaluate(probe);

      probe[column] = original;

      const denominator = 2 * step;
      for (let row = 0; row < forward.length; row += 1) {
        matrix[start + row][column] = (forward[row] - backward[row]) / denominator;
      }
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

/**
 * Rank of the Jacobian by Gaussian elimination, and which variable columns can actually
 * move under the constraints — used to count degrees of freedom and to colour entities.
 *
 * Each row is normalised by its own largest entry first: constraint rows arrive in mixed
 * scales (a degenerate-direction guard divides by a `MIN_LENGTH` clamp, which for a
 * zero-length line produces entries around 1e9, while an ordinary coincidence row sits
 * near 1), so a raw absolute threshold lets one extreme row dominate pivot selection and
 * flickers the counted rank — and with it the DOF readout — between solves of
 * near-identical constraint sets. On the normalised matrix `RANK_TOLERANCE` keeps one
 * constant meaning ("a pivot this small is finite-difference noise, not an independent
 * direction") across rows of any original scale.
 *
 * The mobility flags come out of the same sweep. The elimination walks columns left to
 * right and subtracts every pivot column from all other rows, so it ends in reduced row
 * echelon form: a column that never becomes a pivot is *free* — an infinitesimal motion
 * of that variable alone satisfies every equation — and each pivot row then shows, at
 * each free column, exactly how that row's own pivot variable co-moves with it (the
 * standard null-space back-substitution: v[f] = 1, v[p] = -row[p][f] / row[p][p]). A
 * variable is mobile when its column is free *or* it co-moves with some free column:
 * counting free columns alone would call the first point of a coincident, otherwise
 * unconstrained pair "pinned" (its columns pivoted) when dragging it in fact drags both.
 * The mobile count is consistent with the reported DOF by construction — every column
 * either becomes a pivot (counted in the rank) or is free, and mobility only adds pivot
 * columns that provably co-move with one.
 */
function rankAndMobileColumns(matrix: number[][], columns: number): { rank: number; mobileColumns: boolean[] } {
  const working = matrix.map((row) => {
    let max = 0;
    for (const value of row) max = Math.max(max, Math.abs(value));
    const scale = max > 0 ? max : 1;
    return row.map((value) => value / scale);
  });
  const mobileColumns = new Array<boolean>(columns).fill(true);
  /** Row index each pivot column ended up in — the back-substitution needs it. */
  const pivotRowOfColumn = new Map<number, number>();
  const freeColumns: number[] = [];
  let rank = 0;

  for (let column = 0; column < columns && rank < working.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < working.length; row += 1) {
      if (Math.abs(working[row][column]) > Math.abs(working[pivot][column])) pivot = row;
    }

    if (Math.abs(working[pivot][column]) < RANK_TOLERANCE) {
      freeColumns.push(column);
      continue;
    }
    mobileColumns[column] = false; // pinned until a free column proves it co-moves
    pivotRowOfColumn.set(column, rank);
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

  // The columns the loop never reached (all rows already pivoted) are free too.
  for (let column = 0; column < columns; column += 1) {
    if (!pivotRowOfColumn.has(column) && mobileColumns[column]) freeColumns.push(column);
  }

  // Back-substitution: a pivot variable co-moves with a free one when its own row still
  // has a significant entry at that free column — the null-space basis vector's
  // component there. Genuine couplings are O(1) on the row-normalised matrix;
  // `MOBILITY_TOLERANCE` sits an order above the finite-difference noise the rank itself
  // already tolerates.
  for (const [pivotColumn, pivotRow] of pivotRowOfColumn) {
    for (const freeColumn of freeColumns) {
      const component = working[pivotRow][freeColumn] / working[pivotRow][pivotColumn];
      if (Math.abs(component) > MOBILITY_TOLERANCE) {
        mobileColumns[pivotColumn] = true;
        break;
      }
    }
  }

  return { rank, mobileColumns };
}

/**
 * Maps the solver's mobile columns onto the sketch's own ids — an entity is under-defined
 * when any variable that shapes it (a point it reads, or a curve's radius) can still
 * move, either because its column is free or because it co-moves with a free one; fully
 * defined when every one of them is pinned outright. Points get their own set so the
 * viewport's point dots can join the same colour convention as entity strokes.
 */
function entityFreedom(
  sketch: Sketch,
  layout: VariableLayout,
  mobileColumns: boolean[],
): { underDefinedEntityIds: Set<string>; underDefinedPointIds: Set<string> } {
  const pointFree = (id: string): boolean => {
    const index = layout.pointIndex.get(id);
    return index === undefined ? false : mobileColumns[index] || mobileColumns[index + 1];
  };

  const underDefinedPointIds = new Set<string>();
  for (const point of sketch.points) {
    if (pointFree(point.id)) underDefinedPointIds.add(point.id);
  }

  const underDefinedEntityIds = new Set<string>();
  for (const entity of sketch.entities) {
    // Same per-kind point set `sketchModel.entityPoints` returns, inlined rather than
    // imported so the solver stays leaf-level (sketchModel itself imports the solver's
    // consumers, and an import cycle would risk init-order trouble).
    const pointIds =
      entity.kind === "line"
        ? [entity.start, entity.end]
        : entity.kind === "circle"
          ? [entity.center]
          : entity.kind === "spline"
            ? entity.points
            : entity.kind === "point"
              ? [entity.at]
              : entity.kind === "arc"
                ? [entity.center, entity.start, entity.end]
                : [];
    let underDefined = pointIds.some(pointFree);
    if (!underDefined && (entity.kind === "circle" || entity.kind === "arc")) {
      const radiusIndex = layout.radiusIndex.get(entity.id);
      underDefined = radiusIndex !== undefined && mobileColumns[radiusIndex];
    }
    if (underDefined) underDefinedEntityIds.add(entity.id);
  }

  return { underDefinedEntityIds, underDefinedPointIds };
}

/**
 * Rewrites every driven (reference) dimension's value to what the solved geometry
 * actually measures — a driven dimension's value is an output of the solve, not an input
 * to it, so it follows the geometry exactly the way its parenthesised label claims to
 * (and keeps following it live during a point drag). Returns the same sketch object when
 * no value changes, so an otherwise-unchanged solve still compares identity-equal.
 */
function refreshDrivenDimensions(
  sketch: Sketch,
  entities: Map<string, SketchEntity>,
  layout: VariableLayout,
  values: Float64Array,
): Sketch {
  if (!sketch.dimensions.some((dimension) => dimension.driven)) return sketch;

  let changed = false;
  const dimensions = sketch.dimensions.map((dimension) => {
    if (!dimension.driven) return dimension;
    const measured = measuredDimensionValue(dimension, entities, values, layout);
    // Unmeasurable right now (a degenerate angle, a missing reference) — keep the last
    // value rather than inventing one.
    if (measured === null || measured === dimension.value) return dimension;
    changed = true;
    return { ...dimension, value: measured };
  });

  return changed ? { ...sketch, dimensions } : sketch;
}

export interface SolveOutcome {
  sketch: Sketch;
  diagnostics: SketchDiagnostics;
  /** Entity ids that still have a degree of freedom — the blue of the classic CAD
   * blue/black sketch colouring, driven by the same elimination that counts the DOF
   * (see `rankAndMobileColumns`). Empty when every entity is fully defined. */
  underDefinedEntityIds: Set<string>;
  /** Point ids (endpoints, centres, standalone) whose own x/y can still move — the point
   * dots join the entity strokes in the same convention. */
  underDefinedPointIds: Set<string>;
}

/**
 * Solves a sketch's constraint system by damped Newton iteration with a backtracking line
 * search — steps are only accepted when they reduce the residual norm, so the returned
 * geometry is never *less* constraint-satisfying than the geometry passed in, even when
 * the system cannot converge at all (conflicting constraints leave it at the closest
 * attempt and report over-defined, rather than committing wherever the iteration cap
 * happened to leave the points).
 *
 * Returns the updated geometry together with diagnostics the status bar turns into
 * "Fully Defined" / "Under Defined" / "Over Defined", and the per-entity/per-point
 * under-defined id sets the viewport turns into the classic CAD blue/black entity
 * colouring (blue = can still move, black = pinned) — SolidWorks, Fusion and Onshape
 * all document that convention, and it comes out of the same elimination that counts
 * the DOF, so the two can never disagree. An under-defined sketch is not an
 * error: it solves fine and simply retains degrees of freedom.
 *
 * `anchorSketch` (defaults to `sketch` itself) is where "fix"/"fix-line" read the positions
 * and radii they pin to — pass the sketch as it stood *before* whatever mutation produced
 * `sketch` when that mutation itself moved the very point/entity a fix constraint anchors
 * to (a live point drag is exactly this: the dragged point is written to the cursor position
 * before solving). Using `sketch` for both, the default, is correct whenever `sketch` hasn't
 * had a fixed point's own position perturbed ahead of the solve — the common case of adding
 * or removing a constraint — since anchors then just reflect the sketch's own last-settled,
 * constraint-satisfying geometry.
 */
export function solveSketch(sketch: Sketch, anchorSketch: Sketch = sketch): SolveOutcome {
  const layout = buildLayout(sketch);
  const anchors = new Map(anchorSketch.points.map((point) => [point.id, { x: point.x, y: point.y }]));
  const anchorEntities = new Map(anchorSketch.entities.map((entity) => [entity.id, entity]));
  const entities = buildEntityMap(sketch);

  let values = packVariables(sketch, layout);
  // The sparse residual decomposition — one block per constraint/dimension, each knowing
  // the few variables its own equations read. Built once for the whole solve and reused
  // by every iteration's residual pass and Jacobian probe (see `jacobian`); the initial
  // `values` fix each block's row offset, so the vector `sourceResiduals` produces matches
  // the one `evaluateResiduals` would have returned for the same guess.
  const sources = residualSources(sketch, layout, values, anchors, anchorEntities, entities);
  let residuals = sourceResiduals(sources, values);

  if (residuals.length === 0 || layout.size === 0) {
    // No equations at all: every variable is free, so every entity/point is
    // under-defined — consistent with `dof: layout.size` right beside it.
    const freedom = entityFreedom(sketch, layout, new Array<boolean>(layout.size).fill(true));
    return {
      sketch: refreshDrivenDimensions(sketch, entities, layout, values),
      diagnostics: {
        dof: layout.size,
        converged: true,
        redundant: false,
        residualNorm: 0,
        iterations: 0,
      },
      ...freedom,
    };
  }

  let residualNorm = norm(residuals);
  let iterations = 0;
  let converged = residualNorm < CONVERGENCE_TOLERANCE;

  // Best-so-far tracking over a strictly monotonically improving path: every accepted
  // step reduces ‖F‖ (see the backtracking below), so `bestValues` is never further from
  // satisfying the constraints than the geometry this function was handed. A
  // non-converged solve therefore returns the closest attempt rather than committing
  // wherever iteration 60 happened to leave the points — the old behaviour, which could
  // hand a wildly diverged sketch to the store when the system conflicted.
  let bestValues = values;
  let bestResiduals = residuals;
  let bestNorm = residualNorm;

  while (!converged && iterations < MAX_ITERATIONS) {
    const matrix = jacobian(sources, layout, values, residuals.length);
    const step = solveNormalEquations(matrix, residuals, layout.size);
    if (!step) break;

    // Backtracking line search: accept a step only if it actually reduces ‖F‖, halving
    // and retrying when it doesn't. Without this the loop accepted every finite step —
    // a conflicting or badly-posed system would wander for all 60 iterations, each one
    // potentially further out than the last.
    let accepted = false;
    for (let attempt = 0; attempt < MAX_BACKTRACKING_STEPS && !accepted; attempt += 1) {
      const candidate = Float64Array.from(values);
      for (let index = 0; index < layout.size; index += 1) candidate[index] += step[index];

      const candidateResiduals = sourceResiduals(sources, candidate);
      if (!candidateResiduals.every(Number.isFinite)) break;
      const candidateNorm = norm(candidateResiduals);

      if (candidateNorm < residualNorm) {
        values = candidate;
        residuals = candidateResiduals;
        residualNorm = candidateNorm;
        accepted = true;
        if (candidateNorm < bestNorm) {
          bestValues = candidate;
          bestResiduals = candidateResiduals;
          bestNorm = candidateNorm;
        }
      } else {
        for (let index = 0; index < layout.size; index += 1) step[index] /= 2;
      }
    }

    if (!accepted) break;
    iterations += 1;
    converged = residualNorm < CONVERGENCE_TOLERANCE;
  }

  const finalJacobian = jacobian(sources, layout, bestValues, bestResiduals.length);
  const { rank, mobileColumns } = rankAndMobileColumns(finalJacobian, layout.size);
  const freedom = entityFreedom(sketch, layout, mobileColumns);
  // Driven dimensions read their value off the *solved* geometry, so the refresh runs on
  // the unpacked positions — the same `bestValues` the diagnostics were computed from.
  const solvedSketch = refreshDrivenDimensions(
    unpackVariables(sketch, layout, bestValues),
    entities,
    layout,
    bestValues,
  );

  return {
    sketch: solvedSketch,
    diagnostics: {
      dof: Math.max(0, layout.size - rank),
      converged,
      // Fewer independent rows than equations means at least one constraint restates
      // another, which is what SolidWorks reports as over-defined.
      redundant: rank < bestResiduals.length,
      residualNorm: bestNorm,
      iterations,
    },
    ...freedom,
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
