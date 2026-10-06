import { StoryboardPage } from "@/components/studio/story/storyboard-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoryboardPage projectId={id} />;
}
