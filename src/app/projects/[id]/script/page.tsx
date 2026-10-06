import { ScriptPage } from "@/components/studio/script/script-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScriptPage projectId={id} />;
}
