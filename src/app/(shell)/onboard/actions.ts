"use server";

/**
 * /onboard server actions (Slice 5, 2026-07-24) - thin wrappers over the Runtime
 * onboarding facade. Each resolves the current user + pending account through the
 * one gate (requireOnboardingTenant), then calls exactly one facade command. No
 * business logic lives here; the facade owns every rule, guard, and fallback.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOnboardingTenant } from "@/domains/account";
import {
  submitWebsite,
  inferProfile,
  saveProfileEdits,
  confirmProfile,
  proposeProfilePatch,
  applyConfirmedPatch,
  saveGoal,
  generatePromptCandidates,
  approvePrompts,
  activateAccount,
  type OnboardingGoal,
  type ProfileEdits,
  type ProfilePatch,
  type PromptSelection,
} from "@/domains/runtime";

async function tid(): Promise<string> {
  const { tenantId } = await requireOnboardingTenant();
  return tenantId;
}

export async function submitWebsiteAction(url: string) {
  const result = await submitWebsite(await tid(), url);
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function inferProfileAction() {
  const result = await inferProfile(await tid());
  revalidatePath("/onboard");
  return result;
}

export async function saveProfileEditsAction(edits: ProfileEdits) {
  const result = await saveProfileEdits(await tid(), edits);
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function confirmProfileAction() {
  const result = await confirmProfile(await tid());
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function proposeProfilePatchAction(instruction: string) {
  return proposeProfilePatch(await tid(), instruction);
}

export async function applyPatchAction(patch: ProfilePatch) {
  const result = await applyConfirmedPatch(await tid(), patch);
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function saveGoalAction(goal: OnboardingGoal) {
  const result = await saveGoal(await tid(), goal);
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function generateCandidatesAction() {
  const result = await generatePromptCandidates(await tid());
  revalidatePath("/onboard");
  return result;
}

export async function approvePromptsAction(selection: PromptSelection) {
  const result = await approvePrompts(await tid(), selection);
  if (result.ok) revalidatePath("/onboard");
  return result;
}

export async function activateAction(tosAccepted: boolean) {
  const result = await activateAccount(await tid(), tosAccepted);
  if (result.ok) redirect("/");
  return result;
}
