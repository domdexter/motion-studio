import { VoicePage } from "@/components/studio/voice/voice-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoicePage projectId={id} />;
}
