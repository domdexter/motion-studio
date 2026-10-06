import { ReviewPage } from "@/components/studio/creative/review-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewPage projectId={id} />;
}
