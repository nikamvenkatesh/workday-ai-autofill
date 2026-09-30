import type { FillPlan, FormField } from "../types/field";
import type { ResumeProfile, UserPreferences } from "../types/resume";
import { aiMapFields } from "./ai";
import { heuristicMapField, mergePlans } from "./heuristics";

export async function mapFields(args: {
  apiKey: string;
  profile: ResumeProfile;
  preferences: UserPreferences;
  fields: FormField[];
}): Promise<FillPlan[]> {
  const heuristic = args.fields
    .map((field) => heuristicMapField(field, args.profile, args.preferences))
    .filter((plan): plan is FillPlan => Boolean(plan));

  const remaining = args.fields.filter(
    (field) => !heuristic.some((plan) => plan.fieldId === field.id && plan.confidence === "high"),
  );

  let ai: FillPlan[] = [];
  if (args.apiKey && remaining.length) {
    ai = await aiMapFields(args.apiKey, args.profile, args.preferences, remaining);
  }

  return mergePlans(heuristic, ai);
}

export { heuristicMapField, mergePlans } from "./heuristics";
