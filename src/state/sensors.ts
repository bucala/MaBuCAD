import type { SensorOperator } from "@/types/document";

/** Whether a sensor's alert condition currently holds — `operator`/`threshold` describe
 * the condition that means "alert", not one that means "OK" (e.g. `gt` + 5000 reads as
 * "alert when the value is greater than 5000"), so Inspect > Sensors' UI can phrase a new
 * sensor the same way a person would say it out loud. */
export function sensorTriggered(operator: SensorOperator, value: number, threshold: number): boolean {
  if (operator === "lt") return value < threshold;
  if (operator === "gt") return value > threshold;
  const epsilon = 1e-6 * Math.max(1, Math.abs(threshold));
  return Math.abs(value - threshold) <= epsilon;
}
