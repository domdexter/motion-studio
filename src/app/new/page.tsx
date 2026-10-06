import type { Metadata } from "next";
import { WORKFLOWS, type Workflow } from "@/core/spec/enums";
import { NewProjectWizard } from "@/components/studio/new-project/wizard";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ workflow?: string }> }) {
  const { workflow } = await searchParams;
  const valid = (WORKFLOWS as readonly string[]).includes(workflow ?? "") && workflow !== "imported";
  return <NewProjectWizard initialWorkflow={valid ? (workflow as Workflow) : "script_only"} skipStart={valid} />;
}
